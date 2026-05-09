use camino::{Utf8Path, Utf8PathBuf};
use owo_colors::OwoColorize;
use serde::Serialize;

use axe_core::error::ExitCode;
use axe_core::{Config, probe};

use crate::output::Output;

#[derive(Debug, Clone, clap::Args)]
pub struct Args {
    /// Probe `path` (or current dir) for an existing install and pre-fill paths.
    #[arg(long)]
    pub probe: bool,

    /// Path to probe; only meaningful with `--probe`. Defaults to the current dir.
    pub path: Option<Utf8PathBuf>,

    /// Skip writing axe.toml; only print what would be written.
    #[arg(long)]
    pub dry_run: bool,
}

#[derive(Debug, Serialize)]
struct Wrote<'a> {
    config_path: &'a Utf8Path,
    server_id: &'a str,
    root: &'a Utf8Path,
    platform: Option<axe_core::Platform>,
}

pub fn run(args: &Args, out: Output, config_path: &Utf8Path) -> ExitCode {
    let cwd = match std::env::current_dir() {
        Ok(p) => match Utf8PathBuf::from_path_buf(p) {
            Ok(u) => u,
            Err(p) => {
                return out.fail(
                    "init",
                    ExitCode::Filesystem,
                    &format!("cwd is not valid UTF-8: {}", p.display()),
                );
            }
        },
        Err(e) => return out.fail("init", ExitCode::Filesystem, &format!("cwd: {e}")),
    };

    let target = canonicalize(args.path.as_deref().unwrap_or(&cwd));

    let (config, platform) = if args.probe {
        match probe::probe(&target) {
            Ok(layout) => {
                let id = derive_id(&layout.root);
                (
                    Config::from_root(id, layout.root.clone()),
                    Some(layout.platform),
                )
            }
            Err(e) => return out.fail("init", e.exit_code(), &e.to_string()),
        }
    } else {
        let id = derive_id(&target);
        (Config::from_root(id, target), None)
    };

    if args.dry_run {
        match config.to_toml() {
            Ok(text) => {
                out.ok(
                    "init",
                    &Wrote {
                        config_path,
                        server_id: &config.server.id,
                        root: &config.server.root,
                        platform,
                    },
                    || {
                        println!("{}", "# would write to axe.toml:".dimmed());
                        println!("{text}");
                    },
                );
                return ExitCode::Ok;
            }
            Err(e) => return out.fail("init", e.exit_code(), &e.to_string()),
        }
    }

    if config_path.exists() {
        return out.fail(
            "init",
            ExitCode::Config,
            &format!("{config_path} already exists; refusing to overwrite"),
        );
    }
    if let Err(e) = config.save(config_path) {
        return out.fail("init", e.exit_code(), &e.to_string());
    }

    out.ok(
        "init",
        &Wrote {
            config_path,
            server_id: &config.server.id,
            root: &config.server.root,
            platform,
        },
        || {
            println!("{} {}", "wrote".green().bold(), config_path);
            println!("  {} {}", "server.id =".dimmed(), &config.server.id);
            println!("  {} {}", "server.root =".dimmed(), &config.server.root);
            if let Some(p) = platform {
                println!("  {} {p:?}", "platform =".dimmed());
            }
        },
    );
    ExitCode::Ok
}

fn derive_id(root: &Utf8Path) -> String {
    root.file_name()
        .filter(|s| !s.is_empty())
        .unwrap_or("conan")
        .to_owned()
}

/// Resolve symlinks and `.`/`..` segments. Falls back to the input on any
/// failure -- the doctor will surface real problems separately.
fn canonicalize(path: &Utf8Path) -> Utf8PathBuf {
    std::fs::canonicalize(path)
        .ok()
        .and_then(|p| Utf8PathBuf::from_path_buf(p).ok())
        .unwrap_or_else(|| path.to_owned())
}
