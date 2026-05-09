//! Steam Web API client for Workshop mod freshness checks.
//!
//! Uses `ISteamRemoteStorage/GetPublishedFileDetails/v1/` — a public endpoint
//! that requires **no API key** and returns `time_updated` per item.

use serde::{Deserialize, Serialize};

use crate::error::AdapterError;

/// Per-item info returned by the Workshop API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkshopItem {
    pub publishedfileid: u64,
    pub title: String,
    /// Unix timestamp of the most recent update.
    pub time_updated: i64,
    /// 1 = visible, 2 = deleted, etc.
    pub visibility: i32,
    /// 1 = published, otherwise errored.
    pub result: i32,
}

/// Response envelope from the Workshop API.
#[derive(Debug, Deserialize)]
struct ApiEnvelope {
    response: ApiResponse,
}

#[derive(Debug, Deserialize)]
struct ApiResponse {
    publishedfiledetails: Vec<ItemRaw>,
}

#[derive(Debug, Deserialize)]
struct ItemRaw {
    publishedfileid: String,
    title: String,
    time_updated: i64,
    visibility: i32,
    result: i32,
}

/// Query the Workshop API for the given list of published file IDs.
///
/// # Errors
/// Returns [`AdapterError::WorkshopApi`] on any HTTP or parse failure.
pub fn get_published_file_details(ids: &[u64]) -> Result<Vec<WorkshopItem>, AdapterError> {
    let url = "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/";

    // Build form params: item_count + publishedfileids[N]
    let mut keys: Vec<String> = Vec::with_capacity(ids.len());
    let mut params: Vec<(&str, String)> = vec![("itemcount", ids.len().to_string())];
    for (i, _id) in ids.iter().enumerate() {
        let key = format!("publishedfileids[{i}]");
        keys.push(key);
    }
    for (key, id) in keys.iter().zip(ids.iter()) {
        params.push((key.as_str(), id.to_string()));
    }

    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(std::time::Duration::from_secs(15)))
        .build()
        .into();

    let resp = agent
        .post(url)
        .send_form(params)
        .map_err(|e| AdapterError::WorkshopApi(format!("HTTP request: {e}")))?
        .body_mut()
        .read_to_string()
        .map_err(|e| AdapterError::WorkshopApi(format!("reading body: {e}")))?;

    let envelope: ApiEnvelope = serde_json::from_str(&resp)
        .map_err(|e| AdapterError::WorkshopApi(format!("parsing JSON: {e}")))?;

    let items = envelope
        .response
        .publishedfiledetails
        .into_iter()
        .map(|raw| WorkshopItem {
            publishedfileid: raw.publishedfileid.parse().unwrap_or(0),
            title: raw.title,
            time_updated: raw.time_updated,
            visibility: raw.visibility,
            result: raw.result,
        })
        .collect();

    Ok(items)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "hits real Steam API; run with cargo test -- --ignored"]
    fn fetches_stygia_mods() {
        let ids = [3_721_090_132, 3_721_096_154, 3_721_177_576, 3_721_991_191];
        let items = get_published_file_details(&ids).unwrap();
        assert_eq!(items.len(), 4);
        for item in &items {
            assert_eq!(item.result, 1);
            assert!(!item.title.is_empty());
        }
    }
}
