//! Probe a candidate install root and return a [`Layout`].
//!
//! The probe is read-only and conservative: we look for the dedicated-server
//! binary on either platform, decide which platform we're looking at, and
//! return a fully-resolved [`Layout`]. Callers can then ask the doctor whether
//! the resulting paths are sane.

use camino::Utf8Path;

use crate::error::CoreError;
use crate::layout::{Layout, Platform};

/// Walk `root` and return a [`Layout`] for whichever platform it appears to be.
///
/// # Errors
/// Returns [`CoreError::Discovery`] if neither a Linux nor a Windows server
/// binary is present under `root`.
pub fn probe(root: &Utf8Path) -> Result<Layout, CoreError> {
    if !root.is_dir() {
        return Err(CoreError::Discovery(format!("{root} is not a directory")));
    }

    let linux = Layout::at(root, Platform::Linux);
    let windows = Layout::at(root, Platform::Windows);

    if linux.binary.is_file() {
        return Ok(linux);
    }
    if windows.binary.is_file() {
        return Ok(windows);
    }

    Err(CoreError::Discovery(format!(
        "no Conan Exiles server binary under {root}; \
         expected {} or {}",
        linux.binary, windows.binary
    )))
}

#[cfg(test)]
mod tests {
    use std::fs;

    use camino::Utf8PathBuf;

    use super::*;

    fn fixture(platform: Platform) -> (tempfile::TempDir, Utf8PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let root: Utf8PathBuf = dir.path().to_path_buf().try_into().unwrap();
        let bin_dir = root.join(platform.binary_subdir());
        fs::create_dir_all(&bin_dir).unwrap();
        fs::write(bin_dir.join(platform.binary_name()), b"").unwrap();
        (dir, root)
    }

    #[test]
    fn detects_linux_install() {
        let (_g, root) = fixture(Platform::Linux);
        let l = probe(&root).unwrap();
        assert_eq!(l.platform, Platform::Linux);
    }

    #[test]
    fn detects_windows_install() {
        let (_g, root) = fixture(Platform::Windows);
        let l = probe(&root).unwrap();
        assert_eq!(l.platform, Platform::Windows);
    }

    #[test]
    fn rejects_unrelated_directory() {
        let dir = tempfile::tempdir().unwrap();
        let root: Utf8PathBuf = dir.path().to_path_buf().try_into().unwrap();
        assert!(probe(&root).is_err());
    }

    #[test]
    fn rejects_missing_directory() {
        assert!(probe(Utf8Path::new("/no/such/dir")).is_err());
    }
}
