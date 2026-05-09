//! `axe.toml` — the single operator-authored config file.
//!
//! A minimal config reduces to:
//!
//! ```toml
//! schema = 1
//!
//! [server]
//! id = "my-server"
//! root = "/var/lib/conan"
//! ```
//!
//! Mods, when present, are an ordered array of workshop IDs:
//!
//! ```toml
//! [mods]
//! ids = [ 12345, 67890 ]
//! ```

use std::time::Duration;

use camino::{Utf8Path, Utf8PathBuf};
use serde::{Deserialize, Serialize};

use crate::error::Error;

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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Server {
    pub id: String,
    pub root: Utf8PathBuf,
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

/// Mod list and policy. Order in `ids` is the canonical order; it's the order
/// `modlist.txt` will be written in once `axe mods sync` lands.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Mods {
    #[serde(default)]
    pub ids: Vec<u64>,
    #[serde(default = "default_restart_on_change")]
    pub restart_on_change: bool,
}

fn default_restart_on_change() -> bool {
    true
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
                launch_args: default_launch_args(),
            },
            network: Network::default(),
            update: Update::default(),
            mods: Mods {
                ids: Vec::new(),
                restart_on_change: default_restart_on_change(),
            },
        }
    }

    /// Read and parse `axe.toml`.
    ///
    /// # Errors
    /// Returns [`Error::Config`] on read or parse failure, or if `schema` does
    /// not match [`SCHEMA`].
    pub fn load(path: &Utf8Path) -> Result<Self, Error> {
        let text = std::fs::read_to_string(path)
            .map_err(|e| Error::Config(format!("reading {path}: {e}")))?;
        Self::parse(&text)
    }

    /// Parse a TOML string into a [`Config`].
    ///
    /// # Errors
    /// Returns [`Error::Config`] on parse failure or schema mismatch.
    pub fn parse(text: &str) -> Result<Self, Error> {
        let cfg: Self =
            toml::from_str(text).map_err(|e| Error::Config(format!("parsing axe.toml: {e}")))?;
        if cfg.schema != SCHEMA {
            return Err(Error::Config(format!(
                "axe.toml schema = {} but axe expects {SCHEMA}",
                cfg.schema
            )));
        }
        Ok(cfg)
    }

    /// Serialize the config to a TOML string.
    ///
    /// # Errors
    /// Returns [`Error::Config`] if the underlying TOML serializer fails.
    pub fn to_toml(&self) -> Result<String, Error> {
        toml::to_string_pretty(self)
            .map_err(|e| Error::Config(format!("serializing axe.toml: {e}")))
    }

    /// Atomically write the config to `path`.
    ///
    /// # Errors
    /// Returns [`Error::Filesystem`] on any write failure or [`Error::Config`]
    /// on serialization failure.
    pub fn save(&self, path: &Utf8Path) -> Result<(), Error> {
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
        let cfg = Config::from_root("test-server", "/var/lib/conan".into());
        let text = cfg.to_toml().unwrap();
        let parsed = Config::parse(&text).unwrap();
        assert_eq!(parsed.server.id, "test-server");
        assert_eq!(parsed.server.root.as_str(), "/var/lib/conan");
        assert_eq!(parsed.network.game_port, 7777);
        assert_eq!(parsed.update.poll_interval, Duration::from_secs(300));
        assert!(parsed.mods.ids.is_empty());
    }

    #[test]
    fn parses_mods_array() {
        let text = r#"
            schema = 1
            [server]
            id = "x"
            root = "/tmp"
            [mods]
            ids = [11, 22, 33]
        "#;
        let cfg = Config::parse(text).unwrap();
        assert_eq!(cfg.mods.ids, vec![11, 22, 33]);
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
