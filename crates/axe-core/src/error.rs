use thiserror::Error;

/// Categorical exit codes used across the CLI surface.
///
/// These map to the table in the spec (§3 / §6 / §7). They are stable across
/// patch versions; v0.2 will narrow them with a `kind` taxonomy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(i32)]
pub enum ExitCode {
    Ok = 0,
    Generic = 1,
    Misuse = 2,
    Config = 10,
    Discovery = 11,
    Network = 20,
    Lifecycle = 30,
    Filesystem = 40,
}

impl ExitCode {
    #[must_use]
    pub fn as_i32(self) -> i32 {
        self as i32
    }
}

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("configuration error: {0}")]
    Config(String),
    #[error("discovery error: {0}")]
    Discovery(String),
    #[error("filesystem error: {0}")]
    Filesystem(String),
}

impl CoreError {
    #[must_use]
    pub fn exit_code(&self) -> ExitCode {
        match self {
            Self::Config(_) => ExitCode::Config,
            Self::Discovery(_) => ExitCode::Discovery,
            Self::Filesystem(_) => ExitCode::Filesystem,
        }
    }
}
