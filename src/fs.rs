//! Tiny filesystem helpers shared across modules.

use camino::Utf8Path;

use crate::error::Error;

/// Atomically replace `path` with `contents` (write tmp → rename).
///
/// The tmp file shares `path`'s directory and base name with a `.tmp` suffix,
/// so the rename stays on the same mount point.
///
/// # Errors
/// Returns [`Error::Filesystem`] on any write or rename failure.
pub fn atomic_write(path: &Utf8Path, contents: &[u8]) -> Result<(), Error> {
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, contents).map_err(|e| Error::Filesystem(format!("writing {tmp}: {e}")))?;
    std::fs::rename(&tmp, path)
        .map_err(|e| Error::Filesystem(format!("renaming {tmp} -> {path}: {e}")))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_write_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let path =
            camino::Utf8PathBuf::from_path_buf(dir.path().join("test.txt")).expect("utf8 path");
        atomic_write(&path, b"hello").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "hello");
    }

    #[test]
    fn atomic_write_replaces_existing() {
        let dir = tempfile::tempdir().unwrap();
        let path =
            camino::Utf8PathBuf::from_path_buf(dir.path().join("test.txt")).expect("utf8 path");
        atomic_write(&path, b"first").unwrap();
        atomic_write(&path, b"second").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "second");
        assert!(!path.with_extension("tmp").exists());
    }
}
