//! Parse Valve's `KeyValues` `appworkshop_<appid>.acf` files.
//!
//! We only extract the surface axe needs: `WorkshopItemsInstalled` and
//! `WorkshopItemDetails`. Everything else in the file is ignored.

use std::collections::HashMap;

use keyvalues_parser::{Obj, Value, Vdf};
use serde::{Deserialize, Serialize};

use crate::error::Error;

/// Per-workshop-item data extracted from the ACF file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModManifest {
    pub workshop_id: u64,
    pub manifest: u64,
    pub time_updated: i64,
    pub latest_manifest: u64,
    pub latest_time_updated: i64,
}

impl ModManifest {
    /// True when Steam knows about a newer version than what's installed.
    #[must_use]
    pub fn is_stale(&self) -> bool {
        self.latest_time_updated > self.time_updated || self.latest_manifest != self.manifest
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AcfFile {
    pub mods: HashMap<u64, ModManifest>,
}

/// Parse an ACF text into an [`AcfFile`].
///
/// # Errors
/// Returns [`Error::AcfParse`] if the document is structurally invalid.
pub fn parse(text: &str) -> Result<AcfFile, Error> {
    let vdf = Vdf::parse(text).map_err(|e| Error::AcfParse(e.to_string()))?;

    let Value::Obj(top) = vdf.value else {
        return Ok(AcfFile::default());
    };

    let installed = collect_section(&top, "WorkshopItemsInstalled");
    let details = collect_section(&top, "WorkshopItemDetails");

    let mut mods = HashMap::new();
    for (id, fields) in &installed {
        let manifest = parse_u64(fields, "manifest");
        let time_updated = parse_i64(fields, "timeupdated");

        let (latest_manifest, latest_time_updated) =
            details.get(id).map_or((manifest, time_updated), |d| {
                let lm = match parse_u64(d, "latest_manifest") {
                    0 => manifest,
                    other => other,
                };
                let lt = match parse_i64(d, "latest_timeupdated") {
                    0 => time_updated,
                    other => other,
                };
                (lm, lt)
            });

        mods.insert(
            *id,
            ModManifest {
                workshop_id: *id,
                manifest,
                time_updated,
                latest_manifest,
                latest_time_updated,
            },
        );
    }

    Ok(AcfFile { mods })
}

/// Pull the named section (e.g. `WorkshopItemsInstalled`) out of `top` and
/// return `id -> { key: value }` for every numeric child entry.
fn collect_section(top: &Obj<'_>, name: &str) -> HashMap<u64, HashMap<String, String>> {
    let mut out = HashMap::new();
    let Some(values) = top.get(name) else {
        return out;
    };
    let Some(Value::Obj(section_obj)) = values.first() else {
        return out;
    };
    for (key, vals) in section_obj.iter() {
        let Ok(id) = key.parse::<u64>() else { continue };
        let Some(Value::Obj(fields_obj)) = vals.first() else {
            continue;
        };
        let mut fields = HashMap::new();
        for (fkey, fvals) in fields_obj.iter() {
            if let Some(Value::Str(s)) = fvals.first() {
                fields.insert(fkey.to_string(), s.to_string());
            }
        }
        out.insert(id, fields);
    }
    out
}

fn parse_u64(map: &HashMap<String, String>, key: &str) -> u64 {
    map.get(key).and_then(|v| v.parse().ok()).unwrap_or(0)
}

fn parse_i64(map: &HashMap<String, String>, key: &str) -> i64 {
    map.get(key).and_then(|v| v.parse().ok()).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_ACF: &str = include_str!("../tests/fixtures/sample_workshop.acf");

    #[test]
    fn parses_sample_acf() {
        let acf = parse(SAMPLE_ACF).unwrap();
        assert_eq!(acf.mods.len(), 4);
        for m in acf.mods.values() {
            assert!(m.workshop_id > 0);
            assert!(m.manifest > 0);
            assert!(m.time_updated > 0);
            assert!(m.latest_manifest > 0);
            assert!(m.latest_time_updated > 0);
        }
    }

    #[test]
    fn sample_mods_are_not_stale() {
        let acf = parse(SAMPLE_ACF).unwrap();
        for m in acf.mods.values() {
            assert!(!m.is_stale(), "mod {} should not be stale", m.workshop_id);
        }
    }

    #[test]
    fn detects_stale_mod() {
        let mut acf = parse(SAMPLE_ACF).unwrap();
        let any_id = *acf.mods.keys().next().unwrap();
        let m = acf.mods.get_mut(&any_id).unwrap();
        m.latest_time_updated += 10_000;
        assert!(m.is_stale());
    }

    #[test]
    fn handles_empty_section() {
        let acf = parse("\"AppWorkshop\"\n{\n}\n").unwrap();
        assert!(acf.mods.is_empty());
    }

    #[test]
    fn handles_missing_section() {
        let acf = parse("\"Something\"\n{\n}\n").unwrap();
        assert!(acf.mods.is_empty());
    }
}
