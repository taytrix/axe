import { afterEach, describe, expect, test } from 'bun:test';
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
  const dir = (await mkdir(join(tmpdir(), `axe-doctor-cli-${Date.now()}-${Math.random()}`), {
    recursive: true,
  })) as string;
  TMP_DIRS.push(dir);
  return dir;
}

async function syntheticLinuxRoot(): Promise<string> {
  const root = await freshTmp();
  const binDir = join(root, 'ConanSandbox/Binaries/Linux');
  await mkdir(binDir, { recursive: true });
  const bin = join(binDir, 'ConanSandboxServer-Linux-Shipping');
  await writeFile(bin, '');
  await chmod(bin, 0o755);
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

describe('axe doctor', () => {
  test('synthetic install emits envelope under --json and exits 0', async () => {
    const root = await syntheticLinuxRoot();
    const cwd = await freshTmp();
    await writeFile(join(cwd, 'axe.toml'), `schema = 1\n[server]\nid = "test"\nroot = "${root}"\n`);
    const { stdout, exit } = await runAxe(['--json', 'doctor'], cwd);
    expect(exit).toBe(0);
    const env = JSON.parse(stdout);
    expect(env.ok).toBe(true);
    expect(env.command).toBe('doctor');
    expect(Array.isArray(env.data.findings)).toBe(true);
    expect(env.data.findings.length).toBeGreaterThan(0);
  });

  test('missing axe.toml exits ExitCode.Config with semantic envelope kind', async () => {
    const cwd = await freshTmp();
    const { stdout, exit } = await runAxe(['--json', 'doctor'], cwd);
    expect(exit).toBe(10); // ExitCode.Config
    const env = JSON.parse(stdout);
    expect(env.ok).toBe(false);
    expect(env.error.code).toBe(10);
    expect(env.error.kind).toBe('config');
  });
});
