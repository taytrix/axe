import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConfig } from '../../src/core/config.ts';

const ENTRY = 'src/bin.ts';
const REPO_ROOT = process.cwd();
const TMP_DIRS: string[] = [];

afterEach(async () => {
  while (TMP_DIRS.length > 0) {
    const dir = TMP_DIRS.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

async function freshTmp(): Promise<string> {
  const dir = (await mkdir(join(tmpdir(), `axe-init-${Date.now()}-${Math.random()}`), {
    recursive: true,
  })) as string;
  TMP_DIRS.push(dir);
  return dir;
}

async function syntheticLinuxRoot(): Promise<string> {
  const root = await freshTmp();
  const binDir = join(root, 'ConanSandbox/Binaries/Linux');
  await mkdir(binDir, { recursive: true });
  await writeFile(join(binDir, 'ConanSandboxServer-Linux-Shipping'), '');
  return root;
}

type RunResult = { stdout: string; stderr: string; exit: number };

async function runAxe(args: string[], cwd: string): Promise<RunResult> {
  const proc = Bun.spawn(['bun', join(REPO_ROOT, ENTRY), ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exit = await proc.exited;
  return { stdout, stderr, exit };
}

describe('axe init', () => {
  test('--dry-run prints toml that round-trips', async () => {
    const cwd = await freshTmp();
    const { stdout, exit } = await runAxe(['init', '--dry-run', cwd], cwd);
    expect(exit).toBe(0);
    // strip the leading "# would write to ..." comment line
    const tomlText = stdout.split('\n').slice(1).join('\n');
    const cfg = parseConfig(tomlText);
    expect(cfg.server.root).toBe(cwd);
  });

  test('refuses overwrite when axe.toml already exists', async () => {
    const cwd = await freshTmp();
    await writeFile(join(cwd, 'axe.toml'), 'schema = 1\n[server]\nid = "x"\nroot = "/tmp"\n');
    const { exit, stderr } = await runAxe(['init', cwd], cwd);
    expect(exit).toBe(10); // ExitCode.Config
    expect(stderr).toContain('already exists');
  });

  test('--probe against synthetic linux install includes platform', async () => {
    const root = await syntheticLinuxRoot();
    const cwd = await freshTmp();
    const { stdout, exit } = await runAxe(['--json', 'init', '--probe', root], cwd);
    expect(exit).toBe(0);
    const env = JSON.parse(stdout);
    expect(env.ok).toBe(true);
    expect(env.data.platform).toBe('linux');
    expect(env.data.root).toBe(root);
    // file actually written
    const written = await readFile(join(cwd, 'axe.toml'), 'utf8');
    expect(written).toContain('schema = 1');
  });
});
