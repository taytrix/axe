//! axe: by this axe I rule.
//!
//! A small Conan Exiles Enhanced dedicated-server CLI. The library surface
//! exists mainly so tests can drive each module without going through `main`.

#![forbid(unsafe_code)]
#![deny(rust_2018_idioms, clippy::pedantic)]
#![allow(clippy::module_name_repetitions)]

pub mod acf;
pub mod config;
pub mod doctor;
pub mod error;
pub mod fs;
pub mod layout;
pub mod probe;
pub mod workshop_api;

pub use config::Config;
pub use error::{Error, ExitCode};
pub use layout::{Layout, Platform};

/// Steam appid of the Conan Exiles dedicated-server depot.
pub const SERVER_APPID: u32 = 443_030;

/// Steam appid of the Conan Exiles client (which owns Workshop content).
pub const WORKSHOP_APPID: u32 = 440_900;

/// Resolved view of an install: config + filesystem layout.
#[derive(Debug, Clone)]
pub struct Context {
    pub config_path: camino::Utf8PathBuf,
    pub config: Config,
    pub layout: Layout,
}

impl Context {
    /// Load `axe.toml`, probe the install root, return a fully-resolved context.
    ///
    /// # Errors
    /// Returns [`Error::Config`] if the config file cannot be read or parsed,
    /// or [`Error::Discovery`] if the install root cannot be probed.
    pub fn load(config_path: &camino::Utf8Path) -> Result<Self, Error> {
        let config = Config::load(config_path)?;
        let layout = probe::probe(&config.server.root)?;
        Ok(Self {
            config_path: config_path.to_owned(),
            config,
            layout,
        })
    }
}
