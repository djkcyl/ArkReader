use crate::cache::{safe_path, write_json};
use anyhow::{ensure, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::Read,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tokio_util::sync::CancellationToken;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Receipt {
    pub size: u64,
    pub sha256: String,
}
#[derive(Serialize, Deserialize)]
struct Snapshot {
    key: String,
    decoder: String,
    metadata: Value,
    metadata_sha256: String,
    files: BTreeMap<String, Receipt>,
}

pub fn fingerprint(value: &impl Serialize) -> Result<String> {
    Ok(format!("{:x}", Sha256::digest(serde_json::to_vec(value)?)))
}
pub fn receipt(path: &Path, cancel: &CancellationToken) -> Result<Receipt> {
    crate::error::checkpoint(cancel)?;
    let mut input = fs::File::open(path)?;
    let before = input.metadata()?;
    let mut hash = Sha256::new();
    let mut bytes = [0u8; 65536];
    let mut size = 0;
    loop {
        crate::error::checkpoint(cancel)?;
        let n = input.read(&mut bytes)?;
        if n == 0 {
            break;
        }
        size += n as u64;
        hash.update(&bytes[..n]);
    }
    let after = path.metadata()?;
    ensure!(
        before.len() == size
            && after.len() == size
            && before.modified().ok() == after.modified().ok(),
        "Derived resource changed during validation"
    );
    Ok(Receipt {
        size,
        sha256: format!("{:x}", hash.finalize()),
    })
}
pub fn valid(path: &Path, expected: &Receipt, cancel: &CancellationToken) -> bool {
    receipt(path, cancel)
        .is_ok_and(|actual| actual.size == expected.size && actual.sha256 == expected.sha256)
}

pub fn media_files(value: &Value, files: &mut Vec<String>) {
    match value {
        Value::String(value) if value.starts_with("/media/") => {
            files.push(value.trim_start_matches('/').into())
        }
        Value::Object(map) => {
            for value in map.values() {
                media_files(value, files);
            }
        }
        Value::Array(values) => {
            for value in values {
                media_files(value, files);
            }
        }
        _ => {}
    }
}

pub struct Artifacts {
    root: PathBuf,
}
impl Artifacts {
    pub fn new(data: &Path) -> Result<Self> {
        let root = data.join("derived-cache");
        fs::create_dir_all(&root)?;
        Ok(Self {
            root: root.canonicalize()?,
        })
    }
    fn path(&self, namespace: &str, key: &str) -> Result<PathBuf> {
        ensure!(
            key.len() == 64 && key.bytes().all(|b| b.is_ascii_hexdigit()),
            "Invalid derived resource identity"
        );
        safe_path(&safe_path(&self.root, namespace)?, key)
    }
    pub fn restore(
        &self,
        namespace: &str,
        key: &str,
        runtime: &Path,
        cancel: &CancellationToken,
    ) -> Result<Option<Value>> {
        let directory = self.path(namespace, key)?;
        let Ok(raw) = fs::read(directory.join("receipt.json")) else {
            return Ok(None);
        };
        let Ok(snapshot) = serde_json::from_slice::<Snapshot>(&raw) else {
            return Ok(None);
        };
        if snapshot.key != key
            || snapshot.decoder != crate::DECODER_REVISION
            || fingerprint(&snapshot.metadata)? != snapshot.metadata_sha256
        {
            return Ok(None);
        }
        for (name, expected) in &snapshot.files {
            let Ok(path) = safe_path(&directory.join("files"), name) else {
                return Ok(None);
            };
            if !valid(&path, expected, cancel) {
                return Ok(None);
            }
        }
        for name in snapshot.files.keys() {
            crate::error::checkpoint(cancel)?;
            let from = safe_path(&directory.join("files"), name)?;
            let to = safe_path(runtime, name)?;
            fs::create_dir_all(to.parent().context("Derived target has no parent")?)?;
            if to.exists() && valid(&to, &snapshot.files[name], cancel) {
                continue;
            }
            let staged =
                tempfile::tempdir_in(to.parent().context("Derived target has no parent")?)?;
            let payload = staged.path().join("payload");
            if fs::hard_link(&from, &payload).is_err() {
                fs::copy(from, &payload)?;
            }
            crate::error::checkpoint(cancel)?;
            fs::rename(payload, to)?;
        }
        let now = u64::try_from(SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos())?;
        write_json(&directory.join("used.json"), &now)?;
        Ok(Some(snapshot.metadata))
    }
    pub fn store(
        &self,
        namespace: &str,
        key: &str,
        runtime: &Path,
        names: &[String],
        metadata: Value,
        cancel: &CancellationToken,
    ) -> Result<()> {
        let destination = self.path(namespace, key)?;
        let parent = destination
            .parent()
            .context("Derived cache has no parent")?;
        fs::create_dir_all(parent)?;
        let staging = tempfile::Builder::new()
            .prefix(".cache-")
            .tempdir_in(parent)?;
        let mut files = BTreeMap::new();
        for name in names.iter().collect::<BTreeSet<_>>() {
            crate::error::checkpoint(cancel)?;
            let from = safe_path(runtime, name)?;
            let expected = receipt(&from, cancel)?;
            let to = safe_path(&staging.path().join("files"), name)?;
            fs::create_dir_all(to.parent().context("Derived artifact has no parent")?)?;
            if fs::hard_link(&from, &to).is_err() {
                fs::copy(&from, &to)?;
            }
            ensure!(
                valid(&to, &expected, cancel),
                "Derived resource copy failed validation"
            );
            files.insert(name.clone(), expected);
        }
        write_json(
            &staging.path().join("receipt.json"),
            &Snapshot {
                key: key.into(),
                decoder: crate::DECODER_REVISION.into(),
                metadata_sha256: fingerprint(&metadata)?,
                metadata,
                files,
            },
        )?;
        write_json(
            &staging.path().join("used.json"),
            &u64::try_from(SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos())?,
        )?;
        crate::error::checkpoint(cancel)?;
        if destination.exists() {
            self.remove(&destination)?;
        }
        fs::rename(staging.path(), &destination)?;
        self.prune(namespace, if namespace == "music" { 3 } else { 2 })?;
        Ok(())
    }
    fn remove(&self, path: &Path) -> Result<()> {
        let target = path.canonicalize()?;
        ensure!(
            target.starts_with(&self.root) && target != self.root,
            "Refusing to remove an unowned cache directory"
        );
        let metadata = fs::symlink_metadata(path)?;
        ensure!(!metadata.file_type().is_symlink(), "Linked cache directory");
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            ensure!(
                metadata.file_attributes() & 0x400 == 0,
                "Linked cache directory"
            );
        }
        fs::remove_dir_all(target)?;
        Ok(())
    }
    pub fn clear(&self) -> Result<()> {
        for entry in fs::read_dir(&self.root)? {
            let entry = entry?;
            if entry.file_type()?.is_dir() {
                self.remove(&entry.path())?;
            }
        }
        Ok(())
    }
    fn prune(&self, namespace: &str, keep: usize) -> Result<()> {
        let directory = safe_path(&self.root, namespace)?;
        let mut entries = Vec::new();
        for entry in fs::read_dir(directory)? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() || entry.file_name().to_string_lossy().starts_with('.')
            {
                continue;
            }
            let path = entry.path();
            let used = fs::read(path.join("used.json"))
                .ok()
                .and_then(|raw| serde_json::from_slice::<u64>(&raw).ok())
                .unwrap_or(0);
            entries.push((used, path));
        }
        entries.sort_by_key(|(used, path)| (std::cmp::Reverse(*used), path.clone()));
        for (_, path) in entries.into_iter().skip(keep) {
            self.remove(&path)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn repeated_media_references_do_not_truncate_cached_files() -> Result<()> {
        let data = tempfile::tempdir()?;
        let runtime = tempfile::tempdir()?;
        let restored = tempfile::tempdir()?;
        let cache = Artifacts::new(data.path())?;
        let cancel = CancellationToken::new();
        let name = "media/sample.bin".to_owned();
        crate::cache::write_atomic(&runtime.path().join(&name), b"original payload")?;
        let key = fingerprint(&"snapshot")?;
        cache.store(
            "base",
            &key,
            runtime.path(),
            &[name.clone(), name.clone()],
            serde_json::json!({"ready":true}),
            &cancel,
        )?;
        assert_eq!(fs::read(runtime.path().join(&name))?, b"original payload");
        assert!(cache
            .restore("base", &key, restored.path(), &cancel)?
            .is_some());
        assert_eq!(fs::read(restored.path().join(&name))?, b"original payload");
        let record = cache.path("base", &key)?.join("receipt.json");
        let mut value: Value = serde_json::from_slice(&fs::read(&record)?)?;
        value["metadata"]["ready"] = false.into();
        write_json(&record, &value)?;
        assert!(cache
            .restore("base", &key, restored.path(), &cancel)?
            .is_none());
        Ok(())
    }
}
