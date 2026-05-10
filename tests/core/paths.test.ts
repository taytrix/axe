import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { axeStateDir, reserveSteamcmdLog, steamcmdLogPath } from '../../src/core/paths.ts';

const TMP_DIRS: string[] = [];

afterEach(async () => {
  while (TMP_DIRS.length > 0) {
    const dir = TMP_DIRS.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe('paths', () => {
  test('axeStateDir returns <root>/.axe', () => {
    expect(axeStateDir('/srv/conan')).toBe('/srv/conan/.axe');
  });

  test('steamcmdLogPath produces a deterministic timestamped name per verb', () => {
    const date = new Date(Date.UTC(2026, 4, 10, 12, 30, 45, 123));
    expect(steamcmdLogPath('/srv/conan', 'install', date)).toBe(
      '/srv/conan/.axe/steamcmd-install-2026-05-10T12-30-45-123Z.log',
    );
    expect(steamcmdLogPath('/srv/conan', 'sync', date)).toBe(
      '/srv/conan/.axe/steamcmd-sync-2026-05-10T12-30-45-123Z.log',
    );
  });

  test('reserveSteamcmdLog creates the .axe dir and returns a fresh path', async () => {
    const root = join(tmpdir(), `axe-paths-${Date.now()}-${Math.random()}`);
    await mkdir(root, { recursive: true });
    TMP_DIRS.push(root);

    const path = await reserveSteamcmdLog(root, 'install');
    expect(path.startsWith(`${root}/.axe/steamcmd-install-`)).toBe(true);
    expect(path.endsWith('.log')).toBe(true);

    const dir = await stat(`${root}/.axe`);
    expect(dir.isDirectory()).toBe(true);
  });
});
