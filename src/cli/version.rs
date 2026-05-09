use camino::Utf8Path;
use serde::Serialize;

use axe::error::ExitCode;
use crate::output::Output;

#[derive(Debug, Clone, clap::Args)]
pub struct Args {
    /// Output version as JSON.
    #[arg(long)]
    json: bool,
}

#[derive(Debug, Serialize)]
struct Version {
    version: &'static str,
}

pub fn run(args: &Args, out: Output, _config_path: &Utf8Path) -> ExitCode {
    if args.json {
        // Handled by Output::ok; just need to pass data
        out.ok(
            "version",
            &Version {
                version: env!("CARGO_PKG_VERSION"),
            },
            || {
                println!("axe {}", env!("CARGO_PKG_VERSION"));
            },
        );
    } else {
        out.ok(
            "version",
            &Version {
                version: env!("CARGO_PKG_VERSION"),
            },
            || {
                println!("axe {}", env!("CARGO_PKG_VERSION"));
            },
        );
    }
    ExitCode::Ok
}
