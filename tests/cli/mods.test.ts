import { afterEach, describe, expect, test } from 'bun:test';
import { chmod, copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ENTRY = 'src/bin.ts';
const REPO_ROOT = process.cwd();
const FIXTURE_ACF = join(REPO_ROOT, 'tests/fixtures/sample-workshop.acf');
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

async function syntheticInstall(
  declaredIds: bigint[],
): Promise<{ root: string; configPath: string }> {
  const root = await freshTmp('axe-mods');
  const binDir = join(root, 'ConanSandbox/Binaries/Linux');
  await mkdir(binDir, { recursive: true });
  const bin = join(binDir, 'ConanSandboxServer-Linux-Shipping');
  await writeFile(bin, '');
  await chmod(bin, 0o755);
  const workshop = join(root, 'steamapps/workshop');
  await mkdir(workshop, { recursive: true });
  await copyFile(FIXTURE_ACF, join(workshop, 'appworkshop_440900.acf'));
  const configPath = join(root, 'axe.toml');
  const idsLine = declaredIds.map((id) => id.toString()).join(', ');
  await writeFile(
    configPath,
    `schema = 1\n[server]\nid = "test"\nroot = "${root}"\n[mods]\nids = [${idsLine}]\n`,
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

const FIXTURE_IDS: bigint[] = [3721090132n, 3721096154n, 3721177576n, 3721991191n];

describe('axe mods', () => {
  test('mods list prints declared IDs in declared order', async () => {
    const { root, configPath } = await syntheticInstall(FIXTURE_IDS);
    const { stdout, exit } = await runAxe(['--json', '--config', configPath, 'mods', 'list'], root);
    expect(exit).toBe(0);
    const env = JSON.parse(stdout);
    expect(env.ok).toBe(true);
    expect(env.command).toBe('mods list');
    expect(env.data.items.length).toBe(4);
    expect(env.data.items[0].id).toBe('3721090132');
    expect(env.data.items[3].id).toBe('3721991191');
  });

  test('mods check with offline fallback emits warnings field', async () => {
    const { root, configPath } = await syntheticInstall(FIXTURE_IDS);
    // simulate API unreachable by pointing at a black-hole address with short timeout
    // we monkey-patch by setting a bogus DNS via the process env? simpler: set a bad
    // proxy env... instead, rely on AbortController by using a local server that hangs.
    // Pragmatic: use --network=none isn't available here; instead, use a SIGABRT-equivalent
    // by setting a TLS-impossible URL is hard too. So test the fallback path indirectly:
    // directly invoke checkModFreshness with empty remote (covered in core tests) and
    // assert here that the CLI surfaces the warnings field when the API fails. Easiest:
    // override fetch by using a tiny in-process server on a dead port.
    // Strategy: set an HTTP_PROXY env var to a port nothing listens on. Bun's fetch
    // honors HTTP_PROXY for http/https.
    const { stdout, exit } = await runAxe(
      ['--json', '--config', configPath, 'mods', 'check'],
      root,
      { HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1' },
    );
    // expected: HTTP fetch fails -> warnings present + ACF-only fallback -> exit 0 (current per ACF)
    expect(exit).toBe(0);
    const env = JSON.parse(stdout);
    expect(env.ok).toBe(true);
    expect(Array.isArray(env.warnings)).toBe(true);
    expect(env.warnings.length).toBeGreaterThan(0);
    expect(env.warnings[0]).toContain('workshop API unreachable');
    // ACF-only fallback: all 4 marked current (installed time matches latest_time in ACF)
    expect(env.data.current).toBe(4);
  });

  test('mods check exits Drift (50) when synthetic stale ACF', async () => {
    const { root, configPath } = await syntheticInstall(FIXTURE_IDS);
    // Mutate ACF so latest_time_updated is bumped past installed time.
    const acfPath = join(root, 'steamapps/workshop/appworkshop_440900.acf');
    const text = await Bun.file(acfPath).text();
    // Bump every latest_timeupdated by 100 seconds.
    const bumped = text.replace(
      /"latest_timeupdated"\s+"(\d+)"/g,
      (_full, ts) => `"latest_timeupdated"\t\t"${Number.parseInt(ts, 10) + 100}"`,
    );
    await writeFile(acfPath, bumped);
    // Force offline fallback so we judge by ACF latest_* alone.
    const { stdout, exit } = await runAxe(
      ['--json', '--config', configPath, 'mods', 'check'],
      root,
      { HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1' },
    );
    expect(exit).toBe(50);
    const env = JSON.parse(stdout);
    expect(env.data.stale).toBe(4);
  });

  test('mods check with no declared mods exits Ok', async () => {
    const { root, configPath } = await syntheticInstall([]);
    const { stdout, exit } = await runAxe(
      ['--json', '--config', configPath, 'mods', 'check'],
      root,
    );
    expect(exit).toBe(0);
    const env = JSON.parse(stdout);
    expect(env.data.total).toBe(0);
  });
});
