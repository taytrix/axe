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

async function freshTmp(prefix: string): Promise<string> {
  const dir = (await mkdir(join(tmpdir(), `${prefix}-${Date.now()}-${Math.random()}`), {
    recursive: true,
  })) as string;
  TMP_DIRS.push(dir);
  return dir;
}

async function syntheticInstall(serverId: string): Promise<{ root: string; configPath: string }> {
  const root = await freshTmp('axe-service');
  const binDir = join(root, 'ConanSandbox/Binaries/Linux');
  await mkdir(binDir, { recursive: true });
  const bin = join(binDir, 'ConanSandboxServer-Linux-Shipping');
  await writeFile(bin, '');
  await chmod(bin, 0o755);
  const configPath = join(root, 'axe.toml');
  await writeFile(
    configPath,
    `schema = 1
[server]
id = "${serverId}"
root = "${root}"
[mods]
ids = []
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
    env: { ...process.env },
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exit = await proc.exited;
  return { stdout, stderr, exit };
}

describe('axe service print', () => {
  test('default mode foreground; --json envelope shape and contents', async () => {
    const { root, configPath } = await syntheticInstall('mybox');
    const { stdout, exit } = await runAxe(
      ['--json', '--config', configPath, 'service', 'print'],
      root,
    );
    expect(exit).toBe(0);
    const env = JSON.parse(stdout);
    expect(env.ok).toBe(true);
    expect(env.command).toBe('service print');
    expect(env.data.mode).toBe('foreground');
    expect(env.data.name).toBe('axe-mybox');
    expect(env.data.text).toContain('start --foreground');
    expect(env.data.text).toContain('WantedBy=default.target');
    expect(env.data.install_path).toMatch(/\/\.config\/systemd\/user\/axe-mybox\.service$/);
    expect(env.data.config_path).toBe(configPath);
  });

  test('--mode daemon --name custom: runs `daemon run`; honours custom name', async () => {
    const { root, configPath } = await syntheticInstall('mybox');
    const { stdout, exit } = await runAxe(
      [
        '--json',
        '--config',
        configPath,
        'service',
        'print',
        '--mode',
        'daemon',
        '--name',
        'custom',
      ],
      root,
    );
    expect(exit).toBe(0);
    const env = JSON.parse(stdout);
    expect(env.data.mode).toBe('daemon');
    expect(env.data.name).toBe('custom');
    expect(env.data.text).toContain('daemon run');
    expect(env.data.text).toContain('WantedBy=default.target');
    expect(env.data.install_path).toMatch(/\/\.config\/systemd\/user\/custom\.service$/);
  });
});
