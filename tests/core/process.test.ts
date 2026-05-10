import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { layoutAt } from '../../src/core/layout.ts';
import { findRunningServer } from '../../src/core/process.ts';
import type { SpawnLike } from '../../src/core/steamcmd.ts';

const TMP_DIRS: string[] = [];

afterEach(async () => {
  while (TMP_DIRS.length > 0) {
    const dir = TMP_DIRS.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

async function freshDir(prefix: string): Promise<string> {
  const dir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random()}`);
  await mkdir(dir, { recursive: true });
  TMP_DIRS.push(dir);
  return dir;
}

describe('findRunningServer (linux)', () => {
  test('returns the pid whose /proc/<pid>/exe points at layout.binary', async () => {
    const root = await freshDir('axe-proc-root');
    const procRoot = await freshDir('axe-proc');
    const layout = layoutAt(root, 'linux');

    // synthetic /proc/12345/exe -> layout.binary
    await mkdir(join(procRoot, '12345'), { recursive: true });
    await symlink(layout.binary, join(procRoot, '12345', 'exe'));
    // an unrelated process pointing somewhere else
    await mkdir(join(procRoot, '54321'), { recursive: true });
    await symlink('/usr/bin/bash', join(procRoot, '54321', 'exe'));

    const result = await findRunningServer(layout, { procRoot });
    expect(result).toEqual({ pid: 12345 });
  });

  test('returns null when no /proc/<pid>/exe matches', async () => {
    const root = await freshDir('axe-proc-root');
    const procRoot = await freshDir('axe-proc');
    const layout = layoutAt(root, 'linux');

    await mkdir(join(procRoot, '99'), { recursive: true });
    await symlink('/usr/bin/bash', join(procRoot, '99', 'exe'));

    const result = await findRunningServer(layout, { procRoot });
    expect(result).toBeNull();
  });

  test('skips non-numeric directory entries', async () => {
    const root = await freshDir('axe-proc-root');
    const procRoot = await freshDir('axe-proc');
    const layout = layoutAt(root, 'linux');

    // `self`, `kernel`, etc. — non-pid entries that exist in real /proc
    await mkdir(join(procRoot, 'self'), { recursive: true });
    await mkdir(join(procRoot, 'kernel'), { recursive: true });
    await mkdir(join(procRoot, '7'), { recursive: true });
    await symlink(layout.binary, join(procRoot, '7', 'exe'));

    const result = await findRunningServer(layout, { procRoot });
    expect(result).toEqual({ pid: 7 });
  });
});

describe('findRunningServer (windows)', () => {
  test('parses tasklist CSV output to extract pid', async () => {
    const root = 'C:/srv/conan';
    const layout = layoutAt(root, 'windows');
    const csvLine = `"ConanSandboxServer.exe","9876","Services","0","123,456 K"`;
    const fakeSpawn: SpawnLike = () => ({
      stdout: new Response(csvLine).body as ReadableStream<Uint8Array>,
      stderr: new Response('').body as ReadableStream<Uint8Array>,
      exited: Promise.resolve(0),
    });

    const result = await findRunningServer(layout, { spawn: fakeSpawn });
    expect(result).toEqual({ pid: 9876 });
  });

  test('returns null when tasklist exits non-zero', async () => {
    const layout = layoutAt('C:/srv/conan', 'windows');
    const fakeSpawn: SpawnLike = () => ({
      stdout: new Response('').body as ReadableStream<Uint8Array>,
      stderr: new Response('error').body as ReadableStream<Uint8Array>,
      exited: Promise.resolve(1),
    });
    const result = await findRunningServer(layout, { spawn: fakeSpawn });
    expect(result).toBeNull();
  });
});
