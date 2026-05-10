import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AxeError } from '../../src/core/errors.ts';
import { probe } from '../../src/core/probe.ts';

const TMP_DIRS: string[] = [];

afterEach(async () => {
  while (TMP_DIRS.length > 0) {
    const dir = TMP_DIRS.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

async function fixtureInstall(platform: 'linux' | 'windows'): Promise<string> {
  const dir = await mkdir(join(tmpdir(), `axe-probe-${Date.now()}-${Math.random()}`), {
    recursive: true,
  });
  TMP_DIRS.push(dir as string);
  const binarySubdir =
    platform === 'linux' ? 'ConanSandbox/Binaries/Linux' : 'ConanSandbox/Binaries/Win64';
  const binaryName =
    platform === 'linux' ? 'ConanSandboxServer-Linux-Shipping' : 'ConanSandboxServer.exe';
  await mkdir(join(dir as string, binarySubdir), { recursive: true });
  await writeFile(join(dir as string, binarySubdir, binaryName), '');
  return dir as string;
}

describe('probe', () => {
  test('detects linux install', async () => {
    const root = await fixtureInstall('linux');
    const layout = await probe(root);
    expect(layout.platform).toBe('linux');
  });

  test('detects windows install', async () => {
    const root = await fixtureInstall('windows');
    const layout = await probe(root);
    expect(layout.platform).toBe('windows');
  });

  test('rejects unrelated directory', async () => {
    const dir = await mkdir(join(tmpdir(), `axe-probe-empty-${Date.now()}`), {
      recursive: true,
    });
    TMP_DIRS.push(dir as string);
    await expect(probe(dir as string)).rejects.toThrow(AxeError);
  });

  test('rejects missing directory', async () => {
    await expect(probe('/no/such/dir/anywhere')).rejects.toThrow(AxeError);
  });
});
