use camino::Utf8Path;
use owo_colors::OwoColorize;
use serde::Serialize;

use axe::Context;
use axe::error::ExitCode;
use crate::output::Output;

#[derive(Debug, Clone, clap::Args)]
#[command(about = "Manage the canonical mod list")]
pub struct Args {
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Clone, clap::Subcommand)]
pub enum Command {
    /// Show the mod list from axe.toml.
    List,
    /// Compare installed mods against Steam Workshop; report stale/missing.
    Check,
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
    let ctx = match Context::load(config_path) {
        Ok(c) => c,
        Err(e) => return out.fail("mods list", e.exit_code(), &e.to_string()),
    };

    let ids = &ctx.config.mods.ids;
    let items: Vec<ModEntry> = ids.iter().copied().map(|id| ModEntry { id }).collect();

    out.ok("mods list", &items, || {
        if items.is_empty() {
            println!("no mods configured in axe.toml");
            return;
        }
        println!(
            "{} mod{} configured:",
            items.len(),
            if items.len() == 1 { "" } else { "s" }
        );
        for m in &items {
            println!("  {}", m.id);
        }
    });

    ExitCode::Ok
}

#[derive(Debug, Serialize)]
struct ModEntry {
    id: u64,
}

fn run_check(out: Output, config_path: &Utf8Path) -> ExitCode {
    let ctx = match Context::load(config_path) {
        Ok(c) => c,
        Err(e) => return out.fail("mods check", e.exit_code(), &e.to_string()),
    };

    let ids = &ctx.config.mods.ids;
    if ids.is_empty() {
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
    let (api_map, name_map) = fetch_upstream(ids);

    let (fresh, stale, missing) = classify_mods(ids, &acf, &api_map, &name_map);
    let unmanaged = find_unmanaged(ids, &acf);

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
                println!("{} {id} (in ACF, not in axe.toml)", "unmanaged".dimmed());
            }
        },
    );

    if has_stale {
        ExitCode::Generic
    } else {
        ExitCode::Ok
    }
}

fn read_acf(ctx: &Context) -> axe::acf::AcfFile {
    match std::fs::read_to_string(ctx.layout.workshop_acf.as_std_path()) {
        Ok(text) => axe::acf::parse(&text).unwrap_or_else(|_| axe::acf::AcfFile::default()),
        Err(_) => axe::acf::AcfFile::default(),
    }
}

fn fetch_upstream(
    ids: &[u64],
) -> (
    std::collections::HashMap<u64, i64>,
    std::collections::HashMap<u64, String>,
) {
    let api_items = match axe::workshop_api::get_published_file_details(ids) {
        Ok(items) => items,
        Err(e) => {
            eprintln!("workshop API unreachable: {e}; using ACF latest_* only");
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
    ids: &[u64],
    acf: &axe::acf::AcfFile,
    api_map: &std::collections::HashMap<u64, i64>,
    name_map: &std::collections::HashMap<u64, String>,
) -> (Vec<ModStatus>, Vec<ModStatus>, Vec<u64>) {
    let mut fresh = vec![];
    let mut stale = vec![];
    let mut missing = vec![];

    for id in ids {
        let name = name_map
            .get(id)
            .cloned()
            .unwrap_or_else(|| format!("mod-{id}"));

        let Some(installed) = acf.mods.get(id) else {
            missing.push(*id);
            continue;
        };

        let upstream_time = api_map
            .get(id)
            .copied()
            .unwrap_or(installed.latest_time_updated);

        let is_fresh = installed.time_updated >= upstream_time
            && installed.manifest == installed.latest_manifest;

        let status = ModStatus {
            id: *id,
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

fn find_unmanaged(ids: &[u64], acf: &axe::acf::AcfFile) -> Vec<u64> {
    let managed_ids: std::collections::HashSet<u64> = ids.iter().copied().collect();
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
