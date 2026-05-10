import { afterEach, describe, expect, test } from 'bun:test';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ENTRY = 'src/bin.ts';
const REPO_ROOT = process.cwd();
const STUB = join(REPO_ROOT, 'tests/fixtures/steamcmd-stub.sh');
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

async function configFor(root: string): Promise<string> {
  const configPath = join(root, 'axe.toml');
  await writeFile(
    configPath,
    `schema = 1
[server]
id = "test"
root = "${root}"
[steamcmd]
binary = "${STUB}"
`,
  );
  return configPath;
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

describe('axe install', () => {
  test('runs the stub steamcmd and verifies the server binary', async () => {
    const root = await freshTmp('axe-install');
    const configPath = await configFor(root);

    const { stdout, exit } = await runAxe(['--json', '--config', configPath, 'install'], root);
    expect(exit).toBe(0);
    const env = JSON.parse(stdout);
    expect(env.ok).toBe(true);
    expect(env.command).toBe('install');
    expect(env.data.root).toBe(root);
    expect(env.data.validated).toBe(false);
    expect(env.data.build_id).toBe('99999');
    expect(env.data.log_file).toContain('.axe/steamcmd-install-');

    // Binary should have been created by the stub
    await access(join(root, 'ConanSandbox/Binaries/Linux/ConanSandboxServer-Linux-Shipping'));
  });

  test('--validate sets `validated: true` in the envelope', async () => {
    const root = await freshTmp('axe-install');
    const configPath = await configFor(root);

    const { stdout, exit } = await runAxe(
      ['--json', '--config', configPath, 'install', '--validate'],
      root,
    );
    expect(exit).toBe(0);
    const env = JSON.parse(stdout);
    expect(env.data.validated).toBe(true);
  });
});
