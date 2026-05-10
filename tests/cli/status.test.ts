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

async function syntheticInstall(): Promise<{ root: string; configPath: string }> {
  const root = join(tmpdir(), `axe-cli-status-${Date.now()}-${Math.random()}`);
  await mkdir(root, { recursive: true });
  TMP_DIRS.push(root);

  const binDir = join(root, 'ConanSandbox/Binaries/Linux');
  await mkdir(binDir, { recursive: true });
  const binary = join(binDir, 'ConanSandboxServer-Linux-Shipping');
  await writeFile(binary, '');
  await chmod(binary, 0o755);

  const configPath = join(root, 'axe.toml');
  await writeFile(
    configPath,
    `schema = 1
[server]
id = "test"
root = "${root}"
`,
  );
  return { root, configPath };
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

describe('axe status', () => {
  test('no running server, no --with-mods → envelope shape', async () => {
    const { root, configPath } = await syntheticInstall();
    const { stdout, exit } = await runAxe(['--json', '--config', configPath, 'status'], root);
    expect(exit).toBe(0);
    const env = JSON.parse(stdout);
    expect(env.ok).toBe(true);
    expect(env.command).toBe('status');
    expect(env.data.config_path).toBe(configPath);
    expect(env.data.server_id).toBe('test');
    expect(env.data.platform).toBe('linux');
    expect(env.data.root).toBe(root);
    expect(env.data.running).toBeNull();
    expect(env.data.mods).toBeNull();
  });
});
