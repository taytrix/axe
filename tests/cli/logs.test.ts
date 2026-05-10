import { afterEach, describe, expect, test } from 'bun:test';
import { chmod, copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ENTRY = 'src/bin.ts';
const REPO_ROOT = process.cwd();
const FIXTURE_LOG = join(REPO_ROOT, 'tests/fixtures/sample-conan.log');
const TMP_DIRS: string[] = [];

afterEach(async () => {
  while (TMP_DIRS.length > 0) {
    const dir = TMP_DIRS.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

async function syntheticInstall(): Promise<{ root: string; configPath: string }> {
  const root = join(tmpdir(), `axe-cli-logs-${Date.now()}-${Math.random()}`);
  await mkdir(root, { recursive: true });
  TMP_DIRS.push(root);

  const binDir = join(root, 'ConanSandbox/Binaries/Linux');
  await mkdir(binDir, { recursive: true });
  const bin = join(binDir, 'ConanSandboxServer-Linux-Shipping');
  await writeFile(bin, '');
  await chmod(bin, 0o755);

  const logsDir = join(root, 'ConanSandbox/Saved/Logs');
  await mkdir(logsDir, { recursive: true });
  await copyFile(FIXTURE_LOG, join(logsDir, 'ConanSandbox.log'));

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

describe('axe logs', () => {
  test('logs path returns logs_dir + current ConanSandbox.log', async () => {
    const { root, configPath } = await syntheticInstall();
    const { stdout, exit } = await runAxe(['--json', '--config', configPath, 'logs', 'path'], root);
    expect(exit).toBe(0);
    const env = JSON.parse(stdout);
    expect(env.ok).toBe(true);
    expect(env.command).toBe('logs path');
    expect(env.data.logs_dir).toBe(join(root, 'ConanSandbox/Saved/Logs'));
    expect(env.data.current_log).toBe(join(root, 'ConanSandbox/Saved/Logs/ConanSandbox.log'));
  });

  test('logs tail --lines 3 --json returns the 3 most recent lines', async () => {
    const { root, configPath } = await syntheticInstall();
    const { stdout, exit } = await runAxe(
      ['--json', '--config', configPath, 'logs', 'tail', '--lines', '3'],
      root,
    );
    expect(exit).toBe(0);
    const env = JSON.parse(stdout);
    expect(env.data.lines.length).toBe(3);
    expect(env.data.lines[0]).toContain('tick 6');
    expect(env.data.lines[2]).toContain('tick 8');
  });

  test('logs tail --json --follow exits Misuse (no streaming JSON shape)', async () => {
    const { root, configPath } = await syntheticInstall();
    const { exit } = await runAxe(
      ['--json', '--config', configPath, 'logs', 'tail', '--follow'],
      root,
    );
    expect(exit).toBe(2);
  });
});
