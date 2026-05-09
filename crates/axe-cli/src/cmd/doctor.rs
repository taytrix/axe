use camino::Utf8Path;
use owo_colors::OwoColorize;

use axe_core::doctor::{self, Level};
use axe_core::error::ExitCode;
use axe_core::{Config, probe};

use crate::output::Output;

#[derive(Debug, Clone, clap::Args)]
pub struct Args {}

pub fn run(_args: &Args, out: Output, config_path: &Utf8Path) -> ExitCode {
    let config = match Config::load(config_path) {
        Ok(c) => c,
        Err(e) => return out.fail("doctor", e.exit_code(), &e.to_string()),
    };

    let layout = match probe::probe(&config.server.root) {
        Ok(l) => l,
        Err(e) => return out.fail("doctor", e.exit_code(), &e.to_string()),
    };

    let report = doctor::run(&config, &layout);

    out.ok("doctor", &report, || {
        for f in &report.findings {
            let label = match f.level {
                Level::Ok => "ok   ".green().bold().to_string(),
                Level::Warn => "warn ".yellow().bold().to_string(),
                Level::Error => "error".red().bold().to_string(),
            };
            println!("{label} {:>8}  {}", f.topic.dimmed(), f.message);
        }
    });

    match report.worst() {
        Level::Error => ExitCode::Discovery,
        Level::Warn | Level::Ok => ExitCode::Ok,
    }
}
