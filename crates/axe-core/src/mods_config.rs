//! `axe.mods.toml` — the canonical mod list.
//!
//! This is the single source of truth for which workshop items axe manages.
//! When `axe.mods.toml` is present, `modlist.txt` is generated from it.

use camino::Utf8Path;
use serde::{Deserialize, Serialize};

use crate::error::CoreError;

pub const SCHEMA: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModsConfig {
    pub schema: u32,
    #[serde(default)]
    pub mods: Vec<ModEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModEntry {
    /// Steam Workshop published file ID.
    pub id: u64,
    /// Human-readable name (cosmetic; sourced from API on first add).
    #[serde(default)]
    pub name: String,
    /// If true, a missing/broken mod blocks server start.
    #[serde(default = "default_required")]
    pub required: bool,
    /// Pin to a specific manifest checksum; `None` means latest.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pin_manifest: Option<u64>,
}

fn default_required() -> bool {
    true
}

impl ModsConfig {
    /// An empty mods config.
    #[must_use]
    pub fn empty() -> Self {
        Self {
            schema: SCHEMA,
            mods: Vec::new(),
        }
    }

    /// Load and parse an `axe.mods.toml` file.
    ///
    /// # Errors
    /// Returns [`CoreError::Config`] if the file cannot be read or parsed,
    /// or if its `schema` does not match [`SCHEMA`].
    pub fn load(path: &Utf8Path) -> Result<Self, CoreError> {
        let text = std::fs::read_to_string(path)
            .map_err(|e| CoreError::Config(format!("reading {path}: {e}")))?;
        Self::parse(&text)
    }

    /// Parse a TOML string into a [`ModsConfig`].
    ///
    /// # Errors
    /// Returns [`CoreError::Config`] if parsing fails or the `schema` field
    /// does not match [`SCHEMA`].
    pub fn parse(text: &str) -> Result<Self, CoreError> {
        let cfg: Self = toml::from_str(text)
            .map_err(|e| CoreError::Config(format!("parsing axe.mods.toml: {e}")))?;
        if cfg.schema != SCHEMA {
            return Err(CoreError::Config(format!(
                "axe.mods.toml schema = {} but axe expects {SCHEMA}",
                cfg.schema
            )));
        }
        Ok(cfg)
    }

    /// Return just the workshop IDs, in declaration order.
    #[must_use]
    pub fn ids(&self) -> Vec<u64> {
        self.mods.iter().map(|m| m.id).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_minimal() {
        let text = r#"
            schema = 1
            [[mods]]
            id = 3721090132
            name = "ModAdmin"
        "#;
        let cfg = ModsConfig::parse(text).unwrap();
        assert_eq!(cfg.mods.len(), 1);
        assert_eq!(cfg.mods[0].id, 3_721_090_132);
        assert!(cfg.mods[0].required); // default
    }

    #[test]
    fn rejects_bad_schema() {
        let text = "schema = 99\n[[mods]]\nid = 1\n";
        assert!(ModsConfig::parse(text).is_err());
    }

    #[test]
    fn empty_config_has_no_mods() {
        let cfg = ModsConfig::empty();
        assert!(cfg.mods.is_empty());
        assert!(cfg.ids().is_empty());
    }
}
