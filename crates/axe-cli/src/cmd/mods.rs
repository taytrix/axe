use camino::Utf8Path;
use owo_colors::OwoColorize;
use serde::Serialize;

use axe_adapters::acf;
use axe_adapters::workshop_api;
use axe_core::Context;
use axe_core::error::ExitCode;

use crate::output::Output;

#[derive(Debug, Clone, clap::Args)]
#[command(about = "Manage the canonical mod list")]
pub struct Args {
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Clone, clap::Subcommand)]
pub enum Command {
    /// Show the mod list from axe.mods.toml.
    List,
    /// Compare installed mods against Steam Workshop; report stale/missing.
    Check,
}

#[derive(Debug, Serialize)]
struct ModInfo {
    id: u64,
    name: String,
    required: bool,
    pin_manifest: Option<u64>,
}

#[derive(Debug, Serialize)]
struct CheckResult {
    fresh: Vec<ModStatus>,
    stale: Vec<ModStatus>,
    missing: Vec<u64>,
    unmanaged: Vec<u64>,
}

#[derive(Debug, Clone, Serialize)]
struct ModStatus {
    id: u64,
    name: String,
    installed_time: i64,
    latest_time: i64,
}

pub fn run(args: &Args, out: Output, config_path: &Utf8Path) -> ExitCode {
    match &args.command {
        Command::List => run_list(out, config_path),
        Command::Check => run_check(out, config_path),
    }
}

fn run_list(out: Output, config_path: &Utf8Path) -> ExitCode {
    let ctx = match Context::load(&config_path.into()) {
        Ok(c) => c,
        Err(e) => return out.fail("mods list", e.exit_code(), &e.to_string()),
    };

    let mods_path = ctx.config.server.root.join(&ctx.config.mods.file);
    let mods_cfg = match axe_core::ModsConfig::load(&mods_path) {
        Ok(c) => c,
        Err(e) => return out.fail("mods list", ExitCode::Config, &e.to_string()),
    };

    let items: Vec<ModInfo> = mods_cfg
        .mods
        .iter()
        .map(|m| ModInfo {
            id: m.id,
            name: m.name.clone(),
            required: m.required,
            pin_manifest: m.pin_manifest,
        })
        .collect();

    out.ok("mods list", &items, || {
        if items.is_empty() {
            println!("no mods in {mods_path}");
            return;
        }
        println!("{mods_path} ({} mods):", items.len());
        for m in &items {
            let pin = m
                .pin_manifest
                .map(|p| format!(" pinned={p}"))
                .unwrap_or_default();
            let req = if m.required { "" } else { " optional" };
            println!("  {} {}{req}{pin}", m.id, m.name.dimmed());
        }
    });

    ExitCode::Ok
}

fn run_check(out: Output, config_path: &Utf8Path) -> ExitCode {
    let ctx = match Context::load(&config_path.into()) {
        Ok(c) => c,
        Err(e) => return out.fail("mods check", e.exit_code(), &e.to_string()),
    };

    let mods_path = ctx.config.server.root.join(&ctx.config.mods.file);
    let mods_cfg = match axe_core::ModsConfig::load(&mods_path) {
        Ok(c) => c,
        Err(e) => return out.fail("mods check", ExitCode::Config, &e.to_string()),
    };

    if mods_cfg.mods.is_empty() {
        out.ok(
            "mods check",
            &CheckResult {
                fresh: vec![],
                stale: vec![],
                missing: vec![],
                unmanaged: vec![],
            },
            || println!("no mods configured"),
        );
        return ExitCode::Ok;
    }

    let acf = read_acf(&ctx);
    let (api_map, name_map) = fetch_upstream(&mods_cfg);

    let (fresh, stale, missing) = classify_mods(&mods_cfg, &acf, &api_map, &name_map);
    let unmanaged = find_unmanaged(&mods_cfg, &acf);

    let has_stale = !stale.is_empty() || !missing.is_empty();

    out.ok(
        "mods check",
        &CheckResult {
            fresh: fresh.clone(),
            stale: stale.clone(),
            missing: missing.clone(),
            unmanaged: unmanaged.clone(),
        },
        || {
            for m in &fresh {
                println!("{} {} ({})", "fresh ".green(), m.name, m.id);
            }
            for m in &stale {
                let inst = fmt_date(m.installed_time);
                let lat = fmt_date(m.latest_time);
                println!(
                    "{} {} ({}) updated {inst} -> {lat}",
                    "stale ".yellow().bold(),
                    m.name,
                    m.id,
                );
            }
            for id in &missing {
                println!("{} {id}", "missing ".red().bold());
            }
            for id in &unmanaged {
                println!(
                    "{} {id} (in ACF, not in axe.mods.toml)",
                    "unmanaged".dimmed()
                );
            }
        },
    );

    if has_stale {
        ExitCode::Generic
    } else {
        ExitCode::Ok
    }
}

fn read_acf(ctx: &Context) -> acf::AcfFile {
    match std::fs::read_to_string(ctx.layout.workshop_acf.as_std_path()) {
        Ok(text) => acf::parse(&text).unwrap_or_else(|_| acf::AcfFile {
            mods: std::collections::HashMap::new(),
        }),
        Err(_) => acf::AcfFile {
            mods: std::collections::HashMap::new(),
        },
    }
}

fn fetch_upstream(
    mods_cfg: &axe_core::ModsConfig,
) -> (
    std::collections::HashMap<u64, i64>,
    std::collections::HashMap<u64, String>,
) {
    let ids = mods_cfg.ids();
    let api_items = match workshop_api::get_published_file_details(&ids) {
        Ok(items) => items,
        Err(e) => {
            tracing::warn!("workshop API unreachable: {e}; using ACF latest_* only");
            vec![]
        }
    };

    let api_map: std::collections::HashMap<u64, i64> = api_items
        .iter()
        .map(|i| (i.publishedfileid, i.time_updated))
        .collect();

    let name_map: std::collections::HashMap<u64, String> = api_items
        .iter()
        .map(|i| (i.publishedfileid, i.title.clone()))
        .collect();

    (api_map, name_map)
}

fn classify_mods(
    mods_cfg: &axe_core::ModsConfig,
    acf: &acf::AcfFile,
    api_map: &std::collections::HashMap<u64, i64>,
    name_map: &std::collections::HashMap<u64, String>,
) -> (Vec<ModStatus>, Vec<ModStatus>, Vec<u64>) {
    let mut fresh = vec![];
    let mut stale = vec![];
    let mut missing = vec![];

    for m in &mods_cfg.mods {
        let name = name_map
            .get(&m.id)
            .cloned()
            .or_else(|| m.name.clone().into())
            .unwrap_or_else(|| format!("mod-{}", m.id));

        let Some(installed) = acf.mods.get(&m.id) else {
            missing.push(m.id);
            continue;
        };

        let upstream_time = api_map
            .get(&m.id)
            .copied()
            .unwrap_or(installed.latest_time_updated);

        let is_fresh = (m.pin_manifest.is_some() && m.pin_manifest == Some(installed.manifest))
            || (installed.time_updated >= upstream_time
                && installed.manifest == installed.latest_manifest);

        let status = ModStatus {
            id: m.id,
            name,
            installed_time: installed.time_updated,
            latest_time: upstream_time,
        };

        if is_fresh {
            fresh.push(status);
        } else {
            stale.push(status);
        }
    }

    (fresh, stale, missing)
}

fn find_unmanaged(mods_cfg: &axe_core::ModsConfig, acf: &acf::AcfFile) -> Vec<u64> {
    let managed_ids: std::collections::HashSet<u64> = mods_cfg.mods.iter().map(|m| m.id).collect();
    acf.mods
        .keys()
        .copied()
        .filter(|id| !managed_ids.contains(id))
        .collect()
}

fn fmt_date(ts: i64) -> String {
    chrono::DateTime::from_timestamp(ts, 0)
        .map_or_else(|| "?".into(), |t| t.format("%Y-%m-%d").to_string())
}
