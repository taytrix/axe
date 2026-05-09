//! `axe.toml` — operator-authored configuration.
//!
//! Defaults are deliberately reasonable so a minimal `axe.toml` reduces to:
//!
//! ```toml
//! [server]
//! id = "my-server"
//! root = "/var/lib/conan"
//! ```

use std::time::Duration;

use camino::{Utf8Path, Utf8PathBuf};
use serde::{Deserialize, Serialize};

use crate::error::CoreError;

pub const SCHEMA: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub schema: u32,
    pub server: Server,
    #[serde(default)]
    pub network: Network,
    #[serde(default)]
    pub update: Update,
    #[serde(default)]
    pub mods: Mods,
    #[serde(default)]
    pub restart: Restart,
    #[serde(default)]
    pub notify: Notify,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Server {
    pub id: String,
    pub root: Utf8PathBuf,
    /// Path to the server binary, relative to `root` or absolute. Auto-resolved
    /// during probe; operators rarely set this by hand.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub binary: Option<Utf8PathBuf>,
    #[serde(default = "default_launch_args")]
    pub launch_args: Vec<String>,
}

fn default_launch_args() -> Vec<String> {
    vec!["ConanSandbox".into(), "-log".into()]
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Network {
    pub game_port: u16,
    pub steam_port: u16,
    pub rcon_port: u16,
}

impl Default for Network {
    fn default() -> Self {
        Self {
            game_port: 7777,
            steam_port: 7778,
            rcon_port: 25575,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Update {
    #[serde(with = "humantime_serde")]
    pub poll_interval: Duration,
    pub branch: String,
}

impl Default for Update {
    fn default() -> Self {
        Self {
            poll_interval: Duration::from_secs(300),
            branch: "public".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Mods {
    pub file: Utf8PathBuf,
    pub restart_on_change: bool,
}

impl Default for Mods {
    fn default() -> Self {
        Self {
            file: "axe.mods.toml".into(),
            restart_on_change: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Restart {
    /// Local-time `HH:MM`; `None` disables the daily restart.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub daily_at: Option<String>,
    #[serde(default = "default_warn_minutes")]
    pub warn_minutes: Vec<u32>,
}

impl Default for Restart {
    fn default() -> Self {
        Self {
            daily_at: None,
            warn_minutes: default_warn_minutes(),
        }
    }
}

fn default_warn_minutes() -> Vec<u32> {
    vec![15, 5, 1]
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Notify {
    #[serde(default)]
    pub webhooks: Vec<String>,
    #[serde(default = "default_events")]
    pub on_event: Vec<String>,
}

impl Default for Notify {
    fn default() -> Self {
        Self {
            webhooks: Vec::new(),
            on_event: default_events(),
        }
    }
}

fn default_events() -> Vec<String> {
    vec![
        "update_applied".into(),
        "mods_refreshed".into(),
        "restart_started".into(),
        "server_ready".into(),
        "crash".into(),
    ]
}

impl Config {
    /// Build a minimal `Config` from a probed install root.
    #[must_use]
    pub fn from_root(id: impl Into<String>, root: Utf8PathBuf) -> Self {
        Self {
            schema: SCHEMA,
            server: Server {
                id: id.into(),
                root,
                binary: None,
                launch_args: default_launch_args(),
            },
            network: Network::default(),
            update: Update::default(),
            mods: Mods::default(),
            restart: Restart::default(),
            notify: Notify::default(),
        }
    }

    /// Read and parse `axe.toml`. Wraps both I/O and parse errors in [`CoreError::Config`].
    ///
    /// # Errors
    /// Returns [`CoreError::Config`] if the file cannot be read or parsed, or
    /// if its `schema` does not match [`SCHEMA`].
    pub fn load(path: &Utf8Path) -> Result<Self, CoreError> {
        let text = std::fs::read_to_string(path)
            .map_err(|e| CoreError::Config(format!("reading {path}: {e}")))?;
        Self::parse(&text)
    }

    /// Parse a TOML string into a [`Config`].
    ///
    /// # Errors
    /// Returns [`CoreError::Config`] if parsing fails or the `schema` field
    /// does not match [`SCHEMA`].
    pub fn parse(text: &str) -> Result<Self, CoreError> {
        let cfg: Self = toml::from_str(text)
            .map_err(|e| CoreError::Config(format!("parsing axe.toml: {e}")))?;
        if cfg.schema != SCHEMA {
            return Err(CoreError::Config(format!(
                "axe.toml schema = {} but axe expects {SCHEMA}",
                cfg.schema
            )));
        }
        Ok(cfg)
    }

    /// Serialize the config to a TOML string.
    ///
    /// # Errors
    /// Returns a `CoreError::Config` if the underlying TOML serializer fails.
    pub fn to_toml(&self) -> Result<String, CoreError> {
        toml::to_string_pretty(self)
            .map_err(|e| CoreError::Config(format!("serializing axe.toml: {e}")))
    }

    /// Atomically write the config to `path` (write tmp → rename).
    ///
    /// # Errors
    /// Returns a `CoreError::Filesystem` on any filesystem write failure, or
    /// a `CoreError::Config` if serialization fails.
    pub fn save(&self, path: &Utf8Path) -> Result<(), CoreError> {
        let body = self.to_toml()?;
        crate::fs::atomic_write(path, body.as_bytes())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_minimal() {
        let cfg = Config::from_root("stygia-prime", "/var/lib/conan".into());
        let text = cfg.to_toml().unwrap();
        let parsed = Config::parse(&text).unwrap();
        assert_eq!(parsed.server.id, "stygia-prime");
        assert_eq!(parsed.server.root.as_str(), "/var/lib/conan");
        assert_eq!(parsed.network.game_port, 7777);
        assert_eq!(parsed.update.poll_interval, Duration::from_secs(300));
    }

    #[test]
    fn rejects_unknown_schema() {
        let text = r#"
            schema = 99
            [server]
            id = "x"
            root = "/tmp"
        "#;
        assert!(Config::parse(text).is_err());
    }
}
