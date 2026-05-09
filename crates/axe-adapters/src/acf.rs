//! Parse Valve [`KeyValues`] `appworkshop_<appid>.acf` files.
//!
//! The parser is intentionally narrow: we only extract the mod manifest
//! surface axe needs (`WorkshopItemsInstalled` and `WorkshopItemDetails`).
//! Unknown keys and sections are silently skipped.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::error::AdapterError;

/// Per-workshop-item data extracted from the ACF file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModManifest {
    pub workshop_id: u64,
    /// Installed manifest checksum.
    pub manifest: u64,
    /// Installed last-updated timestamp (unix epoch).
    pub time_updated: i64,
    /// Latest available manifest checksum (from Steam meta).
    pub latest_manifest: u64,
    /// Latest available update timestamp (unix epoch).
    pub latest_time_updated: i64,
}

impl ModManifest {
    /// A mod is stale when Steam knows about a newer version than what's installed.
    #[must_use]
    pub fn is_stale(&self) -> bool {
        self.latest_time_updated > self.time_updated || self.latest_manifest != self.manifest
    }
}

/// Parsed ACF file: the set of installed workshop items.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcfFile {
    pub mods: HashMap<u64, ModManifest>,
}

/// Parse an ACF text into an [`AcfFile`].
///
/// # Errors
/// Returns [`AdapterError::AcfParse`] if the file structure is too broken
/// to extract the expected sections.
pub fn parse(text: &str) -> Result<AcfFile, AdapterError> {
    let installed = parse_section(text, "WorkshopItemsInstalled");
    let details = parse_section(text, "WorkshopItemDetails");

    let mut mods = HashMap::new();

    // Merge: installed gives us size/time/manifest; details gives latest_*
    for (id, fields) in &installed {
        let manifest: u64 = fields
            .get("manifest")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0);
        let time_updated: i64 = fields
            .get("timeupdated")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0);

        let (latest_manifest, latest_time_updated) =
            details.get(id).map_or((manifest, time_updated), |d| {
                let lm: u64 = d
                    .get("latest_manifest")
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(manifest);
                let lt: i64 = d
                    .get("latest_timeupdated")
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(time_updated);
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

/// Parse one section like `"WorkshopItemsInstalled" { ... }` into a map of
/// `id -> { key: value }`. Each id is a top-level quoted numeric block.
fn parse_section(text: &str, name: &str) -> HashMap<u64, HashMap<String, String>> {
    let Some(section) = find_section(text, name) else {
        return HashMap::new();
    };

    let mut result = HashMap::new();
    let mut pos = 0;

    while pos < section.len() {
        // Find the next quoted id block: "12345" { ... }
        let Some(id_start) = section[pos..].find('"') else {
            break;
        };
        let id_start = pos + id_start + 1;
        let Some(id_end_rel) = section[id_start..].find('"') else {
            break;
        };
        let id_end = id_start + id_end_rel;
        let id_str = &section[id_start..id_end];
        let id: u64 = if let Ok(v) = id_str.parse() {
            v
        } else {
            pos = id_end + 1;
            continue;
        };

        // Find the { } block after the id
        let Some(brace) = section[id_end..].find('{') else {
            break;
        };
        let block_start = id_end + brace + 1;
        let Some(close) = find_matching_brace(&section[block_start..]) else {
            break;
        };
        let block = &section[block_start..block_start + close];

        let fields = parse_kv_block(block);
        result.insert(id, fields);

        pos = block_start + close + 1;
    }

    result
}

/// Find a top-level section named `name` and return its content (between { }).
fn find_section<'a>(text: &'a str, name: &str) -> Option<&'a str> {
    let needle = format!("\"{name}\"");
    let idx = text.find(&needle)?;
    let after = &text[idx + needle.len()..];
    let brace = after.find('{')?;
    let start = brace + 1;
    let close = find_matching_brace(&after[start..])?;
    Some(&after[start..start + close])
}

/// Find the matching `}` for a block starting after an opening `{`.
fn find_matching_brace(text: &str) -> Option<usize> {
    let mut depth = 1;
    let mut i = 0;
    let bytes = text.as_bytes();
    while i < bytes.len() && depth > 0 {
        match bytes[i] {
            b'{' => depth += 1,
            b'}' => depth -= 1,
            b'"' => {
                // skip quoted string
                i += 1;
                while i < bytes.len() && bytes[i] != b'"' {
                    if bytes[i] == b'\\' {
                        i += 1; // skip escaped char
                    }
                    i += 1;
                }
            }
            _ => {}
        }
        i += 1;
    }
    if depth == 0 { Some(i - 1) } else { None }
}

/// Parse `"key"    "value"` pairs from a block.
fn parse_kv_block(block: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let mut pos = 0;

    while pos < block.len() {
        // Find opening quote of key
        let Some(kq) = block[pos..].find('"') else {
            break;
        };
        let k_start = pos + kq + 1;
        let Some(k_end_rel) = block[k_start..].find('"') else {
            break;
        };
        let k_end = k_start + k_end_rel;
        let key = block[k_start..k_end].to_owned();

        // Find opening quote of value
        let rest = &block[k_end + 1..];
        let Some(vq) = rest.find('"') else {
            break;
        };
        let v_start = k_end + 1 + vq + 1;
        let Some(v_end_rel) = block[v_start..].find('"') else {
            break;
        };
        let v_end = v_start + v_end_rel;
        let value = block[v_start..v_end].to_owned();

        map.insert(key, value);
        pos = v_end + 1;
    }

    map
}

#[cfg(test)]
mod tests {
    use super::*;

    const STYGIA_ACF: &str = include_str!("../../axe-test-fixtures/src/stygia_acf.txt");

    #[test]
    fn parses_stygia_fixture() {
        let acf = parse(STYGIA_ACF).unwrap();
        assert_eq!(acf.mods.len(), 4);
        assert!(acf.mods.contains_key(&3_721_090_132));
    }

    #[test]
    fn stygia_mods_are_not_stale() {
        // On stygia all mods are current (latest_* == installed)
        let acf = parse(STYGIA_ACF).unwrap();
        for m in acf.mods.values() {
            assert!(!m.is_stale(), "mod {} should not be stale", m.workshop_id);
        }
    }

    #[test]
    fn detects_stale_mod() {
        let mut text = STYGIA_ACF.replace(
            "\"latest_timeupdated\"\t\t\"1778205653\"",
            "\"latest_timeupdated\"\t\t\"9999999999\"",
        );
        // Replace in the details section for mod 3721090132
        text = text.replace(
            "\"latest_manifest\"\t\t\"3915417666713453363\"",
            "\"latest_manifest\"\t\t\"9999999999999999999\"",
        );
        let acf = parse(&text).unwrap();
        let m = acf.mods.get(&3_721_090_132).unwrap();
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
