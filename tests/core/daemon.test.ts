import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Config } from '../../src/core/config.ts';
import {
  type DaemonState,
  loadDaemonState,
  readDaemonPid,
  runDaemonLoop,
  runDaemonTick,
  saveDaemonState,
} from '../../src/core/daemon.ts';
import { AxeError } from '../../src/core/errors.ts';
import { layoutAt } from '../../src/core/layout.ts';
import type { SpawnLike } from '../../src/core/steamcmd.ts';
import type { FetchLike } from '../../src/core/workshop.ts';

const TMP_DIRS: string[] = [];

afterEach(async () => {
  while (TMP_DIRS.length > 0) {
    const dir = TMP_DIRS.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

async function freshRoot(): Promise<{ root: string; layout: ReturnType<typeof layoutAt> }> {
  const root = join(tmpdir(), `axe-daemon-${Date.now()}-${Math.random()}`);
  await mkdir(root, { recursive: true });
  TMP_DIRS.push(root);
  return { root, layout: layoutAt(root, 'linux') };
}

function configFor(root: string): Config {
  return {
    schema: 1,
    server: { id: 'test', root, launch_args: [] },
    network: { game_port: 7777, steam_port: 7778, rcon_port: 25575 },
    update: { poll_interval: '5m', branch: 'public', build_check_every: 12 },
    mods: { ids: [], restart_on_change: true },
    // Stub binary path; spawn is injected, so this is never executed.
    steamcmd: { binary: '/nonexistent/steamcmd' },
  };
}

/** Fake Workshop API: returns empty (no published files). */
const fakeFetchEmpty: FetchLike = async () =>
  new Response(JSON.stringify({ response: { publishedfiledetails: [] } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

/**
 * Fake spawn that emits a minimal app_info VDF block on stdout (so
 * `checkServerBuild` parses build_id = "99999"). Otherwise emits nothing.
 */
const fakeSpawnAppInfo: SpawnLike = () => {
  const stdout = `Loading Steam API...OK
"443030"
{
\t"depots"
\t{
\t\t"branches"
\t\t{
\t\t\t"public"
\t\t\t{
\t\t\t\t"buildid"\t\t"99999"
\t\t\t}
\t\t}
\t}
}
`;
  return {
    stdout: new Response(stdout).body as ReadableStream<Uint8Array>,
    stderr: new Response('').body as ReadableStream<Uint8Array>,
    exited: Promise.resolve(0),
  };
};

describe('runDaemonTick', () => {
  test('tick.n=1 runs build check (initial); subsequent non-Nth ticks carry forward', async () => {
    const { root, layout } = await freshRoot();
    const config = configFor(root);

    const state1 = await runDaemonTick(config, layout, null, {
      buildCheckEvery: 12,
      intervalSeconds: 300,
      fetchImpl: fakeFetchEmpty,
      spawn: fakeSpawnAppInfo,
    });
    expect(state1.tick.n).toBe(1);
    expect(state1.build?.build_id).toBe('99999');
    expect(state1.tick.interval_seconds).toBe(300);

    // Tick 2 — build check skipped; carries forward state1.build
    const state2 = await runDaemonTick(config, layout, state1, {
      buildCheckEvery: 12,
      intervalSeconds: 300,
      fetchImpl: fakeFetchEmpty,
      // intentionally no spawn — ensures the build branch isn't taken
      spawn: () => {
        throw new Error('build check should be skipped on tick 2');
      },
    });
    expect(state2.tick.n).toBe(2);
    expect(state2.build).toEqual(state1.build);
  });

  test('tick.n divisible by buildCheckEvery runs the build check', async () => {
    const { root, layout } = await freshRoot();
    const config = configFor(root);
    // Synthesize a prevState with tick.n = 3, so the next tick (4) is a build tick when buildCheckEvery=4
    const prev: DaemonState = {
      schema: 1,
      axe_version: 'test',
      started_at: new Date().toISOString(),
      tick: {
        n: 3,
        at: '2026-05-10T12:00:00Z',
        next_at: '2026-05-10T12:05:00Z',
        interval_seconds: 60,
        duration_ms: 100,
      },
      mods: {
        report: {
          total: 0,
          current: 0,
          stale: 0,
          missing_local: 0,
          missing_remote: 0,
          unmanaged: 0,
          items: [],
        },
        drift: false,
        warnings: [],
      },
      build: { checked_at: '2026-05-10T12:00:00Z', build_id: 'old', warnings: [] },
      running: null,
      drift_summary: {
        stale_mods: 0,
        missing_local_mods: 0,
        missing_remote_mods: 0,
        build_outdated: false,
      },
    };

    const next = await runDaemonTick(config, layout, prev, {
      buildCheckEvery: 4,
      intervalSeconds: 60,
      fetchImpl: fakeFetchEmpty,
      spawn: fakeSpawnAppInfo,
    });
    expect(next.tick.n).toBe(4);
    expect(next.build?.build_id).toBe('99999'); // refreshed via fakeSpawnAppInfo
  });

  test('drift detection: declared mods + empty ACF -> drift=true, missing_local>0', async () => {
    const { root, layout } = await freshRoot();
    const config: Config = {
      ...configFor(root),
      mods: { ids: [11n, 22n], restart_on_change: true },
    };
    // No ACF on disk -> all declared classified missing_local.
    const state = await runDaemonTick(config, layout, null, {
      buildCheckEvery: 12,
      intervalSeconds: 60,
      fetchImpl: fakeFetchEmpty,
      spawn: fakeSpawnAppInfo,
    });
    expect(state.mods.drift).toBe(true);
    expect(state.drift_summary.missing_local_mods).toBe(2);
  });
});

describe('saveDaemonState / loadDaemonState', () => {
  test('round-trips through JSON (bigint workshop ids serialize as strings)', async () => {
    const { root, layout } = await freshRoot();
    const config: Config = {
      ...configFor(root),
      mods: { ids: [11n], restart_on_change: true },
    };
    const state = await runDaemonTick(config, layout, null, {
      buildCheckEvery: 12,
      intervalSeconds: 60,
      fetchImpl: fakeFetchEmpty,
      spawn: fakeSpawnAppInfo,
    });
    await saveDaemonState(root, state);

    const loaded = await loadDaemonState(root);
    expect(loaded).not.toBeNull();
    const parsed = loaded as { tick: { n: number }; mods: { drift: boolean } };
    expect(parsed.tick.n).toBe(1);
    expect(parsed.mods.drift).toBe(true);
  });

  test('loadDaemonState returns null when state.json is missing', async () => {
    const { root } = await freshRoot();
    expect(await loadDaemonState(root)).toBeNull();
  });
});

describe('runDaemonLoop', () => {
  test('runs maxTicks=2 and writes state.json + cleans up pid file', async () => {
    const { root, layout } = await freshRoot();
    const config = configFor(root);

    await runDaemonLoop(config, layout, {
      intervalSeconds: 1,
      buildCheckEvery: 12,
      maxTicks: 2,
      fetchImpl: fakeFetchEmpty,
      spawn: fakeSpawnAppInfo,
    });

    const state = (await loadDaemonState(root)) as { tick: { n: number } };
    expect(state.tick.n).toBe(2);
    // pid file removed on clean exit
    expect(await readDaemonPid(root)).toBeNull();
  });

  test('refuses to start when pid file points at a live process', async () => {
    const { root, layout } = await freshRoot();
    const config = configFor(root);
    // Plant a pid file pointing at this test process (alive).
    await mkdir(join(root, '.axe'), { recursive: true });
    await writeFile(join(root, '.axe/daemon.pid'), `${process.pid}\n`);

    await expect(
      runDaemonLoop(config, layout, {
        intervalSeconds: 1,
        maxTicks: 1,
        fetchImpl: fakeFetchEmpty,
        spawn: fakeSpawnAppInfo,
      }),
    ).rejects.toBeInstanceOf(AxeError);

    // Pid file should be untouched (still our planted pid) since startup refused.
    const pidText = await readFile(join(root, '.axe/daemon.pid'), 'utf8');
    expect(pidText.trim()).toBe(String(process.pid));
  });

  test('removes a stale pid file silently before starting', async () => {
    const { root, layout } = await freshRoot();
    const config = configFor(root);
    // Plant a stale pid (very large, unlikely to be a real process).
    await mkdir(join(root, '.axe'), { recursive: true });
    await writeFile(join(root, '.axe/daemon.pid'), '999999\n');

    await runDaemonLoop(config, layout, {
      intervalSeconds: 1,
      maxTicks: 1,
      fetchImpl: fakeFetchEmpty,
      spawn: fakeSpawnAppInfo,
    });

    // Loop completed; pid file should be removed on clean exit.
    expect(await readDaemonPid(root)).toBeNull();
  });
});
