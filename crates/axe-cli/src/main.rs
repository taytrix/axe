//! axe — by this axe I rule.

#![forbid(unsafe_code)]
#![deny(rust_2018_idioms, clippy::pedantic)]
#![allow(clippy::module_name_repetitions)]

use std::process::ExitCode;

use axe_core::error::ExitCode as AxeExit;
use clap::Parser;

#[derive(Debug, Parser)]
#[command(
    name = "axe",
    version,
    about = "Conan Exiles Enhanced dedicated-server CLI",
    long_about = None,
    propagate_version = true,
)]
#[allow(clippy::struct_excessive_bools)] // global flags; clap derive
struct Cli {
    /// Emit JSON envelopes on stdout instead of human-readable output.
    #[arg(long, global = true)]
    json: bool,

    /// Suppress non-error output.
    #[arg(long, global = true)]
    quiet: bool,

    /// Override server install root (otherwise read from axe.toml or current dir).
    #[arg(long, global = true, value_name = "PATH")]
    root: Option<String>,

    /// Path to axe.toml (default: ./axe.toml).
    #[arg(long, global = true, value_name = "PATH")]
    config: Option<String>,

    /// Disable terminal colors.
    #[arg(long, global = true)]
    no_color: bool,

    /// Assume "yes" for any confirmation prompt.
    #[arg(short = 'y', long, global = true)]
    yes: bool,
}

fn main() -> ExitCode {
    let _cli = Cli::parse();
    init_tracing();
    // Subcommand dispatch lands in the next PR; for the bootstrap commit
    // we just confirm the binary builds and parses flags.
    ExitCode::from(u8::try_from(AxeExit::Ok.as_i32()).unwrap_or(0))
}

fn init_tracing() {
    use tracing_subscriber::EnvFilter;
    use tracing_subscriber::fmt;

    let filter = EnvFilter::try_from_env("AXE_LOG").unwrap_or_else(|_| EnvFilter::new("info"));
    let _ = fmt().with_env_filter(filter).with_target(false).try_init();
}
