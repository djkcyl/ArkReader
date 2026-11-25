use crate::{
    error::{checkpoint, Error},
    source::Entry,
};
use anyhow::{ensure, Context, Result};
use md5::Md5;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::{self, File},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::Mutex,
    time::SystemTime,
};
use tokio_util::sync::CancellationToken;

pub fn resource_path(name: &str) -> Result<&Path> {
    ensure!(
        !name.is_empty() && !name.contains(['\\', ':']),
        "Invalid resource name"
    );
    let relative = Path::new(name);
    ensure!(
        relative
            .components()
            .all(|part| matches!(part, Component::Normal(_))),
        "Resource path escapes its cache"
    );
    Ok(relative)
}

pub fn safe_path(root: &Path, name: &str) -> Result<PathBuf> {
    ensure!(
        !root.as_os_str().is_empty(),
        "Cache path requires an explicit directory"
    );
    let target = root.join(resource_path(name)?);
    let mut ancestor = target.as_path();
    while ancestor.starts_with(root) {
        match fs::symlink_metadata(ancestor) {
            Ok(metadata) => {
                ensure!(
                    !metadata.file_type().is_symlink(),
                    "Linked resource cache path"
                );
                #[cfg(windows)]
                {
                    use std::os::windows::fs::MetadataExt;
                    ensure!(
                        metadata.file_attributes() & 0x400 == 0,
                        "Linked resource cache path"
                    );
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        let Some(parent) = ancestor.parent() else {
            break;
        };
        ancestor = parent;
    }
    Ok(target)
}

pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path.parent().context("Output has no parent directory")?;
    fs::create_dir_all(parent)?;
    let mut staged = tempfile::NamedTempFile::new_in(parent)?;
    staged.write_all(bytes)?;
    staged.as_file().sync_all()?;
    staged.persist(path).map_err(|error| error.error)?;
    Ok(())
}
pub fn write_json(path: &Path, value: &impl Serialize) -> Result<()> {
    write_atomic(path, &serde_json::to_vec(value)?)
}

#[derive(Clone, PartialEq)]
struct Stamp {
    size: u64,
    modified: Option<SystemTime>,
    created: Option<SystemTime>,
}
impl Stamp {
    fn read(path: &Path) -> Result<Self> {
        let metadata = path.metadata()?;
        ensure!(metadata.is_file(), "Resource is not a file");
        Ok(Self {
            size: metadata.len(),
            modified: metadata.modified().ok(),
            created: metadata.created().ok(),
        })
    }
}
struct Verified {
    stamp: Stamp,
    md5: String,
    sha256: String,
    expected_sha256: Option<String>,
}

pub struct Cache {
    pub root: PathBuf,
    verified: Mutex<HashMap<PathBuf, Verified>>,
}
impl Cache {
    pub fn new(root: PathBuf) -> Result<Self> {
        fs::create_dir_all(&root)?;
        Ok(Self {
            root: root.canonicalize()?,
            verified: Mutex::new(HashMap::new()),
        })
    }
    pub fn path(&self, platform: &str, version: &str, name: &str) -> Result<PathBuf> {
        safe_path(
            &safe_path(&safe_path(&self.root, platform)?, version)?,
            name,
        )
    }
    pub fn verify(
        &self,
        path: &Path,
        entry: &Entry,
        cancel: &CancellationToken,
        expected_sha256: Option<&str>,
    ) -> Result<String> {
        checkpoint(cancel)?;
        let stamp = Stamp::read(path)?;
        ensure!(
            stamp.size == entry.ab_size,
            "Resource size mismatch: {}",
            entry.name
        );
        if let Some(value) = self
            .verified
            .lock()
            .map_err(|_| anyhow::anyhow!("Resource verification cache unavailable"))?
            .get(path)
        {
            if value.stamp == stamp
                && value.md5.eq_ignore_ascii_case(&entry.md5)
                && value.expected_sha256.as_deref() == expected_sha256
            {
                return Ok(value.sha256.clone());
            }
        }
        let mut file = File::open(path)?;
        let mut md5 = Md5::new();
        let mut sha = Sha256::new();
        let mut buffer = [0u8; 65536];
        loop {
            checkpoint(cancel)?;
            let n = file.read(&mut buffer)?;
            if n == 0 {
                break;
            }
            md5.update(&buffer[..n]);
            sha.update(&buffer[..n]);
        }
        if entry
            .full_md5()
            .is_some_and(|expected| !format!("{:x}", md5.finalize()).eq_ignore_ascii_case(expected))
        {
            return Err(Error::Checksum(entry.name.clone()).into());
        }
        ensure!(
            Stamp::read(path)? == stamp,
            "Resource changed during verification"
        );
        let digest = format!("{:x}", sha.finalize());
        if expected_sha256.is_some_and(|expected| expected != digest) {
            return Err(Error::Checksum(entry.name.clone()).into());
        }
        self.verified
            .lock()
            .map_err(|_| anyhow::anyhow!("Resource verification cache unavailable"))?
            .insert(
                path.to_owned(),
                Verified {
                    stamp,
                    md5: entry.md5.clone(),
                    sha256: digest.clone(),
                    expected_sha256: expected_sha256.map(str::to_owned),
                },
            );
        Ok(digest)
    }

    pub fn find(
        &self,
        platform: &str,
        version: &str,
        entry: &Entry,
        cancel: &CancellationToken,
    ) -> Result<Option<PathBuf>> {
        let destination = self.path(platform, version, &entry.name)?;
        if destination.is_file() {
            if let Ok(receipt) = fs::read_to_string(receipt_path(&destination)) {
                let receipt = receipt.trim();
                if receipt.len() == 64
                    && receipt.bytes().all(|b| b.is_ascii_hexdigit())
                    && self
                        .verify(&destination, entry, cancel, Some(receipt))
                        .is_ok()
                {
                    return Ok(Some(destination));
                }
            }
        }
        checkpoint(cancel)?;
        if entry.full_md5().is_none() {
            return Ok(None);
        }
        let root = safe_path(&self.root, platform)?;
        if !root.is_dir() {
            return Ok(None);
        }
        let mut versions = fs::read_dir(&root)?.collect::<std::io::Result<Vec<_>>>()?;
        versions.sort_by_key(|item| std::cmp::Reverse(item.file_name()));
        for directory in versions {
            checkpoint(cancel)?;
            if !directory.file_type()?.is_dir() || directory.file_name() == version {
                continue;
            }
            let Some(folder) = directory.file_name().to_str().map(str::to_owned) else {
                continue;
            };
            let previous = safe_path(&safe_path(&root, &folder)?, &entry.name)?;
            if !previous.is_file() || self.verify(&previous, entry, cancel, None).is_err() {
                continue;
            }
            let parent = destination
                .parent()
                .context("Invalid resource cache location")?;
            fs::create_dir_all(parent)?;
            let mut staged = tempfile::NamedTempFile::new_in(parent)?;
            let mut input = File::open(previous)?;
            let mut buffer = [0u8; 65536];
            loop {
                checkpoint(cancel)?;
                let n = input.read(&mut buffer)?;
                if n == 0 {
                    break;
                }
                staged.write_all(&buffer[..n])?;
            }
            staged.as_file().sync_all()?;
            let hash = self.verify(staged.path(), entry, cancel, None)?;
            checkpoint(cancel)?;
            staged.persist(&destination).map_err(|error| error.error)?;
            self.receipt(&destination, &hash)?;
            return Ok(Some(destination));
        }
        Ok(None)
    }

    pub fn receipt(&self, path: &Path, hash: &str) -> Result<()> {
        write_atomic(&receipt_path(path), hash.as_bytes())
    }

    pub fn unpack(
        &self,
        archive: &Path,
        destination: &Path,
        entry: &Entry,
        cancel: &CancellationToken,
    ) -> Result<()> {
        checkpoint(cancel)?;
        let mut zip = zip::ZipArchive::new(File::open(archive)?)?;
        ensure!(
            zip.len() <= 128,
            "Unexpected official resource archive entries"
        );
        let mut payload = None;
        for index in 0..zip.len() {
            let member = zip.by_index(index)?;
            if !member.is_dir() {
                ensure!(
                    payload.replace(index).is_none(),
                    "Unexpected official resource archive entries"
                );
            }
        }
        let mut member = zip.by_index(payload.context("Official resource archive is empty")?)?;
        ensure!(
            member.name()?.as_ref() == entry.name
                && member.size() == entry.ab_size
                && !member.is_dir(),
            "Unexpected official resource archive contents"
        );
        let parent = destination
            .parent()
            .context("Invalid resource cache location")?;
        let mut output = tempfile::NamedTempFile::new_in(parent)?;
        let mut buffer = [0u8; 65536];
        let mut size = 0u64;
        loop {
            checkpoint(cancel)?;
            let n = member.read(&mut buffer)?;
            if n == 0 {
                break;
            }
            size += n as u64;
            ensure!(
                size <= entry.ab_size,
                "Archive exceeds official output size"
            );
            output.write_all(&buffer[..n])?;
        }
        output.as_file().sync_all()?;
        let hash = self.verify(output.path(), entry, cancel, None)?;
        checkpoint(cancel)?;
        output.persist(destination).map_err(|error| error.error)?;
        self.receipt(destination, &hash)
    }
}

fn receipt_path(path: &Path) -> PathBuf {
    let mut receipt = path.as_os_str().to_os_string();
    receipt.push(".sha256");
    receipt.into()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn manifest_names_are_checked_without_accessing_the_working_directory() -> Result<()> {
        assert_eq!(
            resource_path("avg/[uc]common.ab")?,
            Path::new("avg/[uc]common.ab")
        );
        assert_eq!(
            resource_path("26-11-13-06-34-18-84612175")?
                .components()
                .count(),
            1
        );
        for name in [
            "",
            "../outside",
            "/absolute",
            "C:/drive",
            "avg\\file",
            "avg/../../outside",
        ] {
            assert!(resource_path(name).is_err(), "{name}");
        }
        assert!(safe_path(Path::new(""), "avg/file.ab").is_err());
        Ok(())
    }

    fn entry(bytes: &[u8], digest: &str) -> Entry {
        Entry {
            name: "avg/sample.ab".into(),
            md5: digest.into(),
            ab_size: bytes.len() as u64,
            total_size: bytes.len() as u64,
            extra: Default::default(),
        }
    }

    #[test]
    fn short_publisher_tags_need_a_matching_download_receipt() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let cache = Cache::new(temp.path().to_owned())?;
        let cancel = CancellationToken::new();
        let value = entry(b"abc", "eb8a");
        let path = cache.path("Windows", "one", &value.name)?;
        write_atomic(&path, b"abc")?;
        assert!(cache.find("Windows", "one", &value, &cancel)?.is_none());
        let digest = cache.verify(&path, &value, &cancel, None)?;
        cache.receipt(&path, &digest)?;
        assert!(cache.find("Windows", "one", &value, &cancel)?.is_some());
        write_atomic(&path, b"xyz")?;
        assert!(cache.find("Windows", "one", &value, &cancel)?.is_none());
        assert!(cache.find("Windows", "two", &value, &cancel)?.is_none());
        Ok(())
    }

    #[test]
    fn reuse_requires_the_new_manifest_checksum() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let cache = Cache::new(temp.path().to_owned())?;
        let cancel = CancellationToken::new();
        let value = entry(b"abc", "900150983cd24fb0d6963f7d28e17f72");
        let old = cache.path("Android", "one", &value.name)?;
        write_atomic(&old, b"abc")?;
        let new = cache
            .find("Android", "two", &value, &cancel)?
            .context("Verified original was not reused")?;
        assert_eq!(fs::read(new)?, b"abc");
        let changed = entry(b"xyz", "d16fb36f0911f878998c136191af705e");
        assert!(cache.find("Android", "three", &changed, &cancel)?.is_none());
        Ok(())
    }

    #[test]
    fn cache_paths_cannot_escape_the_app_directory() -> Result<()> {
        let temp = tempfile::tempdir()?;
        for name in [
            "",
            "../outside",
            "/outside",
            "C:/outside",
            "a/../../outside",
            "a\\..\\outside",
        ] {
            assert!(safe_path(temp.path(), name).is_err(), "{name}");
        }
        assert!(safe_path(temp.path(), "avg/[uc]common.ab").is_ok());
        Ok(())
    }
}
