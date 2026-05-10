import { afterEach, describe, expect, test } from 'bun:test';
import { chmod, copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ENTRY = 'src/bin.ts';
const REPO_ROOT = process.cwd();
const STUB = join(REPO_ROOT, 'tests/fixtures/steamcmd-stub.sh');
const FIXTURE_ACF = join(REPO_ROOT, 'tests/fixtures/sample-workshop.acf');
const TMP_DIRS: string[] = [];

afterEach(async () => {
  while (TMP_DIRS.length > 0) {
    const dir = TMP_DIRS.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

async function freshTmp(prefix: string): Promise<string> {
  const dir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random()}`);
  await mkdir(dir, { recursive: true });
  TMP_DIRS.push(dir);
  return dir;
}

/**
 * Synthetic install: server binary in place, ACF staged with the 4 fixture
 * IDs marked installed-but-no-content. The ACF says manifest=latest_manifest
 * (current per ACF) but the workshop content tree has no .pak files yet —
 * so when we go offline, freshness sees "current" and sync hits the fast path
 * (skipping steamcmd). We force a sync by mutating the ACF to make all 4
 * `missing_local`-equivalent (ACF empty).
 */
async function syntheticInstall(opts: { withAcf: boolean }): Promise<{
  root: string;
  configPath: string;
}> {
  const root = await freshTmp('axe-sync');
  const binDir = join(root, 'ConanSandbox/Binaries/Linux');
  await mkdir(binDir, { recursive: true });
  const bin = join(binDir, 'ConanSandboxServer-Linux-Shipping');
  await writeFile(bin, '');
  await chmod(bin, 0o755);

  if (opts.withAcf) {
    const workshop = join(root, 'steamapps/workshop');
    await mkdir(workshop, { recursive: true });
    await copyFile(FIXTURE_ACF, join(workshop, 'appworkshop_440900.acf'));
  }

  const configPath = join(root, 'axe.toml');
  await writeFile(
    configPath,
    `schema = 1
[server]
id = "test"
root = "${root}"
[mods]
ids = [3721090132, 3721096154, 3721177576, 3721991191]
[steamcmd]
binary = "${STUB}"
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

describe('axe mods sync', () => {
  test('writes correct modlist when ACF is empty (all missing_local → all downloaded)', async () => {
    const { root, configPath } = await syntheticInstall({ withAcf: false });

    // Force offline so the freshness check classifies all four as missing_local.
    const { stdout, exit } = await runAxe(
      ['--json', '--config', configPath, 'mods', 'sync'],
      root,
      { HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1' },
    );
    expect(exit).toBe(0);
    const env = JSON.parse(stdout);
    expect(env.ok).toBe(true);
    expect(env.command).toBe('mods sync');
    expect(env.data.downloaded.length).toBe(4);
    expect(env.data.missing).toEqual([]);
    expect(env.data.modlist_changed).toBe(true);

    const modlist = await readFile(join(root, 'ConanSandbox/Mods/modlist.txt'), 'utf8');
    const lines = modlist.split('\n').filter(Boolean);
    expect(lines.length).toBe(4);
    expect(lines[0]).toContain('3721090132/3721090132.pak');
    expect(lines[3]).toContain('3721991191/3721991191.pak');
  });

  test('idempotent: re-run after content present is zero-write', async () => {
    const { root, configPath } = await syntheticInstall({ withAcf: false });

    await runAxe(['--config', configPath, 'mods', 'sync'], root, {
      HTTP_PROXY: 'http://127.0.0.1:1',
      HTTPS_PROXY: 'http://127.0.0.1:1',
    });
    const stat1 = await stat(join(root, 'ConanSandbox/Mods/modlist.txt'));

    // Mutate ACF to look like everything's installed AND current, so the
    // freshness check returns all-current and sync takes the fast path.
    const acfPath = join(root, 'steamapps/workshop/appworkshop_440900.acf');
    await mkdir(join(root, 'steamapps/workshop'), { recursive: true });
    await writeFile(
      acfPath,
      `"AppWorkshop"
{
  "WorkshopItemsInstalled"
  {
    "3721090132" { "manifest" "100" "timeupdated" "1000" }
    "3721096154" { "manifest" "100" "timeupdated" "1000" }
    "3721177576" { "manifest" "100" "timeupdated" "1000" }
    "3721991191" { "manifest" "100" "timeupdated" "1000" }
  }
  "WorkshopItemDetails"
  {
    "3721090132" { "manifest" "100" "timeupdated" "1000" "latest_manifest" "100" "latest_timeupdated" "1000" }
    "3721096154" { "manifest" "100" "timeupdated" "1000" "latest_manifest" "100" "latest_timeupdated" "1000" }
    "3721177576" { "manifest" "100" "timeupdated" "1000" "latest_manifest" "100" "latest_timeupdated" "1000" }
    "3721991191" { "manifest" "100" "timeupdated" "1000" "latest_manifest" "100" "latest_timeupdated" "1000" }
  }
}
`,
    );

    await new Promise((r) => setTimeout(r, 10));

    const { stdout, exit } = await runAxe(
      ['--json', '--config', configPath, 'mods', 'sync'],
      root,
      { HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1' },
    );
    expect(exit).toBe(0);
    const env = JSON.parse(stdout);
    expect(env.data.downloaded).toEqual([]);
    expect(env.data.modlist_changed).toBe(false);

    const stat2 = await stat(join(root, 'ConanSandbox/Mods/modlist.txt'));
    expect(stat2.mtimeMs).toBe(stat1.mtimeMs);
  });
});
