import { access } from 'node:fs/promises';
import { parseAppInfo } from './app_info.ts';
import type { Config } from './config.ts';
import { AxeError } from './errors.ts';
import { type Layout, SERVER_APPID } from './layout.ts';
import { reserveSteamcmdLog, type SteamcmdVerb } from './paths.ts';
import { runSteamcmd, type SpawnLike } from './steamcmd.ts';

export type InstallData = {
  root: string;
  validated: boolean;
  build_id: string | null;
  log_file: string;
};

export type ServerInstallVerb = Extract<SteamcmdVerb, 'install' | 'update' | 'verify'>;

export type RunServerInstallOptions = {
  verb: ServerInstallVerb;
  validate: boolean;
  spawn?: SpawnLike;
  signal?: AbortSignal;
};

export type ServerInstallOutcome = {
  data: InstallData;
  warnings: string[];
};

/**
 * Shared `steamcmd app_update` pipeline used by `install`, `update --apply`,
 * and `verify`. Captures a timestamped log under `<root>/.axe/`, verifies
 * the binary exists post-run, then best-effort fetches `build_id` via a
 * follow-up `app_info_print` (failures here surface as warnings, not errors).
 *
 * Throws `AxeError(config)` if no steamcmd binary is configured or on PATH.
 * Throws `AxeError(lifecycle)` if the run completed but the server binary
 * is missing afterward (operator surfaces the log file).
 */
export async function runServerInstall(
  config: Config,
  layout: Layout,
  options: RunServerInstallOptions,
): Promise<ServerInstallOutcome> {
  const steamcmdBinary = resolveSteamcmdBinary(config);
  const logFile = await reserveSteamcmdLog(config.server.root, options.verb);
  const warnings: string[] = [];

  const runOptions: { spawn?: SpawnLike; signal?: AbortSignal; logFile: string } = { logFile };
  if (options.spawn !== undefined) runOptions.spawn = options.spawn;
  if (options.signal !== undefined) runOptions.signal = options.signal;

  const outcome = await runSteamcmd(
    {
      binary: steamcmdBinary,
      forceInstallDir: config.server.root,
      login: 'anonymous',
      actions: [{ kind: 'app_update', appid: SERVER_APPID, validate: options.validate }],
    },
    runOptions,
  );

  if (outcome.exit !== 0) {
    warnings.push(`steamcmd exited ${outcome.exit}; see ${logFile} for details`);
  }

  try {
    await access(layout.binary);
  } catch {
    throw new AxeError(
      'lifecycle',
      `${options.verb} completed but server binary not found at ${layout.binary}; check log: ${logFile}`,
    );
  }

  const build = await readBuildIdBestEffort(steamcmdBinary, config.server.root, options);
  if (build.warning !== null) warnings.push(build.warning);

  return {
    data: {
      root: config.server.root,
      validated: options.validate,
      build_id: build.build_id,
      log_file: logFile,
    },
    warnings,
  };
}

export type ServerBuildInfo = {
  build_id: string | null;
  warnings: string[];
};

/**
 * Look up the latest server build_id via `steamcmd app_info_print`. Used by
 * `update --check-only` and any future read-only build status flow. No
 * filesystem mutation. Surfaces null + a warning on parse failure rather
 * than throwing.
 */
export async function checkServerBuild(
  config: Config,
  options: { spawn?: SpawnLike; signal?: AbortSignal } = {},
): Promise<ServerBuildInfo> {
  const steamcmdBinary = resolveSteamcmdBinary(config);
  const warnings: string[] = [];

  const runOptions: { spawn?: SpawnLike; signal?: AbortSignal } = {};
  if (options.spawn !== undefined) runOptions.spawn = options.spawn;
  if (options.signal !== undefined) runOptions.signal = options.signal;

  const info = await runSteamcmd(
    {
      binary: steamcmdBinary,
      forceInstallDir: config.server.root,
      login: 'anonymous',
      actions: [{ kind: 'app_info_print', appid: SERVER_APPID }],
    },
    runOptions,
  );

  if (info.exit !== 0) {
    warnings.push(`steamcmd exited ${info.exit} during app_info_print`);
  }

  const { build_id } = parseAppInfo(info.stdout, SERVER_APPID);
  if (build_id === null) {
    warnings.push('build_id not found in app_info output');
  }
  return { build_id, warnings };
}

function resolveSteamcmdBinary(config: Config): string {
  const fromConfig = config.steamcmd?.binary;
  if (fromConfig !== undefined) return fromConfig;
  const onPath = Bun.which('steamcmd');
  if (onPath !== null) return onPath;
  throw new AxeError(
    'config',
    'steamcmd binary not found; set [steamcmd].binary in axe.toml or install steamcmd on PATH',
  );
}

async function readBuildIdBestEffort(
  binary: string,
  root: string,
  options: { spawn?: SpawnLike; signal?: AbortSignal },
): Promise<{ build_id: string | null; warning: string | null }> {
  try {
    const runOptions: { spawn?: SpawnLike; signal?: AbortSignal } = {};
    if (options.spawn !== undefined) runOptions.spawn = options.spawn;
    if (options.signal !== undefined) runOptions.signal = options.signal;
    const info = await runSteamcmd(
      {
        binary,
        forceInstallDir: root,
        login: 'anonymous',
        actions: [{ kind: 'app_info_print', appid: SERVER_APPID }],
      },
      runOptions,
    );
    const { build_id } = parseAppInfo(info.stdout, SERVER_APPID);
    if (build_id === null) {
      return { build_id: null, warning: 'build_id not found in app_info output' };
    }
    return { build_id, warning: null };
  } catch (e) {
    return { build_id: null, warning: `build_id lookup failed: ${(e as Error).message}` };
  }
}
