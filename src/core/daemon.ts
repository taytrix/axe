import { rmSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import * as posix from 'node:path/posix';
import pkg from '../../package.json' with { type: 'json' };
import type { Config } from './config.ts';
import { parseDuration } from './duration.ts';
import { AxeError } from './errors.ts';
import { checkServerBuild } from './install.ts';
import { atomicWrite } from './io.ts';
import type { Layout } from './layout.ts';
import { type FreshnessReport, hasDrift, runModsCheck } from './mods.ts';
import { axeStateDir } from './paths.ts';
import { findRunningServer, type RunningServer } from './process.ts';
import type { SpawnLike } from './steamcmd.ts';
import type { FetchLike } from './workshop.ts';

const STATE_SCHEMA = 1;
const PID_FILE = 'daemon.pid';
const STATE_FILE = 'state.json';

export type DaemonBuild = {
  checked_at: string;
  build_id: string | null;
  warnings: string[];
};

export type DaemonState = {
  schema: typeof STATE_SCHEMA;
  axe_version: string;
  started_at: string;
  tick: {
    n: number;
    at: string;
    next_at: string;
    interval_seconds: number;
    duration_ms: number;
  };
  mods: {
    report: FreshnessReport;
    drift: boolean;
    warnings: string[];
  };
  build: DaemonBuild | null;
  running: RunningServer | null;
  drift_summary: {
    stale_mods: number;
    missing_local_mods: number;
    missing_remote_mods: number;
    /** v0.1 always false; tracking last-applied build is a v0.2 concern. */
    build_outdated: boolean;
  };
};

export type DaemonTickOptions = {
  fetchImpl?: FetchLike;
  spawn?: SpawnLike;
  signal?: AbortSignal;
  buildCheckEvery: number;
  intervalSeconds: number;
};

/**
 * One tick of the daemon: runModsCheck, optionally checkServerBuild (every
 * Nth tick), findRunningServer. No mutations beyond the returned state.
 *
 * `prevState` carries the previous tick's outcome so we can preserve the
 * `build` field across non-build-check ticks and increment `tick.n`.
 */
export async function runDaemonTick(
  config: Config,
  layout: Layout,
  prevState: DaemonState | null,
  options: DaemonTickOptions,
): Promise<DaemonState> {
  const tickN = (prevState?.tick.n ?? 0) + 1;
  const startedMs = Date.now();
  const at = new Date(startedMs).toISOString();
  const startedAt = prevState?.started_at ?? at;

  const checkOpts: { fetchImpl?: FetchLike; signal?: AbortSignal } = {};
  if (options.fetchImpl !== undefined) checkOpts.fetchImpl = options.fetchImpl;
  if (options.signal !== undefined) checkOpts.signal = options.signal;
  const { report, warnings: modsWarnings } = await runModsCheck(layout, config.mods.ids, checkOpts);
  const modsDrift = hasDrift(report);

  // Build check: run on the first tick, then every Nth tick. Carries forward
  // the previous build snapshot otherwise.
  const isBuildTick = tickN === 1 || tickN % options.buildCheckEvery === 0;
  let build: DaemonBuild | null = prevState?.build ?? null;
  if (isBuildTick) {
    try {
      const buildOpts: { spawn?: SpawnLike; signal?: AbortSignal } = {};
      if (options.spawn !== undefined) buildOpts.spawn = options.spawn;
      if (options.signal !== undefined) buildOpts.signal = options.signal;
      const result = await checkServerBuild(config, buildOpts);
      build = {
        checked_at: at,
        build_id: result.build_id,
        warnings: result.warnings,
      };
    } catch (e) {
      // Tolerate steamcmd failure; carry forward the previous snapshot and
      // record the failure as a warning on the mods side (build stays as-is).
      modsWarnings.push(`build check failed: ${(e as Error).message}`);
    }
  }

  const running = await findRunningServer(layout);

  const endedMs = Date.now();

  return {
    schema: STATE_SCHEMA,
    axe_version: pkg.version,
    started_at: startedAt,
    tick: {
      n: tickN,
      at,
      next_at: new Date(endedMs + options.intervalSeconds * 1000).toISOString(),
      interval_seconds: options.intervalSeconds,
      duration_ms: endedMs - startedMs,
    },
    mods: { report, drift: modsDrift, warnings: modsWarnings },
    build,
    running,
    drift_summary: {
      stale_mods: report.stale,
      missing_local_mods: report.missing_local,
      missing_remote_mods: report.missing_remote,
      build_outdated: false,
    },
  };
}

export type RunDaemonLoopOptions = {
  fetchImpl?: FetchLike;
  spawn?: SpawnLike;
  /** Override `update.poll_interval`. Plain seconds. */
  intervalSeconds?: number;
  /** Override `update.build_check_every`. */
  buildCheckEvery?: number;
  /** Test-only: stop after this many ticks. Hidden from `--help`. */
  maxTicks?: number;
  /** External abort (SIGTERM/SIGINT in CLI). */
  signal?: AbortSignal;
  /** Callback invoked synchronously after each tick (CLI uses it to render). */
  onTick?: (state: DaemonState) => void;
};

/**
 * Long-running tickloop. Manages the pid file, signal handlers, and sleep
 * between ticks. Refuses to start when an existing pid file points at a
 * live process.
 *
 * Returns when:
 *   - `signal` is aborted (clean shutdown), or
 *   - `maxTicks` reached (test mode), or
 *   - tick throws (we re-throw after pid cleanup).
 */
export async function runDaemonLoop(
  config: Config,
  layout: Layout,
  options: RunDaemonLoopOptions = {},
): Promise<void> {
  const intervalSeconds = options.intervalSeconds ?? parseDuration(config.update.poll_interval);
  const buildCheckEvery = options.buildCheckEvery ?? config.update.build_check_every;
  const stateDir = axeStateDir(config.server.root);
  const pidPath = posix.join(stateDir, PID_FILE);

  await mkdir(stateDir, { recursive: true });
  await guardAlreadyRunning(pidPath);
  await atomicWrite(pidPath, `${process.pid}\n`);

  const cleanup = () => {
    try {
      rmSync(pidPath, { force: true });
    } catch {
      /* best-effort */
    }
  };

  const onExit = () => cleanup();
  process.on('exit', onExit);

  try {
    let prevState: DaemonState | null = null;
    let tickIndex = 0;
    while (true) {
      if (options.signal?.aborted) break;

      const tickOpts: DaemonTickOptions = {
        buildCheckEvery,
        intervalSeconds,
      };
      if (options.fetchImpl !== undefined) tickOpts.fetchImpl = options.fetchImpl;
      if (options.spawn !== undefined) tickOpts.spawn = options.spawn;
      if (options.signal !== undefined) tickOpts.signal = options.signal;

      const state = await runDaemonTick(config, layout, prevState, tickOpts);
      await saveDaemonState(config.server.root, state);
      options.onTick?.(state);
      prevState = state;
      tickIndex += 1;

      if (options.maxTicks !== undefined && tickIndex >= options.maxTicks) break;
      if (options.signal?.aborted) break;

      await sleepWithAbort(intervalSeconds * 1000, options.signal);
    }
  } finally {
    process.off('exit', onExit);
    cleanup();
  }
}

/** Atomic write of the daemon state snapshot to `<root>/.axe/state.json`. */
export async function saveDaemonState(root: string, state: DaemonState): Promise<void> {
  const path = posix.join(axeStateDir(root), STATE_FILE);
  await mkdir(axeStateDir(root), { recursive: true });
  const json = JSON.stringify(state, bigintReplacer, 2);
  await atomicWrite(path, json);
}

/**
 * Read `<root>/.axe/state.json` and return the parsed object, or null when
 * the file doesn't exist or is malformed. Returns `unknown` because the
 * round-trip loses bigint precision (workshop/manifest ids become strings);
 * callers that need typed access should re-derive it via runDaemonTick.
 */
export async function loadDaemonState(root: string): Promise<unknown | null> {
  const path = posix.join(axeStateDir(root), STATE_FILE);
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    throw new AxeError('filesystem', `reading ${path}: ${(e as Error).message}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Read the daemon pid file; return null if absent or stale. A stale pid
 * file (process not alive) is silently removed so the next `daemon run`
 * can start fresh.
 */
export async function readDaemonPid(root: string): Promise<number | null> {
  const pidPath = posix.join(axeStateDir(root), PID_FILE);
  const pid = await readPidFile(pidPath);
  if (pid === null) return null;
  if (isProcessAlive(pid)) return pid;
  // stale; clean up
  try {
    await rm(pidPath, { force: true });
  } catch {
    /* best-effort */
  }
  return null;
}

async function guardAlreadyRunning(pidPath: string): Promise<void> {
  const existing = await readPidFile(pidPath);
  if (existing === null) return;
  if (isProcessAlive(existing)) {
    throw new AxeError('lifecycle', `daemon already running (pid ${existing})`);
  }
  // stale pid file — remove silently
  try {
    await rm(pidPath, { force: true });
  } catch {
    /* best-effort */
  }
}

async function readPidFile(pidPath: string): Promise<number | null> {
  try {
    const text = await readFile(pidPath, 'utf8');
    const pid = Number.parseInt(text.trim(), 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

function sleepWithAbort(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
