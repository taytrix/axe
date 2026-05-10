import { stat } from 'node:fs/promises';
import type { Config } from './config.ts';
import { AxeError } from './errors.ts';
import type { Layout } from './layout.ts';
import { findRunningServer, type RunningServer } from './process.ts';

export type StartServerOptions = {
  /** Block until child exits (inheriting stdio); default detaches. */
  foreground?: boolean;
  procRoot?: string;
};

export type StartOutcome = {
  pid: number;
  foreground: boolean;
};

export type StopServerOptions = {
  /** Seconds to wait after SIGTERM before escalating to SIGKILL. Default 60. */
  timeoutSec?: number;
  /** Polling interval in ms while waiting for the process to exit. Default 200. */
  pollMs?: number;
  procRoot?: string;
};

export type StopOutcome = {
  pid: number;
  method: 'term' | 'kill';
  elapsed_ms: number;
};

export type RestartServerOptions = StartServerOptions & StopServerOptions;

export type RestartOutcome = {
  stopped_pid: number | null;
  new_pid: number;
};

/**
 * Spawn the dedicated server. Linux only in v0.1; windows throws
 * `AxeError(lifecycle)` until v0.2 wires service-aware lifecycle.
 *
 * Detached by default: `stdio: ['ignore', 'ignore', 'ignore']` so axe's
 * controlling terminal isn't tied to the child. Conan writes its own logs
 * under `<root>/ConanSandbox/Saved/Logs/`.
 *
 * `--foreground` inherits stdio and awaits child exit. Useful under a
 * service supervisor (systemd) or for one-off runs.
 */
export async function startServer(
  config: Config,
  layout: Layout,
  options: StartServerOptions = {},
): Promise<StartOutcome> {
  if (layout.platform !== 'linux') {
    throw new AxeError('lifecycle', 'v0.1 lifecycle is linux-only; windows lifecycle lands later');
  }

  const findOptions: { procRoot?: string } = {};
  if (options.procRoot !== undefined) findOptions.procRoot = options.procRoot;
  const existing = await findRunningServer(layout, findOptions);
  if (existing) {
    throw new AxeError('lifecycle', `server already running (pid ${existing.pid})`);
  }

  // Prefer the launcher script (sets LD_LIBRARY_PATH and execs the binary on
  // a real Conan install), but fall back to the binary if the launcher is
  // missing — useful for unusual installs and required by tests.
  const launcher = await pickLauncher(layout);
  const argv = [launcher, ...config.server.launch_args];
  const foreground = options.foreground ?? false;

  const proc = Bun.spawn(argv, {
    cwd: layout.root,
    stdin: 'ignore',
    stdout: foreground ? 'inherit' : 'ignore',
    stderr: foreground ? 'inherit' : 'ignore',
  });

  if (foreground) {
    await proc.exited;
  } else {
    // Detach so axe can exit immediately and the server keeps running.
    // Without unref(), Bun keeps the event loop alive waiting for the child.
    proc.unref();
  }
  return { pid: proc.pid, foreground };
}

/**
 * SIGTERM the running server, poll for exit up to `timeoutSec`, escalate
 * to SIGKILL on timeout. Throws `AxeError(lifecycle)` if no server is
 * running.
 */
export async function stopServer(
  layout: Layout,
  options: StopServerOptions = {},
): Promise<StopOutcome> {
  if (layout.platform !== 'linux') {
    throw new AxeError('lifecycle', 'v0.1 lifecycle is linux-only; windows lifecycle lands later');
  }

  const findOptions: { procRoot?: string } = {};
  if (options.procRoot !== undefined) findOptions.procRoot = options.procRoot;
  const running = await findRunningServer(layout, findOptions);
  if (!running) {
    throw new AxeError('lifecycle', 'no running server');
  }

  const timeoutMs = (options.timeoutSec ?? 60) * 1000;
  const pollMs = options.pollMs ?? 200;
  const started = Date.now();

  signal(running.pid, 'SIGTERM');

  const deadline = started + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(running.pid)) {
      return { pid: running.pid, method: 'term', elapsed_ms: Date.now() - started };
    }
    await sleep(pollMs);
  }

  signal(running.pid, 'SIGKILL');
  await waitForExit(running.pid);
  return { pid: running.pid, method: 'kill', elapsed_ms: Date.now() - started };
}

/** Send SIGKILL immediately. Throws `AxeError(lifecycle)` if not running. */
export async function killServer(
  layout: Layout,
  options: { procRoot?: string } = {},
): Promise<RunningServer> {
  if (layout.platform !== 'linux') {
    throw new AxeError('lifecycle', 'v0.1 lifecycle is linux-only; windows lifecycle lands later');
  }

  const findOptions: { procRoot?: string } = {};
  if (options.procRoot !== undefined) findOptions.procRoot = options.procRoot;
  const running = await findRunningServer(layout, findOptions);
  if (!running) {
    throw new AxeError('lifecycle', 'no running server');
  }
  signal(running.pid, 'SIGKILL');
  await waitForExit(running.pid);
  return running;
}

/**
 * Maximum time we'll spin waiting for a SIGKILL'd pid to disappear from the
 * process table. In practice the kernel reaps within milliseconds, but
 * unreapable zombies (broken parent) or namespace edge cases could otherwise
 * hang the verb forever.
 */
const POST_KILL_TIMEOUT_MS = 5000;

async function waitForExit(pid: number): Promise<void> {
  const deadline = Date.now() + POST_KILL_TIMEOUT_MS;
  while (isProcessAlive(pid)) {
    if (Date.now() > deadline) {
      throw new AxeError(
        'lifecycle',
        `pid ${pid} still alive ${POST_KILL_TIMEOUT_MS}ms after SIGKILL (zombie or namespace race?)`,
      );
    }
    await sleep(50);
  }
}

/**
 * Stop (if running) then start. Tolerates "not running" before start —
 * `restart` of an already-stopped server is functionally identical to
 * `start`, with `stopped_pid` reported as null.
 */
export async function restartServer(
  config: Config,
  layout: Layout,
  options: RestartServerOptions = {},
): Promise<RestartOutcome> {
  let stopped_pid: number | null = null;
  try {
    const stopped = await stopServer(layout, options);
    stopped_pid = stopped.pid;
  } catch (e) {
    if (e instanceof AxeError && e.kind === 'lifecycle' && e.message === 'no running server') {
      // expected when restarting a stopped server
    } else {
      throw e;
    }
  }
  const started = await startServer(config, layout, options);
  return { stopped_pid, new_pid: started.pid };
}

async function pickLauncher(layout: Layout): Promise<string> {
  if (layout.launcher_script) {
    try {
      await stat(layout.launcher_script);
      return layout.launcher_script;
    } catch {
      // launcher missing — fall through to binary
    }
  }
  return layout.binary;
}

function signal(pid: number, sig: NodeJS.Signals): void {
  try {
    process.kill(pid, sig);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return; // already exited
    throw new AxeError('lifecycle', `failed to send ${sig} to pid ${pid}: ${(e as Error).message}`);
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
