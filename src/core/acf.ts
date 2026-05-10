import { parseVdf, type VdfObject, type VdfValue } from './vdf.ts';

export type WorkshopId = bigint;
export type ManifestId = bigint;

export type ModManifest = {
  workshop_id: WorkshopId;
  manifest: ManifestId; // installed
  time_updated: number; // unix; safe-integer
  latest_manifest: ManifestId;
  latest_time_updated: number;
};

export type AcfFile = { mods: Map<WorkshopId, ModManifest> };

const NUMERIC_ID = /^\d+$/;

/**
 * Parse a Steam workshop ACF (`appworkshop_<appid>.acf`) into a typed mod map.
 *
 * Only `WorkshopItemsInstalled.<id>` and `WorkshopItemDetails.<id>` are
 * extracted; everything else is ignored. Tolerant: missing details fall back
 * to installed values; non-numeric IDs are skipped; missing fields default
 * to `0n` / `0`.
 */
export function parseAcf(text: string): AcfFile {
  const tree = parseVdf(text);
  const mods = new Map<WorkshopId, ModManifest>();

  const installed = collectSection(tree, 'WorkshopItemsInstalled');
  const details = collectSection(tree, 'WorkshopItemDetails');

  for (const [idStr, fields] of installed) {
    if (!NUMERIC_ID.test(idStr)) continue;
    const workshop_id = BigInt(idStr);

    const manifest = parseBigInt(fields.get('manifest'));
    const time_updated = parseInt10(fields.get('timeupdated'));

    const detailFields = details.get(idStr);
    const latest_manifest = detailFields
      ? parseBigIntFallback(detailFields.get('latest_manifest'), manifest)
      : manifest;
    const latest_time_updated = detailFields
      ? parseInt10Fallback(detailFields.get('latest_timeupdated'), time_updated)
      : time_updated;

    mods.set(workshop_id, {
      workshop_id,
      manifest,
      time_updated,
      latest_manifest,
      latest_time_updated,
    });
  }

  return { mods };
}

/** Pure helper: true when Steam knows about a newer version than what's installed. */
export function isStale(m: ModManifest): boolean {
  return m.latest_time_updated > m.time_updated || m.latest_manifest !== m.manifest;
}

function collectSection(tree: VdfObject, name: string): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  const section = tree.get(name);
  if (!isObject(section)) return out;
  for (const [id, value] of section) {
    if (!isObject(value)) continue;
    const fields = new Map<string, string>();
    for (const [fk, fv] of value) {
      if (typeof fv === 'string') fields.set(fk, fv);
    }
    out.set(id, fields);
  }
  return out;
}

function isObject(v: VdfValue | undefined): v is VdfObject {
  return v instanceof Map;
}

function parseBigInt(s: string | undefined): ManifestId {
  if (!s) return 0n;
  try {
    return BigInt(s);
  } catch {
    return 0n;
  }
}

function parseBigIntFallback(s: string | undefined, fallback: ManifestId): ManifestId {
  if (!s) return fallback;
  try {
    const v = BigInt(s);
    return v === 0n ? fallback : v;
  } catch {
    return fallback;
  }
}

function parseInt10(s: string | undefined): number {
  if (!s) return 0;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : 0;
}

function parseInt10Fallback(s: string | undefined, fallback: number): number {
  if (!s) return fallback;
  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n) || n === 0) return fallback;
  return n;
}
