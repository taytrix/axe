//! Thin `Context`: the three things every read-command needs after init.
//!
//! Commands that operate on an existing install load a `Context` instead of
//! repeating "parse config → probe layout → handle errors" themselves.

use camino::Utf8PathBuf;

use crate::error::CoreError;
use crate::layout::Layout;
use crate::{Config, probe};

/// Everything a read-command needs, resolved from one `axe.toml`.
#[derive(Debug, Clone)]
pub struct Context {
    pub config_path: Utf8PathBuf,
    pub config: Config,
    pub layout: Layout,
}

impl Context {
    /// Load `axe.toml`, probe the install root, return a fully-resolved context.
    ///
    /// # Errors
    /// Returns [`CoreError::Config`] if the config file cannot be read or parsed,
    /// or [`CoreError::Discovery`] if the install root cannot be probed.
    pub fn load(config_path: &Utf8PathBuf) -> Result<Self, CoreError> {
        let config = Config::load(config_path)?;
        let layout = probe::probe(&config.server.root)?;
        Ok(Self {
            config_path: config_path.clone(),
            config,
            layout,
        })
    }
}
