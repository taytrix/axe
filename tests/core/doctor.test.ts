import { afterEach, describe, expect, test } from 'bun:test';
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configFromRoot } from '../../src/core/config.ts';
import { runDoctor, worstFinding } from '../../src/core/doctor.ts';
import { layoutAt } from '../../src/core/layout.ts';

const TMP_DIRS: string[] = [];

afterEach(async () => {
  while (TMP_DIRS.length > 0) {
    const dir = TMP_DIRS.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

async function emptyLinuxInstall(): Promise<string> {
  const root = (await mkdir(join(tmpdir(), `axe-doctor-${Date.now()}-${Math.random()}`), {
    recursive: true,
  })) as string;
  TMP_DIRS.push(root);
  const binDir = join(root, 'ConanSandbox/Binaries/Linux');
  await mkdir(binDir, { recursive: true });
  const bin = join(binDir, 'ConanSandboxServer-Linux-Shipping');
  await writeFile(bin, '');
  await chmod(bin, 0o755);
  return root;
}

describe('runDoctor', () => {
  test('fresh linux install yields warnings only', async () => {
    const root = await emptyLinuxInstall();
    const cfg = configFromRoot('test', root);
    const layout = layoutAt(root, 'linux');
    const report = await runDoctor(cfg, layout);
    expect(worstFinding(report)).not.toBe('error');
  });

  test('detects mis-cased Game.db on linux as error', async () => {
    const root = await emptyLinuxInstall();
    const saved = join(root, 'ConanSandbox/Saved');
    await mkdir(saved, { recursive: true });
    await writeFile(join(saved, 'Game.db'), '');
    const cfg = configFromRoot('test', root);
    const layout = layoutAt(root, 'linux');
    const report = await runDoctor(cfg, layout);
    const gameDb = report.findings.find((f) => f.topic === 'game.db');
    expect(gameDb?.level).toBe('error');
  });

  test('worstFinding picks error over warn over ok', () => {
    expect(
      worstFinding({
        findings: [
          { level: 'ok', topic: 'a', message: '' },
          { level: 'warn', topic: 'b', message: '' },
        ],
      }),
    ).toBe('warn');
    expect(
      worstFinding({
        findings: [
          { level: 'warn', topic: 'a', message: '' },
          { level: 'error', topic: 'b', message: '' },
        ],
      }),
    ).toBe('error');
    expect(worstFinding({ findings: [] })).toBe('ok');
  });
});
