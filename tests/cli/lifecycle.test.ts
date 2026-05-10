import { afterEach, describe, expect, test } from 'bun:test';
import { chmod, copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ENTRY = 'src/bin.ts';
const REPO_ROOT = process.cwd();
const TMP_DIRS: string[] = [];
const STARTED_PIDS: number[] = [];

afterEach(async () => {
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

async function syntheticInstall(): Promise<{ root: string; configPath: string }> {
  const root = join(tmpdir(), `axe-cli-lc-${Date.now()}-${Math.random()}`);
  await mkdir(root, { recursive: true });
  TMP_DIRS.push(root);

  const binDir = join(root, 'ConanSandbox/Binaries/Linux');
  await mkdir(binDir, { recursive: true });
  const binary = join(binDir, 'ConanSandboxServer-Linux-Shipping');
  // Use a real ELF (sleep) at the binary path. /proc/<pid>/exe will point
  // to *this copy* (kernel records the path used to exec), so
  // findRunningServer matches by path. A bun-shebang script would make
  // /proc/<pid>/exe point at the bun interpreter instead.
  await copyFile('/usr/bin/sleep', binary);
  await chmod(binary, 0o755);

  const configPath = join(root, 'axe.toml');
  // launch_args = "30" -> sleep 30 seconds, ample time for the test to
  // SIGTERM. sleep responds to SIGTERM by exiting (default action).
  await writeFile(
    configPath,
    `schema = 1
[server]
id = "test"
root = "${root}"
launch_args = ["30"]
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

describe('axe start / stop', () => {
  test('start (detached) → stop round-trip against the stub binary', async () => {
    const { root, configPath } = await syntheticInstall();

    const startResult = await runAxe(['--json', '--config', configPath, 'start'], root);
    expect(startResult.exit).toBe(0);
    const startEnv = JSON.parse(startResult.stdout);
    expect(startEnv.ok).toBe(true);
    expect(startEnv.command).toBe('start');
    expect(startEnv.data.foreground).toBe(false);
    expect(typeof startEnv.data.pid).toBe('number');
    STARTED_PIDS.push(startEnv.data.pid);

    const stopResult = await runAxe(
      ['--json', '--config', configPath, 'stop', '--timeout', '5'],
      root,
    );
    expect(stopResult.exit).toBe(0);
    const stopEnv = JSON.parse(stopResult.stdout);
    expect(stopEnv.data.pid).toBe(startEnv.data.pid);
    expect(stopEnv.data.method).toBe('term');
    STARTED_PIDS.pop();
  });

  test('stop with no running server exits Lifecycle (30)', async () => {
    const { root, configPath } = await syntheticInstall();
    const result = await runAxe(['--json', '--config', configPath, 'stop'], root);
    expect(result.exit).toBe(30);
    const env = JSON.parse(result.stdout);
    expect(env.ok).toBe(false);
    expect(env.error.code).toBe(30);
    expect(env.error.message).toContain('no running server');
  });
});
