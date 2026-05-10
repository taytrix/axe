import { mkdir, readdir, readFile } from 'node:fs/promises';
import * as posix from 'node:path/posix';
import type { WorkshopId } from './acf.ts';
import type { Config } from './config.ts';
import { AxeError } from './errors.ts';
import { atomicWrite } from './io.ts';
import { type Layout, WORKSHOP_APPID } from './layout.ts';
import { runModsCheck } from './mods.ts';
import { runSteamcmd, type SpawnLike, type SteamcmdAction } from './steamcmd.ts';
import type { FetchLike } from './workshop.ts';

export type SyncOutcome = {
  /** declared IDs that produced .pak files in the workshop content tree */
  downloaded: WorkshopId[];
  /** declared IDs that produced no .pak files (still drift after sync) */
  missing: WorkshopId[];
  modlist_path: string;
  /** false when modlist bytes already matched the expected output */
  modlist_changed: boolean;
  log_file?: string;
  warnings: string[];
};

export type RunSyncOptions = {
  fetchImpl?: FetchLike;
  spawn?: SpawnLike;
  signal?: AbortSignal;
  /** path for steamcmd log capture; omitted = no log written */
  logFile?: string;
  /** override `[steamcmd].binary` config + PATH discovery */
  steamcmdBinary?: string;
};

/**
 * Sync workshop mods declared in `axe.toml`.
 *
 * Pipeline:
 *   1. `runModsCheck` to classify each declared id (current/stale/missing_local).
 *   2. If nothing is stale or missing_local, skip steamcmd entirely.
 *   3. Otherwise run a single batched `+workshop_download_item` steamcmd.
 *   4. Scan `<root>/steamapps/workshop/content/<appid>/<id>/` for `.pak` files.
 *   5. Build modlist text in declared order; byte-compare existing modlist;
 *      `atomicWrite` only if different.
 *
 * Throws `AxeError(config)` when steamcmd binary cannot be found and
 * downloads are required. Tolerates non-zero steamcmd exit (warning).
 */
export async function syncModlist(
  config: Config,
  layout: Layout,
  options: RunSyncOptions = {},
): Promise<SyncOutcome> {
  const declared = config.mods.ids;
  const warnings: string[] = [];

  const checkOptions: { fetchImpl?: FetchLike; signal?: AbortSignal } = {};
  if (options.fetchImpl !== undefined) checkOptions.fetchImpl = options.fetchImpl;
  if (options.signal !== undefined) checkOptions.signal = options.signal;
  const { report, warnings: checkWarnings } = await runModsCheck(layout, declared, checkOptions);
  warnings.push(...checkWarnings);

  const toDownload: WorkshopId[] = [];
  for (const item of report.items) {
    if (item.state === 'stale' || item.state === 'missing_local') toDownload.push(item.id);
  }

  // Fast path: freshness says nothing to do. Still verify the modlist on disk.
  if (toDownload.length === 0) {
    const modlist = await reconcileModlist(layout, declared);
    return {
      downloaded: [],
      missing: modlist.missing,
      modlist_path: layout.modlist_txt,
      modlist_changed: modlist.changed,
      warnings,
    };
  }

  const steamcmdBinary =
    options.steamcmdBinary ?? config.steamcmd?.binary ?? Bun.which('steamcmd') ?? null;
  if (!steamcmdBinary) {
    throw new AxeError(
      'config',
      'steamcmd binary not found; set [steamcmd].binary in axe.toml or install steamcmd on PATH',
    );
  }

  const actions: SteamcmdAction[] = toDownload.map((id) => ({
    kind: 'workshop_download_item',
    appid: WORKSHOP_APPID,
    id,
  }));

  const runOptions: {
    spawn?: SpawnLike;
    signal?: AbortSignal;
    logFile?: string;
  } = {};
  if (options.spawn !== undefined) runOptions.spawn = options.spawn;
  if (options.signal !== undefined) runOptions.signal = options.signal;
  if (options.logFile !== undefined) runOptions.logFile = options.logFile;

  const outcome = await runSteamcmd(
    {
      binary: steamcmdBinary,
      forceInstallDir: config.server.root,
      login: 'anonymous',
      actions,
    },
    runOptions,
  );

  if (outcome.exit !== 0) {
    const tail = outcome.stderr.trim().split('\n').slice(-3).join(' | ');
    warnings.push(
      `steamcmd exited ${outcome.exit}${tail ? `; tail: ${tail}` : ''}${
        options.logFile ? `; log: ${options.logFile}` : ''
      }`,
    );
  }

  const modlist = await reconcileModlist(layout, declared);

  // `downloaded`: ids we asked steamcmd for AND that produced .pak files.
  // `missing`: declared ids with no .pak (canonical post-sync drift set).
  const stillMissing = new Set(modlist.missing.map((id) => id.toString()));
  const downloaded = toDownload.filter((id) => !stillMissing.has(id.toString()));

  const result: SyncOutcome = {
    downloaded,
    missing: modlist.missing,
    modlist_path: layout.modlist_txt,
    modlist_changed: modlist.changed,
    warnings,
  };
  if (options.logFile !== undefined) result.log_file = options.logFile;
  return result;
}

/**
 * Build the modlist text for `declared` and write it iff bytes differ.
 * Returns `{ changed, missing }` where `missing` is declared ids whose
 * content directory has no `.pak` files (or doesn't exist).
 */
async function reconcileModlist(
  layout: Layout,
  declared: readonly WorkshopId[],
): Promise<{ changed: boolean; missing: WorkshopId[] }> {
  const missing: WorkshopId[] = [];
  const lines: string[] = [];
  for (const id of declared) {
    const paks = await scanPaks(layout.workshop_content, id);
    if (paks.length === 0) missing.push(id);
    for (const pak of paks) lines.push(pak);
  }
  const expected = lines.length > 0 ? `${lines.join('\n')}\n` : '';

  let current: string | null = null;
  try {
    current = await readFile(layout.modlist_txt, 'utf8');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      throw new AxeError('filesystem', `reading ${layout.modlist_txt}: ${(e as Error).message}`);
    }
  }

  if (current === expected) return { changed: false, missing };
  // skip writing an empty modlist if there's no file to begin with — avoid
  // creating noise on a fresh install with zero declared mods.
  if (expected === '' && current === null) return { changed: false, missing };

  await mkdir(layout.mods_dir, { recursive: true });
  await atomicWrite(layout.modlist_txt, expected);
  return { changed: true, missing };
}

/** Sorted list of `.pak` paths for a workshop id, empty if dir is missing. */
async function scanPaks(workshopContent: string, id: WorkshopId): Promise<string[]> {
  const dir = posix.join(workshopContent, id.toString());
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return [];
    throw new AxeError('filesystem', `reading ${dir}: ${(e as Error).message}`);
  }
  return entries
    .filter((name) => name.toLowerCase().endsWith('.pak'))
    .sort()
    .map((name) => posix.join(dir, name));
}
