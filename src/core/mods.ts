import type { AcfFile, ManifestId, WorkshopId } from './acf.ts';
import type { WorkshopItem } from './workshop.ts';

export type FreshnessState = 'current' | 'stale' | 'missing_local' | 'missing_remote' | 'unmanaged';

export type ModFreshness = {
  id: WorkshopId;
  state: FreshnessState;
  title: string | null;
  local_manifest: ManifestId | null;
  latest_manifest: ManifestId | null;
  local_time_updated: number | null;
  latest_time_updated: number | null;
};

export type FreshnessReport = {
  total: number; // declared count
  current: number;
  stale: number;
  missing_local: number;
  missing_remote: number;
  unmanaged: number;
  items: ModFreshness[]; // declared in axe.toml order, then unmanaged
};

/**
 * Pure freshness comparison. Takes the declared mod IDs from `axe.toml`,
 * the locally-installed ACF map, and the remote Workshop API response;
 * returns a typed report.
 *
 * - declared && in ACF && remote knows it && manifests/times match -> 'current'
 * - declared && in ACF && remote knows it && upstream newer        -> 'stale'
 * - declared && NOT in ACF                                          -> 'missing_local'
 * - declared && in ACF && remote DOESN'T know it (result != 1)      -> 'missing_remote'
 * - in ACF && NOT declared                                          -> 'unmanaged'
 *
 * If `remote` is empty (e.g. API was unreachable and the caller fell back),
 * we still produce a report — but per-id state uses the local ACF's
 * `latest_*` fields (no remote context, titles null).
 */
export function checkModFreshness(
  declared: readonly WorkshopId[],
  local: AcfFile,
  remote: readonly WorkshopItem[],
): FreshnessReport {
  const remoteById = new Map<bigint, WorkshopItem>();
  for (const item of remote) remoteById.set(item.published_file_id, item);

  const declaredSet = new Set<bigint>(declared);
  const items: ModFreshness[] = [];
  const counts = { current: 0, stale: 0, missing_local: 0, missing_remote: 0, unmanaged: 0 };

  for (const id of declared) {
    const localEntry = local.mods.get(id);
    const remoteEntry = remoteById.get(id);

    if (!localEntry) {
      items.push(makeMissingLocal(id, remoteEntry));
      counts.missing_local++;
      continue;
    }

    // Have local. Decide using remote if available; else fall back to ACF latest_*.
    if (remoteEntry && remoteEntry.result !== 1) {
      items.push({
        id,
        state: 'missing_remote',
        title: remoteEntry.title || null,
        local_manifest: localEntry.manifest,
        latest_manifest: localEntry.latest_manifest,
        local_time_updated: localEntry.time_updated,
        latest_time_updated: localEntry.latest_time_updated,
      });
      counts.missing_remote++;
      continue;
    }

    const remoteTimeUpdated = remoteEntry?.time_updated ?? localEntry.latest_time_updated;
    const remoteTitle = remoteEntry?.title ?? null;

    const isCurrent =
      localEntry.time_updated >= remoteTimeUpdated &&
      localEntry.manifest === localEntry.latest_manifest;

    items.push({
      id,
      state: isCurrent ? 'current' : 'stale',
      title: remoteTitle,
      local_manifest: localEntry.manifest,
      latest_manifest: localEntry.latest_manifest,
      local_time_updated: localEntry.time_updated,
      latest_time_updated: remoteTimeUpdated,
    });
    if (isCurrent) counts.current++;
    else counts.stale++;
  }

  // Unmanaged: in ACF but not declared.
  for (const [id, localEntry] of local.mods) {
    if (declaredSet.has(id)) continue;
    items.push({
      id,
      state: 'unmanaged',
      title: null,
      local_manifest: localEntry.manifest,
      latest_manifest: localEntry.latest_manifest,
      local_time_updated: localEntry.time_updated,
      latest_time_updated: localEntry.latest_time_updated,
    });
    counts.unmanaged++;
  }

  return {
    total: declared.length,
    ...counts,
    items,
  };
}

function makeMissingLocal(id: WorkshopId, remoteEntry: WorkshopItem | undefined): ModFreshness {
  return {
    id,
    state: 'missing_local',
    title: remoteEntry?.title ?? null,
    local_manifest: null,
    latest_manifest: null,
    local_time_updated: null,
    latest_time_updated: remoteEntry?.time_updated ?? null,
  };
}
