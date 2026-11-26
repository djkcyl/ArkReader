use crate::cache::write_json;
use anyhow::{ensure, Result};
use std::{fs, path::Path};

pub struct Session {
    lease: fs::File,
    directory: tempfile::TempDir,
}

impl Session {
    pub fn new(root: &Path) -> Result<Self> {
        let root = root.canonicalize()?;
        for entry in fs::read_dir(&root)? {
            let entry = entry?;
            if !entry.file_type()?.is_dir()
                || !entry.file_name().to_string_lossy().starts_with("session-")
            {
                continue;
            }
            let path = entry.path().canonicalize()?;
            if path.parent() != Some(root.as_path()) {
                continue;
            }
            let marker = path.join(".arkreader-session");
            if !fs::symlink_metadata(&marker).is_ok_and(|m| m.file_type().is_file()) {
                continue;
            }
            let owned = fs::read(&marker)
                .ok()
                .and_then(|raw| serde_json::from_slice::<serde_json::Value>(&raw).ok())
                .is_some_and(|value| value["format"] == 1);
            if !owned {
                continue;
            }
            let lock = path.join(".lease");
            if !fs::symlink_metadata(&lock).is_ok_and(|m| m.file_type().is_file()) {
                continue;
            }
            let lease = fs::OpenOptions::new().read(true).write(true).open(lock)?;
            if lease.try_lock().is_err() {
                continue;
            }
            drop(lease);
            fs::remove_dir_all(path)?;
        }
        let directory = tempfile::Builder::new()
            .prefix("session-")
            .tempdir_in(root)?;
        let lease = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .open(directory.path().join(".lease"))?;
        #[cfg(not(target_os = "emscripten"))]
        lease.try_lock()?;
        write_json(
            &directory.path().join(".arkreader-session"),
            &serde_json::json!({"format":1}),
        )?;
        Ok(Self { lease, directory })
    }

    pub fn path(&self) -> &Path {
        self.directory.path()
    }

    pub fn close(self) -> Result<()> {
        ensure!(
            self.path().join(".arkreader-session").is_file(),
            "Render session marker missing"
        );
        drop(self.lease);
        self.directory.close()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn live_sessions_are_retained_and_abandoned_sessions_are_reclaimed() -> Result<()> {
        let root = tempfile::tempdir()?;
        let live = Session::new(root.path())?;
        let abandoned = root.path().join("session-abandoned");
        fs::create_dir(&abandoned)?;
        fs::write(abandoned.join(".lease"), b"")?;
        fs::write(abandoned.join(".arkreader-session"), br#"{"format":1}"#)?;
        let unrelated = root.path().join("session-unowned");
        fs::create_dir(&unrelated)?;
        let next = Session::new(root.path())?;
        assert!(live.path().exists());
        assert!(!abandoned.exists());
        assert!(unrelated.exists());
        let released = next.path().to_owned();
        next.close()?;
        assert!(!released.exists());
        live.close()?;
        Ok(())
    }
}
