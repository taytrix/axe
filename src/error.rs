use thiserror::Error;

/// Categorical exit codes used across the CLI surface. Stable across patch
/// versions; v0.2 may narrow them with a `kind` taxonomy on the JSON envelope.
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
pub enum Error {
    #[error("configuration error: {0}")]
    Config(String),
    #[error("discovery error: {0}")]
    Discovery(String),
    #[error("filesystem error: {0}")]
    Filesystem(String),
    #[error("workshop API error: {0}")]
    WorkshopApi(String),
    #[error("ACF parse error: {0}")]
    AcfParse(String),
}

impl Error {
    #[must_use]
    pub fn exit_code(&self) -> ExitCode {
        match self {
            Self::Config(_) => ExitCode::Config,
            Self::Discovery(_) | Self::AcfParse(_) => ExitCode::Discovery,
            Self::Filesystem(_) => ExitCode::Filesystem,
            Self::WorkshopApi(_) => ExitCode::Network,
        }
    }
}
