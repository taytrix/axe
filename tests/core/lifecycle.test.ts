import { afterEach, describe, expect, test } from 'bun:test';
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Config } from '../../src/core/config.ts';
import { AxeError } from '../../src/core/errors.ts';
import { layoutAt } from '../../src/core/layout.ts';
import { killServer, restartServer, startServer, stopServer } from '../../src/core/lifecycle.ts';

const STUB = join(process.cwd(), 'tests/fixtures/server-stub.ts');
const TMP_DIRS: string[] = [];
const STARTED_PIDS: number[] = [];

afterEach(async () => {
  // Best-effort kill of any stragglers (especially the SIGTERM-ignoring stub).
  while (STARTED_PIDS.length > 0) {
    const pid = STARTED_PIDS.pop();
    if (pid !== undefined) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // already gone
      }
    }
  }
  while (TMP_DIRS.length > 0) {
    const dir = TMP_DIRS.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

async function freshInstall(): Promise<{ root: string; procRoot: string; config: Config }> {
  const root = join(tmpdir(), `axe-lc-${Date.now()}-${Math.random()}`);
  await mkdir(root, { recursive: true });
  TMP_DIRS.push(root);

  const layout = layoutAt(root, 'linux');
  // Binary = bun stub at the canonical layout path. No launcher_script —
  // startServer's pickLauncher() falls back to the binary when launcher is
  // absent.
  await mkdir(join(root, 'ConanSandbox/Binaries/Linux'), { recursive: true });
  await copyFile(STUB, layout.binary);
  const { chmod } = await import('node:fs/promises');
  await chmod(layout.binary, 0o755);

  const procRoot = join(tmpdir(), `axe-lc-proc-${Date.now()}-${Math.random()}`);
  await mkdir(procRoot, { recursive: true });
  TMP_DIRS.push(procRoot);

  const config: Config = {
    schema: 1,
    server: { id: 'test', root, launch_args: [] }, // no extra args; stub ignores them
    network: { game_port: 7777, steam_port: 7778, rcon_port: 25575 },
    update: { poll_interval: '5m', branch: 'public' },
    mods: { ids: [], restart_on_change: true },
  };

  return { root, procRoot, config };
}

/** Symlink `<procRoot>/<pid>/exe -> target` to mock /proc for findRunningServer. */
async function fakeProc(procRoot: string, pid: number, target: string): Promise<void> {
  const dir = join(procRoot, String(pid));
  await mkdir(dir, { recursive: true });
  const { symlink } = await import('node:fs/promises');
  await symlink(target, join(dir, 'exe'));
}

describe('startServer', () => {
  test('detaches by default; returns pid; parent does not block', async () => {
    const { root, procRoot, config } = await freshInstall();
    const layout = layoutAt(root, 'linux');

    const t0 = Date.now();
    const outcome = await startServer(config, layout, { procRoot });
    const elapsed = Date.now() - t0;
    STARTED_PIDS.push(outcome.pid);

    expect(outcome.foreground).toBe(false);
    expect(outcome.pid).toBeGreaterThan(0);
    // Detached start should return promptly (much less than the 30s sleep).
    expect(elapsed).toBeLessThan(2000);

    // Process should be alive.
    expect(() => process.kill(outcome.pid, 0)).not.toThrow();
  });

  test('throws lifecycle error when a server is already running', async () => {
    const { root, procRoot, config } = await freshInstall();
    const layout = layoutAt(root, 'linux');

    // Plant a fake /proc entry for some pid that points at the layout binary.
    // Use this process's own pid; readlink-target match is what matters.
    await fakeProc(procRoot, process.pid, layout.binary);

    await expect(startServer(config, layout, { procRoot })).rejects.toThrow(/already running/);
  });
});

describe('stopServer', () => {
  test('SIGTERM happy path: stub exits, method=term', async () => {
    const { root, procRoot, config } = await freshInstall();
    const layout = layoutAt(root, 'linux');

    const started = await startServer(config, layout, { procRoot });
    STARTED_PIDS.push(started.pid);

    // Plant /proc entry pointing the started pid's exe at layout.binary.
    await fakeProc(procRoot, started.pid, layout.binary);

    const outcome = await stopServer(layout, { procRoot, timeoutSec: 5, pollMs: 50 });
    expect(outcome.method).toBe('term');
    expect(outcome.pid).toBe(started.pid);
    expect(outcome.elapsed_ms).toBeGreaterThanOrEqual(0);
    expect(outcome.elapsed_ms).toBeLessThan(5000);

    // Pid should be gone.
    expect(() => process.kill(started.pid, 0)).toThrow();
    STARTED_PIDS.pop(); // already cleaned
  });

  test('escalates to SIGKILL when stub ignores SIGTERM', async () => {
    const { root, procRoot, config } = await freshInstall();
    const layout = layoutAt(root, 'linux');

    // Spawn the stub directly with AXE_STUB_IGNORE_TERM so it ignores SIGTERM.
    // Bypass startServer to control env.
    const proc = Bun.spawn([layout.binary], {
      cwd: layout.root,
      env: {
        ...process.env,
        AXE_STUB_IGNORE_TERM: '1',
        AXE_STUB_DURATION: '30',
      },
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'ignore',
    });
    // Wait for the stub to install its SIGTERM handler. Bun startup ~50ms;
    // 200ms is conservative. In production, Conan takes seconds to start so
    // this race never matters there.
    await new Promise((r) => setTimeout(r, 200));
    STARTED_PIDS.push(proc.pid);
    await fakeProc(procRoot, proc.pid, layout.binary);

    const outcome = await stopServer(layout, { procRoot, timeoutSec: 1, pollMs: 50 });
    expect(outcome.method).toBe('kill');
    expect(outcome.elapsed_ms).toBeGreaterThanOrEqual(1000);
    STARTED_PIDS.pop();
  }, 10_000);

  test('throws when no server is running', async () => {
    const { root, procRoot } = await freshInstall();
    const layout = layoutAt(root, 'linux');
    await expect(stopServer(layout, { procRoot })).rejects.toThrow(/no running server/);
  });
});

describe('killServer', () => {
  test('SIGKILL immediately', async () => {
    const { root, procRoot, config } = await freshInstall();
    const layout = layoutAt(root, 'linux');

    const started = await startServer(config, layout, { procRoot });
    STARTED_PIDS.push(started.pid);
    await fakeProc(procRoot, started.pid, layout.binary);

    const result = await killServer(layout, { procRoot });
    expect(result.pid).toBe(started.pid);
    expect(() => process.kill(started.pid, 0)).toThrow();
    STARTED_PIDS.pop();
  });
});

describe('restartServer', () => {
  test('not-running tolerance: skips stop, starts fresh, stopped_pid=null', async () => {
    const { root, procRoot, config } = await freshInstall();
    const layout = layoutAt(root, 'linux');

    const outcome = await restartServer(config, layout, { procRoot });
    STARTED_PIDS.push(outcome.new_pid);

    expect(outcome.stopped_pid).toBeNull();
    expect(outcome.new_pid).toBeGreaterThan(0);
  });
});

describe('platform guards', () => {
  test('startServer on windows throws lifecycle error (v0.1 linux-only)', async () => {
    const layout = layoutAt('C:/srv/conan', 'windows');
    const config: Config = {
      schema: 1,
      server: { id: 'test', root: 'C:/srv/conan', launch_args: [] },
      network: { game_port: 7777, steam_port: 7778, rcon_port: 25575 },
      update: { poll_interval: '5m', branch: 'public' },
      mods: { ids: [], restart_on_change: true },
    };
    await expect(startServer(config, layout)).rejects.toBeInstanceOf(AxeError);
  });
});
