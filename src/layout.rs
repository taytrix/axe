//! `Layout`: every well-known path inside an install root.

use camino::{Utf8Path, Utf8PathBuf};
use serde::{Deserialize, Serialize};

use crate::WORKSHOP_APPID;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    Linux,
    Windows,
}

impl Platform {
    #[must_use]
    pub fn binary_subdir(self) -> &'static str {
        match self {
            Self::Linux => "ConanSandbox/Binaries/Linux",
            Self::Windows => "ConanSandbox/Binaries/Win64",
        }
    }

    #[must_use]
    pub fn binary_name(self) -> &'static str {
        match self {
            Self::Linux => "ConanSandboxServer-Linux-Shipping",
            Self::Windows => "ConanSandboxServer.exe",
        }
    }

    #[must_use]
    pub fn config_subdir(self) -> &'static str {
        match self {
            Self::Linux => "ConanSandbox/Saved/Config/LinuxServer",
            Self::Windows => "ConanSandbox/Saved/Config/WindowsServer",
        }
    }
}

/// Resolved paths for one server install.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Layout {
    pub platform: Platform,
    pub root: Utf8PathBuf,
    pub binary: Utf8PathBuf,
    pub launcher_script: Option<Utf8PathBuf>,
    pub config_dir: Utf8PathBuf,
    pub server_settings_ini: Utf8PathBuf,
    pub engine_ini: Utf8PathBuf,
    pub game_ini: Utf8PathBuf,
    pub mods_dir: Utf8PathBuf,
    pub modlist_txt: Utf8PathBuf,
    pub workshop_content: Utf8PathBuf,
    pub workshop_acf: Utf8PathBuf,
    pub game_db: Utf8PathBuf,
    pub logs_dir: Utf8PathBuf,
}

impl Layout {
    /// Build a `Layout` for `root` on `platform` without checking existence.
    #[must_use]
    pub fn at(root: &Utf8Path, platform: Platform) -> Self {
        let bin_dir = root.join(platform.binary_subdir());
        let cfg_dir = root.join(platform.config_subdir());
        let saved = root.join("ConanSandbox/Saved");
        let steamapps = root.join("steamapps");
        let workshop = steamapps.join("workshop");

        let launcher_script = match platform {
            Platform::Linux => Some(root.join("ConanSandboxServer.sh")),
            Platform::Windows => None,
        };

        Self {
            platform,
            root: root.to_owned(),
            binary: bin_dir.join(platform.binary_name()),
            launcher_script,
            config_dir: cfg_dir.clone(),
            server_settings_ini: cfg_dir.join("ServerSettings.ini"),
            engine_ini: cfg_dir.join("Engine.ini"),
            game_ini: cfg_dir.join("Game.ini"),
            mods_dir: root.join("ConanSandbox/Mods"),
            modlist_txt: root.join("ConanSandbox/Mods/modlist.txt"),
            workshop_content: workshop.join(format!("content/{WORKSHOP_APPID}")),
            workshop_acf: workshop.join(format!("appworkshop_{WORKSHOP_APPID}.acf")),
            game_db: saved.join("game.db"),
            logs_dir: saved.join("Logs"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn linux_paths_are_resolved() {
        let layout = Layout::at(Utf8Path::new("/var/lib/conan"), Platform::Linux);
        assert_eq!(
            layout.binary.as_str(),
            "/var/lib/conan/ConanSandbox/Binaries/Linux/ConanSandboxServer-Linux-Shipping"
        );
        assert_eq!(
            layout.modlist_txt.as_str(),
            "/var/lib/conan/ConanSandbox/Mods/modlist.txt"
        );
        assert_eq!(
            layout.workshop_acf.as_str(),
            "/var/lib/conan/steamapps/workshop/appworkshop_440900.acf"
        );
        assert_eq!(
            layout.game_db.as_str(),
            "/var/lib/conan/ConanSandbox/Saved/game.db"
        );
    }

    #[test]
    fn windows_uses_win64_and_windowsserver() {
        let layout = Layout::at(Utf8Path::new("C:/srv/conan"), Platform::Windows);
        assert!(
            layout
                .binary
                .as_str()
                .ends_with("Binaries/Win64/ConanSandboxServer.exe")
        );
        assert!(layout.config_dir.as_str().ends_with("Config/WindowsServer"));
        assert!(layout.launcher_script.is_none());
    }
}
