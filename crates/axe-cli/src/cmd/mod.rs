pub mod doctor;
pub mod init;
pub mod version;

use camino::Utf8PathBuf;

/// Resolve the path of `axe.toml` from CLI flags / cwd, without reading it.
#[must_use]
pub fn config_path(arg: Option<&str>) -> Utf8PathBuf {
    arg.map_or_else(|| Utf8PathBuf::from("axe.toml"), Utf8PathBuf::from)
}
