import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ENTRY = 'src/bin.ts';
const REPO_ROOT = process.cwd();
const STEAMCMD_STUB = join(REPO_ROOT, 'tests/fixtures/steamcmd-stub.sh');
const TMP_DIRS: string[] = [];

afterEach(async () => {
  while (TMP_DIRS.length > 0) {
    const dir = TMP_DIRS.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

async function freshTmp(prefix: string): Promise<string> {
  const dir = (await mkdir(join(tmpdir(), `${prefix}-${Date.now()}-${Math.random()}`), {
    recursive: true,
  })) as string;
  TMP_DIRS.push(dir);
  return dir;
}

async function syntheticInstall(): Promise<{ root: string; configPath: string }> {
  const root = await freshTmp('axe-daemon-cli');
  const binDir = join(root, 'ConanSandbox/Binaries/Linux');
  await mkdir(binDir, { recursive: true });
  const bin = join(binDir, 'ConanSandboxServer-Linux-Shipping');
  await writeFile(bin, '');
  const { chmod } = await import('node:fs/promises');
  await chmod(bin, 0o755);
  const configPath = join(root, 'axe.toml');
  await writeFile(
    configPath,
    `schema = 1
[server]
id = "test"
root = "${root}"
[update]
poll_interval = "1s"
build_check_every = 12
[mods]
ids = []
[steamcmd]
binary = "${STEAMCMD_STUB}"
`,
  );
  return { root, configPath };
}

type RunResult = { stdout: string; stderr: string; exit: number };

async function runAxe(
  args: string[],
  cwd: string,
  env?: Record<string, string>,
): Promise<RunResult> {
  const proc = Bun.spawn(['bun', join(REPO_ROOT, ENTRY), ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, ...(env ?? {}) },
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exit = await proc.exited;
  return { stdout, stderr, exit };
}

describe('axe daemon status', () => {
  test('with no state.json: running=false, last_state=null, exit Ok', async () => {
    const { root, configPath } = await syntheticInstall();
    const { stdout, exit } = await runAxe(
      ['--json', '--config', configPath, 'daemon', 'status'],
      root,
    );
    expect(exit).toBe(0);
    const env = JSON.parse(stdout);
    expect(env.ok).toBe(true);
    expect(env.command).toBe('daemon status');
    expect(env.data.running).toBe(false);
    expect(env.data.last_state).toBeNull();
  });

  test('with mods.drift=true in state.json: exit Drift (50)', async () => {
    const { root, configPath } = await syntheticInstall();
    // Plant a state.json with drift=true. Realistic enough to satisfy
    // isDriftingState (the only check we need to trigger Drift exit).
    await mkdir(join(root, '.axe'), { recursive: true });
    await writeFile(
      join(root, '.axe/state.json'),
      JSON.stringify({
        schema: 1,
        axe_version: 'test',
        started_at: '2026-05-10T12:00:00Z',
        tick: {
          n: 1,
          at: '2026-05-10T12:00:00Z',
          next_at: '2026-05-10T12:05:00Z',
          interval_seconds: 300,
          duration_ms: 100,
        },
        mods: {
          report: {
            total: 1,
            current: 0,
            stale: 1,
            missing_local: 0,
            missing_remote: 0,
            unmanaged: 0,
            items: [],
          },
          drift: true,
          warnings: [],
        },
        build: null,
        running: null,
        drift_summary: {
          stale_mods: 1,
          missing_local_mods: 0,
          missing_remote_mods: 0,
          build_outdated: false,
        },
      }),
    );
    const { exit } = await runAxe(['--json', '--config', configPath, 'daemon', 'status'], root);
    expect(exit).toBe(50);
  });
});

describe('axe daemon run', () => {
  test('--max-ticks 2 runs two ticks, writes state.json, removes pid file', async () => {
    const { root, configPath } = await syntheticInstall();
    const { exit } = await runAxe(
      ['--json', '--config', configPath, 'daemon', 'run', '--max-ticks', '2', '--interval', '1s'],
      root,
    );
    expect(exit).toBe(0);
    const stateText = await readFile(join(root, '.axe/state.json'), 'utf8');
    const state = JSON.parse(stateText) as { tick: { n: number } };
    expect(state.tick.n).toBe(2);
    // Pid file removed on clean exit.
    await expect(readFile(join(root, '.axe/daemon.pid'), 'utf8')).rejects.toThrow();
  }, 15_000);

  test('refuses to start when pid file points at a live process; exit Lifecycle (30)', async () => {
    const { root, configPath } = await syntheticInstall();
    await mkdir(join(root, '.axe'), { recursive: true });
    await writeFile(join(root, '.axe/daemon.pid'), `${process.pid}\n`);

    const { stdout, exit } = await runAxe(
      ['--json', '--config', configPath, 'daemon', 'run', '--max-ticks', '1', '--interval', '1s'],
      root,
    );
    expect(exit).toBe(30);
    const env = JSON.parse(stdout);
    expect(env.ok).toBe(false);
    expect(env.command).toBe('daemon run');
    // Pid file untouched.
    const pidText = await readFile(join(root, '.axe/daemon.pid'), 'utf8');
    expect(pidText.trim()).toBe(String(process.pid));
  });
});
