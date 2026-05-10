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

  test('mods check exits Drift (50) when ACF manifest != latest_manifest', async () => {
    const { root, configPath } = await syntheticInstall(FIXTURE_IDS);
    // Drift triggered locally via manifest mismatch, so the verdict is independent
    // of the live Workshop API response. We still go offline for test isolation —
    // network state shouldn't change CLI exit code in a unit test.
    const acfPath = join(root, 'steamapps/workshop/appworkshop_440900.acf');
    const text = await Bun.file(acfPath).text();
    const bumped = text.replace(
      /"latest_manifest"\s+"(\d+)"/g,
      (_full, m) => `"latest_manifest"\t\t"${BigInt(m) + 1n}"`,
    );
    await writeFile(acfPath, bumped);
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
