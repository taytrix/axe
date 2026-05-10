import { mkdir } from 'node:fs/promises';
import * as posix from 'node:path/posix';

/**
 * Verb tag used in steamcmd log filenames. Adding a new value here is the
 * single edit needed to introduce another timestamped log family.
 */
export type SteamcmdVerb = 'install' | 'update' | 'verify' | 'sync';

/** `<root>/.axe` — single hidden directory for axe's per-run debug artifacts. */
export function axeStateDir(root: string): string {
  return posix.join(root, '.axe');
}

/**
 * Canonical steamcmd log path for `verb`, stamped with `date`. Pure: no
 * filesystem access. Use `reserveSteamcmdLog` if you also need the parent
 * directory to exist.
 */
export function steamcmdLogPath(root: string, verb: SteamcmdVerb, date: Date = new Date()): string {
  const stamp = date.toISOString().replace(/[:.]/g, '-');
  return posix.join(axeStateDir(root), `steamcmd-${verb}-${stamp}.log`);
}

/**
 * Ensure `.axe/` exists and return a fresh steamcmd log path. Single
 * three-line pattern that install/update/verify/sync all need.
 */
export async function reserveSteamcmdLog(root: string, verb: SteamcmdVerb): Promise<string> {
  await mkdir(axeStateDir(root), { recursive: true });
  return steamcmdLogPath(root, verb);
}
