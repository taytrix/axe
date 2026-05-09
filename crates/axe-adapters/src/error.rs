use thiserror::Error;

#[derive(Debug, Error)]
pub enum AdapterError {
    #[error("ACF parse error: {0}")]
    AcfParse(String),
    #[error("workshop API error: {0}")]
    WorkshopApi(String),
    #[error("steamcmd error: {0}")]
    Steamcmd(String),
    #[error("RCON error: {0}")]
    Rcon(String),
    #[error("host error: {0}")]
    Host(String),
    #[error("INI read error: {0}")]
    IniRead(String),
}
