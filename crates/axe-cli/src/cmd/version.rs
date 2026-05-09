use camino::Utf8Path;
use serde::Serialize;

use axe_core::error::ExitCode;

use crate::output::Output;

#[derive(Debug, Clone, clap::Args)]
pub struct Args {}

#[derive(Debug, Serialize)]
struct Version {
    version: &'static str,
}

pub fn run(_args: &Args, out: Output, _config_path: &Utf8Path) -> ExitCode {
    out.ok(
        "version",
        &Version {
            version: env!("CARGO_PKG_VERSION"),
        },
        || {
            println!("axe {}", env!("CARGO_PKG_VERSION"));
        },
    );
    ExitCode::Ok
}
