import { afterEach, describe, expect, test } from 'bun:test';
import { access, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Config } from '../../src/core/config.ts';
import { AxeError } from '../../src/core/errors.ts';
import { checkServerBuild, runServerInstall } from '../../src/core/install.ts';
import { layoutAt } from '../../src/core/layout.ts';

const STUB = join(process.cwd(), 'tests/fixtures/steamcmd-stub.sh');
const TMP_DIRS: string[] = [];

afterEach(async () => {
  while (TMP_DIRS.length > 0) {
    const dir = TMP_DIRS.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

async function freshRoot(): Promise<string> {
  const dir = join(tmpdir(), `axe-install-core-${Date.now()}-${Math.random()}`);
  await mkdir(dir, { recursive: true });
  TMP_DIRS.push(dir);
  return dir;
}

function configFor(root: string): Config {
  return {
    schema: 1,
    server: { id: 'test', root, launch_args: ['ConanSandbox', '-log'] },
    network: { game_port: 7777, steam_port: 7778, rcon_port: 25575 },
    update: { poll_interval: '5m', branch: 'public', build_check_every: 12 },
    mods: { ids: [], restart_on_change: true },
    steamcmd: { binary: STUB },
  };
}

describe('runServerInstall', () => {
  test('creates the binary, captures a log, returns build_id', async () => {
    const root = await freshRoot();
    const layout = layoutAt(root, 'linux');
    const result = await runServerInstall(configFor(root), layout, {
      verb: 'install',
      validate: false,
    });
    expect(result.data.root).toBe(root);
    expect(result.data.validated).toBe(false);
    expect(result.data.build_id).toBe('99999');
    expect(result.data.log_file).toContain('.axe/steamcmd-install-');
    expect(result.warnings).toEqual([]);
    await access(layout.binary); // throws if missing
    await access(result.data.log_file); // log written
  });

  test('verb=verify with validate=true is reflected in the data + log filename', async () => {
    const root = await freshRoot();
    const layout = layoutAt(root, 'linux');
    const result = await runServerInstall(configFor(root), layout, {
      verb: 'verify',
      validate: true,
    });
    expect(result.data.validated).toBe(true);
    expect(result.data.log_file).toContain('.axe/steamcmd-verify-');
  });

  test('throws AxeError(config) when no steamcmd binary configured and none on PATH', async () => {
    const root = await freshRoot();
    const layout = layoutAt(root, 'linux');
    // Build config WITHOUT [steamcmd] section. exactOptionalPropertyTypes
    // means omitting the field (not setting it to undefined) is what counts.
    const noSteamcmd: Config = {
      schema: 1,
      server: { id: 'test', root, launch_args: [] },
      network: { game_port: 7777, steam_port: 7778, rcon_port: 25575 },
      update: { poll_interval: '5m', branch: 'public', build_check_every: 12 },
      mods: { ids: [], restart_on_change: true },
    };
    // Mock-out PATH so Bun.which('steamcmd') returns null.
    const oldPath = process.env.PATH;
    process.env.PATH = '/nonexistent';
    try {
      await expect(
        runServerInstall(noSteamcmd, layout, { verb: 'install', validate: false }),
      ).rejects.toBeInstanceOf(AxeError);
    } finally {
      process.env.PATH = oldPath;
    }
  });
});

describe('checkServerBuild', () => {
  test('returns build_id from app_info_print without touching local state', async () => {
    const root = await freshRoot();
    const result = await checkServerBuild(configFor(root));
    expect(result.build_id).toBe('99999');
    expect(result.warnings).toEqual([]);
  });
});
