//! axe — by this axe I rule.

#![forbid(unsafe_code)]
#![deny(rust_2018_idioms, clippy::pedantic)]
#![allow(clippy::module_name_repetitions)]

use std::process::ExitCode as OsExit;

use axe_core::error::ExitCode;
use clap::{Parser, Subcommand};

mod cmd;
mod output;

use crate::output::Output;

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

    /// Path to axe.toml (default: ./axe.toml).
    #[arg(long, global = true, value_name = "PATH")]
    config: Option<String>,

    /// Disable terminal colors.
    #[arg(long, global = true)]
    no_color: bool,

    /// Assume "yes" for any confirmation prompt.
    #[arg(short = 'y', long, global = true)]
    yes: bool,

    #[command(subcommand)]
    command: Cmd,
}

#[derive(Debug, Subcommand)]
enum Cmd {
    /// Write a starter axe.toml in the current directory.
    Init(cmd::init::Args),
    /// Run a series of read-only sanity checks against the install.
    Doctor(cmd::doctor::Args),
}

fn main() -> OsExit {
    let cli = Cli::parse();
    init_tracing();
    apply_color_choice(cli.no_color);

    let out = Output {
        json: cli.json,
        quiet: cli.quiet,
    };
    let config_path = cmd::config_path(cli.config.as_deref());

    let exit: ExitCode = match &cli.command {
        Cmd::Init(args) => cmd::init::run(args, out, &config_path),
        Cmd::Doctor(args) => cmd::doctor::run(args, out, &config_path),
    };

    OsExit::from(u8::try_from(exit.as_i32().clamp(0, 255)).unwrap_or(1))
}

fn init_tracing() {
    use tracing_subscriber::EnvFilter;
    use tracing_subscriber::fmt;

    let filter = EnvFilter::try_from_env("AXE_LOG").unwrap_or_else(|_| EnvFilter::new("warn"));
    let _ = fmt().with_env_filter(filter).with_target(false).try_init();
}

fn apply_color_choice(no_color: bool) {
    let disable = no_color
        || std::env::var_os("NO_COLOR").is_some()
        || !std::io::IsTerminal::is_terminal(&std::io::stdout());
    if disable {
        owo_colors::set_override(false);
    }
}
