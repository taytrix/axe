//! axe-core: pure-Rust core. No I/O lives here except deliberate filesystem
//! probes (read-only) used by `axe doctor` and `axe init --probe`.

#![forbid(unsafe_code)]
#![deny(rust_2018_idioms, clippy::pedantic)]
#![allow(clippy::module_name_repetitions)]

pub mod config;
pub mod context;
pub mod doctor;
pub mod error;
pub mod fs;
pub mod layout;
pub mod mods_config;
pub mod probe;

pub use config::Config;
pub use context::Context;
pub use error::{CoreError, ExitCode};
pub use fs::atomic_write;
pub use layout::{Layout, Platform};
pub use mods_config::ModsConfig;

/// Steam appid of the dedicated server depot.
pub const SERVER_APPID: u32 = 443_030;

/// Steam appid of the Conan Exiles client (which owns Workshop content).
pub const WORKSHOP_APPID: u32 = 440_900;
