//! `axe doctor`: a list of small read-only checks against a [`Layout`].
//!
//! Findings are intentionally tiny: a level, a topic, a one-line message.
//! Anything richer can wait for the v0.2 agent contract.

use std::fmt;

use serde::{Deserialize, Serialize};

use crate::Config;
use crate::layout::{Layout, Platform};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Ok,
    Warn,
    Error,
}

impl fmt::Display for Level {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Ok => "ok",
            Self::Warn => "warn",
            Self::Error => "error",
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Finding {
    pub level: Level,
    pub topic: String,
    pub message: String,
}

impl Finding {
    fn ok(topic: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            level: Level::Ok,
            topic: topic.into(),
            message: message.into(),
        }
    }
    fn warn(topic: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            level: Level::Warn,
            topic: topic.into(),
            message: message.into(),
        }
    }
    fn error(topic: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            level: Level::Error,
            topic: topic.into(),
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Report {
    pub findings: Vec<Finding>,
}

impl Report {
    #[must_use]
    pub fn worst(&self) -> Level {
        self.findings
            .iter()
            .map(|f| f.level)
            .max_by_key(|l| match l {
                Level::Ok => 0,
                Level::Warn => 1,
                Level::Error => 2,
            })
            .unwrap_or(Level::Ok)
    }
}

/// Run all v0.1 checks against `layout` (and the config it was built from).
///
/// The checks are deliberately read-only: existence, executable bit, and
/// case-sensitivity sanity (Linux's lowercase `game.db` rule).
#[must_use]
pub fn run(config: &Config, layout: &Layout) -> Report {
    let mut findings = Vec::new();

    findings.push(check_root(layout));
    findings.push(check_binary(layout));
    findings.push(check_config_dir(layout));
    findings.extend(check_inis(layout));
    findings.push(check_modlist(layout));
    findings.push(check_workshop(layout));
    findings.push(check_game_db(layout));
    findings.push(check_logs_dir(layout));
    findings.push(check_server_id(config));

    Report { findings }
}

fn check_root(layout: &Layout) -> Finding {
    if layout.root.is_dir() {
        Finding::ok("root", format!("{}", layout.root))
    } else {
        Finding::error("root", format!("{} is not a directory", layout.root))
    }
}

fn check_binary(layout: &Layout) -> Finding {
    let bin = &layout.binary;
    if !bin.is_file() {
        return Finding::error("binary", format!("missing {bin}"));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        match std::fs::metadata(bin.as_std_path()) {
            Ok(m) if m.permissions().mode() & 0o111 != 0 => Finding::ok(
                "binary",
                format!("{} (executable)", bin.file_name().unwrap_or("?")),
            ),
            Ok(_) => Finding::warn("binary", format!("{bin} is not executable")),
            Err(e) => Finding::warn("binary", format!("stat {bin}: {e}")),
        }
    }
    #[cfg(not(unix))]
    {
        Finding::ok("binary", format!("{}", bin.file_name().unwrap_or("?")))
    }
}

fn check_config_dir(layout: &Layout) -> Finding {
    if layout.config_dir.is_dir() {
        Finding::ok("config", format!("{}", layout.config_dir))
    } else {
        Finding::warn(
            "config",
            format!(
                "{} not present yet (server has not generated configs)",
                layout.config_dir
            ),
        )
    }
}

fn check_inis(layout: &Layout) -> Vec<Finding> {
    [
        ("ServerSettings.ini", &layout.server_settings_ini),
        ("Engine.ini", &layout.engine_ini),
        ("Game.ini", &layout.game_ini),
    ]
    .into_iter()
    .map(|(label, path)| {
        if path.is_file() {
            Finding::ok("ini", format!("{label} present"))
        } else {
            Finding::warn("ini", format!("{label} not present at {path}"))
        }
    })
    .collect()
}

fn check_modlist(layout: &Layout) -> Finding {
    let path = &layout.modlist_txt;
    match std::fs::read_to_string(path.as_std_path()) {
        Ok(s) => {
            let n = s.lines().filter(|l| !l.trim().is_empty()).count();
            Finding::ok(
                "modlist",
                format!("{n} entr{} in {path}", if n == 1 { "y" } else { "ies" }),
            )
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            Finding::warn("modlist", format!("{path} not present (no mods enabled)"))
        }
        Err(e) => Finding::warn("modlist", format!("read {path}: {e}")),
    }
}

fn check_workshop(layout: &Layout) -> Finding {
    if layout.workshop_acf.is_file() {
        Finding::ok("workshop", format!("{} present", layout.workshop_acf))
    } else {
        Finding::warn(
            "workshop",
            format!(
                "{} not present (mods will populate it on first download)",
                layout.workshop_acf
            ),
        )
    }
}

fn check_game_db(layout: &Layout) -> Finding {
    let path = &layout.game_db;
    if path.is_file() {
        return Finding::ok("game.db", format!("{path}"));
    }
    if layout.platform != Platform::Linux {
        return Finding::warn("game.db", format!("{path} not present yet"));
    }
    // Linux is case-sensitive; warn if a wrongly-cased copy is sitting nearby.
    let saved = layout.root.join("ConanSandbox/Saved");
    let Ok(entries) = std::fs::read_dir(saved.as_std_path()) else {
        return Finding::warn("game.db", format!("{path} not present yet"));
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.eq_ignore_ascii_case("game.db") && name != "game.db" {
            return Finding::error(
                "game.db",
                format!("found {name} but Linux requires lowercase 'game.db'"),
            );
        }
    }
    Finding::warn("game.db", format!("{path} not present yet"))
}

fn check_logs_dir(layout: &Layout) -> Finding {
    if layout.logs_dir.is_dir() {
        Finding::ok("logs", format!("{}", layout.logs_dir))
    } else {
        Finding::warn("logs", format!("{} not present yet", layout.logs_dir))
    }
}

fn check_server_id(config: &Config) -> Finding {
    if config.server.id.trim().is_empty() {
        Finding::error("server.id", "axe.toml [server] id is empty")
    } else {
        Finding::ok("server.id", config.server.id.clone())
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use camino::Utf8PathBuf;

    use super::*;
    use crate::layout::Layout;

    fn empty_install(platform: Platform) -> (tempfile::TempDir, Utf8PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let root: Utf8PathBuf = dir.path().to_path_buf().try_into().unwrap();
        let bin_dir = root.join(platform.binary_subdir());
        fs::create_dir_all(&bin_dir).unwrap();
        let bin = bin_dir.join(platform.binary_name());
        fs::write(&bin, b"").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut p = fs::metadata(&bin).unwrap().permissions();
            p.set_mode(0o755);
            fs::set_permissions(&bin, p).unwrap();
        }
        (dir, root)
    }

    #[test]
    fn fresh_linux_install_yields_warnings_only() {
        let (_g, root) = empty_install(Platform::Linux);
        let cfg = Config::from_root("test", root.clone());
        let layout = Layout::at(&root, Platform::Linux);
        let report = run(&cfg, &layout);
        assert_ne!(report.worst(), Level::Error);
    }

    #[test]
    fn detects_uppercase_game_db_on_linux() {
        let (_g, root) = empty_install(Platform::Linux);
        fs::create_dir_all(root.join("ConanSandbox/Saved").as_std_path()).unwrap();
        fs::write(root.join("ConanSandbox/Saved/Game.db").as_std_path(), b"").unwrap();
        let cfg = Config::from_root("test", root.clone());
        let layout = Layout::at(&root, Platform::Linux);
        let report = run(&cfg, &layout);
        assert!(
            report
                .findings
                .iter()
                .any(|f| f.topic == "game.db" && f.level == Level::Error)
        );
    }
}
