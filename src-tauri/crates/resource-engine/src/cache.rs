use crate::{
    error::{checkpoint, Error},
    source::Entry,
};
use anyhow::{ensure, Context, Result};
use md5::Md5;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeSet, HashMap},
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
    #[cfg(unix)]
    identity: (u64, u64, i64, i64),
}
impl Stamp {
    fn read(path: &Path) -> Result<Self> {
        #[cfg(unix)]
        use std::os::unix::fs::MetadataExt;
        let metadata = path.metadata()?;
        ensure!(metadata.is_file(), "Resource is not a file");
        Ok(Self {
            size: metadata.len(),
            modified: metadata.modified().ok(),
            created: metadata.created().ok(),
            #[cfg(unix)]
            identity: (
                metadata.dev(),
                metadata.ino(),
                metadata.ctime(),
                metadata.ctime_nsec(),
            ),
        })
    }
}
struct Verified {
    stamp: Stamp,
    md5: String,
    sha256: String,
    expected_sha256: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct DownloadReceipt {
    entry: Entry,
    sha256: String,
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
    pub fn path(&self, namespace: &str, name: &str) -> Result<PathBuf> {
        ensure!(
            resource_path(namespace)?.components().count() == 1,
            "Invalid cache namespace"
        );
        safe_path(&safe_path(&self.root, namespace)?, name)
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
        namespace: &str,
        entry: &Entry,
        cancel: &CancellationToken,
    ) -> Result<Option<PathBuf>> {
        checkpoint(cancel)?;
        let destination = self.path(namespace, &entry.name)?;
        if !destination.is_file() {
            return Ok(None);
        }
        // A full publisher checksum is sufficient even if a crash interrupted
        // writing the sidecar. Short publisher tags need their download receipt.
        let receipt = if entry.full_md5().is_none() {
            fs::read(receipt_path(&destination))
                .ok()
                .and_then(|raw| serde_json::from_slice::<DownloadReceipt>(&raw).ok())
                .filter(|receipt| {
                    receipt.entry == *entry
                        && receipt.sha256.len() == 64
                        && receipt.sha256.bytes().all(|c| c.is_ascii_hexdigit())
                })
        } else {
            None
        };
        if entry.full_md5().is_none() && receipt.is_none() {
            return Ok(None);
        }
        let valid = self
            .verify(
                &destination,
                entry,
                cancel,
                receipt.as_ref().map(|r| r.sha256.as_str()),
            )
            .is_ok();
        checkpoint(cancel)?;
        Ok(valid.then_some(destination))
    }

    pub fn receipt(&self, path: &Path, entry: &Entry, hash: &str) -> Result<()> {
        write_json(
            &receipt_path(path),
            &DownloadReceipt {
                entry: entry.clone(),
                sha256: hash.into(),
            },
        )
    }

    /// Called only with a successfully loaded manifest, before playback starts.
    /// Walk owned files individually; never follow links or recursively delete
    /// an unchecked directory. Validation completes before any file is removed.
    pub fn prune(
        &self,
        namespace: &str,
        names: &BTreeSet<String>,
        cancel: &CancellationToken,
    ) -> Result<usize> {
        checkpoint(cancel)?;
        ensure!(
            !names.is_empty(),
            "Refusing to clean with an empty resource manifest"
        );
        let mut keep = BTreeSet::new();
        for name in names {
            let path = self.path(namespace, name)?;
            keep.insert(receipt_path(&path));
            keep.insert(path);
        }
        let root = safe_path(&self.root, namespace)?;
        if !root.is_dir() {
            return Ok(0);
        }
        fn walk(
            root: &Path,
            folder: &Path,
            files: &mut Vec<PathBuf>,
            directories: &mut Vec<PathBuf>,
            cancel: &CancellationToken,
        ) -> Result<()> {
            for entry in fs::read_dir(folder)? {
                checkpoint(cancel)?;
                let entry = entry?;
                let relative = entry
                    .path()
                    .strip_prefix(root)?
                    .to_string_lossy()
                    .replace('\\', "/");
                let path = safe_path(root, &relative)?;
                if entry.file_type()?.is_dir() {
                    walk(root, &path, files, directories, cancel)?;
                    directories.push(path);
                } else {
                    ensure!(entry.file_type()?.is_file(), "Unexpected cache entry");
                    files.push(path);
                }
            }
            Ok(())
        }
        let mut files = Vec::new();
        let mut directories = Vec::new();
        walk(&root, &root, &mut files, &mut directories, cancel)?;
        let mut removed = 0;
        for file in files.into_iter().filter(|p| !keep.contains(p)) {
            checkpoint(cancel)?;
            let relative = file
                .strip_prefix(&root)?
                .to_string_lossy()
                .replace('\\', "/");
            let target = safe_path(&root, &relative)?.canonicalize()?;
            ensure!(
                target.starts_with(&root) && target != root,
                "Resource cleanup escaped its directory"
            );
            fs::remove_file(target)?;
            removed += 1;
        }
        for directory in directories {
            checkpoint(cancel)?;
            let relative = directory
                .strip_prefix(&root)?
                .to_string_lossy()
                .replace('\\', "/");
            let target = safe_path(&root, &relative)?;
            if fs::read_dir(&target)?.next().is_none() {
                fs::remove_dir(target)?;
            }
        }
        self.verified
            .lock()
            .map_err(|_| anyhow::anyhow!("Resource verification cache unavailable"))?
            .retain(|p, _| p.is_file());
        Ok(removed)
    }

    pub fn unpack(
        &self,
        archive: &Path,
        destination: &Path,
        entry: &Entry,
        cancel: &CancellationToken,
        expected_sha256: Option<&str>,
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
        let hash = self.verify(output.path(), entry, cancel, expected_sha256)?;
        checkpoint(cancel)?;
        output.persist(destination).map_err(|error| error.error)?;
        self.receipt(destination, entry, &hash)
    }
}

fn receipt_path(path: &Path) -> PathBuf {
    let mut receipt = path.as_os_str().to_os_string();
    receipt.push(".verified.json");
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
        let path = cache.path("bundles", &value.name)?;
        write_atomic(&path, b"abc")?;
        assert!(cache.find("bundles", &value, &cancel)?.is_none());
        let digest = cache.verify(&path, &value, &cancel, None)?;
        cache.receipt(&path, &value, &digest)?;
        assert!(cache.find("bundles", &value, &cancel)?.is_some());
        let mut changed = value.clone();
        changed.md5 = "beef".into();
        assert!(cache.find("bundles", &changed, &cancel)?.is_none());
        changed = value.clone();
        changed
            .extra
            .insert("hash".into(), "changed publisher identity".into());
        assert!(cache.find("bundles", &changed, &cancel)?.is_none());
        write_atomic(&path, b"xyz")?;
        assert!(cache.find("bundles", &value, &cancel)?.is_none());
        Ok(())
    }

    #[test]
    fn reuse_and_replacement_use_the_same_path() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let cache = Cache::new(temp.path().to_owned())?;
        let cancel = CancellationToken::new();
        let value = entry(b"abc", "900150983cd24fb0d6963f7d28e17f72");
        let old = cache.path("bundles", &value.name)?;
        write_atomic(&old, b"abc")?;
        let new = cache
            .find("bundles", &value, &cancel)?
            .context("Verified original was not reused")?;
        assert_eq!(new, old);
        assert_eq!(fs::read(&new)?, b"abc");
        let changed = entry(b"xyz", "d16fb36f0911f878998c136191af705e");
        assert!(cache.find("bundles", &changed, &cancel)?.is_none());
        assert_eq!(fs::read(&old)?, b"abc");
        let archive = temp.path().join("download.zip");
        let make_archive = |bytes: &[u8]| -> Result<()> {
            let mut zip = zip::ZipWriter::new(File::create(&archive)?);
            zip.start_file(&changed.name, zip::write::SimpleFileOptions::default())?;
            zip.write_all(bytes)?;
            zip.finish()?;
            Ok(())
        };
        make_archive(b"bad")?;
        assert!(cache
            .unpack(&archive, &old, &changed, &cancel, None)
            .is_err());
        assert_eq!(fs::read(&old)?, b"abc");
        make_archive(b"xyz")?;
        assert!(cache
            .unpack(&archive, &old, &changed, &cancel, Some(&"0".repeat(64)))
            .is_err());
        assert_eq!(fs::read(&old)?, b"abc");
        let cancelled = CancellationToken::new();
        cancelled.cancel();
        assert!(cache
            .unpack(&archive, &old, &changed, &cancelled, None)
            .is_err());
        assert_eq!(fs::read(&old)?, b"abc");
        cache.unpack(&archive, &old, &changed, &cancel, None)?;
        assert_eq!(cache.find("bundles", &changed, &cancel)?, Some(old.clone()));
        assert_eq!(fs::read(&old)?, b"xyz");
        assert!(cache.find("bundles", &value, &cancel)?.is_none());
        Ok(())
    }

    #[test]
    fn cleanup_only_removes_unlisted_owned_files() -> Result<()> {
        let data = tempfile::tempdir()?;
        let cache = Cache::new(data.path().join("cache"))?;
        let cancel = CancellationToken::new();
        let keep = cache.path("bundles", "avg/keep.ab")?;
        write_atomic(&keep, b"keep")?;
        write_atomic(&receipt_path(&keep), b"receipt")?;
        let removed = cache.path("bundles", "avg/removed.ab")?;
        write_atomic(&removed, b"obsolete")?;
        write_atomic(&receipt_path(&removed), b"receipt")?;
        let previous = cache.path("bundles", "old-version/avg/file.ab")?;
        write_atomic(&previous, b"obsolete directory")?;
        let other = cache.path("historical-movies", "avg/other.ab")?;
        write_atomic(&other, b"historical movie")?;
        write_atomic(&data.path().join("settings.json"), b"user settings")?;
        assert!(cache.prune("bundles", &BTreeSet::new(), &cancel).is_err());
        assert!(cache
            .prune(
                "bundles",
                &BTreeSet::from(["avg/keep.ab".into(), "../outside".into()]),
                &cancel
            )
            .is_err());
        assert!(removed.is_file());
        let names = BTreeSet::from(["avg/keep.ab".into()]);
        let cancelled = CancellationToken::new();
        cancelled.cancel();
        assert!(cache.prune("bundles", &names, &cancelled).is_err());
        assert!(removed.is_file());
        assert_eq!(cache.prune("bundles", &names, &cancel)?, 3);
        assert!(keep.is_file() && receipt_path(&keep).is_file());
        assert!(!removed.exists() && !previous.exists());
        assert!(!cache.root.join("bundles/old-version").exists());
        assert_eq!(fs::read(other)?, b"historical movie");
        assert_eq!(
            fs::read(data.path().join("settings.json"))?,
            b"user settings"
        );
        Ok(())
    }

    #[cfg(unix)]
    #[test]
    fn cleanup_does_not_follow_links() -> Result<()> {
        let data = tempfile::tempdir()?;
        let outside = tempfile::tempdir()?;
        let cache = Cache::new(data.path().to_owned())?;
        fs::create_dir_all(cache.root.join("bundles"))?;
        write_atomic(&outside.path().join("important"), b"keep")?;
        std::os::unix::fs::symlink(outside.path(), cache.root.join("bundles/link"))?;
        assert!(cache
            .prune(
                "bundles",
                &BTreeSet::from(["avg/keep.ab".into()]),
                &CancellationToken::new()
            )
            .is_err());
        assert_eq!(fs::read(outside.path().join("important"))?, b"keep");
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
