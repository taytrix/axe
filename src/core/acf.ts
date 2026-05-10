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
 * to installed values; non-numeric IDs are skipped; missing/invalid fields
 * default to `0n` / `0`.
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
    const latest_manifest = parseBigInt(detailFields?.get('latest_manifest'), manifest);
    const latest_time_updated = parseInt10(detailFields?.get('latest_timeupdated'), time_updated);

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

/**
 * Parse a string as a non-negative bigint. If `fallback` is provided, returns
 * it for missing input or zero-valued / unparseable strings; otherwise returns
 * `0n` for those cases.
 */
function parseBigInt(s: string | undefined, fallback?: bigint): bigint {
  if (s === undefined || s === '') return fallback ?? 0n;
  let parsed: bigint;
  try {
    parsed = BigInt(s);
  } catch {
    return fallback ?? 0n;
  }
  if (parsed === 0n && fallback !== undefined) return fallback;
  return parsed;
}

/**
 * Parse a string as a finite int (base 10). If `fallback` is provided, returns
 * it for missing input or zero/non-finite results; otherwise returns `0` for
 * those cases.
 */
function parseInt10(s: string | undefined, fallback?: number): number {
  if (s === undefined || s === '') return fallback ?? 0;
  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n)) return fallback ?? 0;
  if (n === 0 && fallback !== undefined) return fallback;
  return n;
}
