import { afterEach, describe, expect, test } from 'bun:test';
import { appendFile, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { layoutAt } from '../../src/core/layout.ts';
import { findLatestLog, tailLog } from '../../src/core/logs.ts';

const TMP_DIRS: string[] = [];

afterEach(async () => {
  while (TMP_DIRS.length > 0) {
    const dir = TMP_DIRS.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

async function freshLayout(): Promise<{ layout: ReturnType<typeof layoutAt> }> {
  const root = join(tmpdir(), `axe-logs-${Date.now()}-${Math.random()}`);
  await mkdir(root, { recursive: true });
  TMP_DIRS.push(root);
  const layout = layoutAt(root, 'linux');
  await mkdir(layout.logs_dir, { recursive: true });
  return { layout };
}

describe('findLatestLog', () => {
  test('prefers ConanSandbox.log when present', async () => {
    const { layout } = await freshLayout();
    await writeFile(join(layout.logs_dir, 'ConanSandbox.log'), 'a');
    await writeFile(join(layout.logs_dir, 'ConanSandbox-backup-1.log'), 'b');
    const path = await findLatestLog(layout);
    expect(path).toBe(join(layout.logs_dir, 'ConanSandbox.log'));
  });

  test('falls back to most recent *.log by mtime', async () => {
    const { layout } = await freshLayout();
    const older = join(layout.logs_dir, 'ConanSandbox-backup-1.log');
    const newer = join(layout.logs_dir, 'ConanSandbox-backup-2.log');
    await writeFile(older, 'a');
    await writeFile(newer, 'b');
    // Force older to be older.
    await utimes(older, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
    const path = await findLatestLog(layout);
    expect(path).toBe(newer);
  });

  test('returns null when no *.log files exist', async () => {
    const { layout } = await freshLayout();
    await writeFile(join(layout.logs_dir, 'README.txt'), 'not a log');
    const path = await findLatestLog(layout);
    expect(path).toBeNull();
  });
});

describe('tailLog', () => {
  test('--lines N returns the last N lines', async () => {
    const { layout } = await freshLayout();
    const path = join(layout.logs_dir, 'ConanSandbox.log');
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    await writeFile(path, `${lines.join('\n')}\n`);

    const collected: string[] = [];
    for await (const line of tailLog(path, { lines: 5 })) {
      collected.push(line);
    }
    expect(collected).toEqual(['line 16', 'line 17', 'line 18', 'line 19', 'line 20']);
  });

  test('follow=true yields appended lines', async () => {
    const { layout } = await freshLayout();
    const path = join(layout.logs_dir, 'ConanSandbox.log');
    await writeFile(path, 'initial\n');

    const controller = new AbortController();
    const collected: string[] = [];

    const consumer = (async () => {
      for await (const line of tailLog(path, {
        lines: 100,
        follow: true,
        pollMs: 50,
        signal: controller.signal,
      })) {
        collected.push(line);
      }
    })();

    // Append after the initial lines have been drained
    await new Promise((r) => setTimeout(r, 80));
    await appendFile(path, 'new line A\n');
    await appendFile(path, 'new line B\n');
    // Wait for the next poll
    await new Promise((r) => setTimeout(r, 200));
    controller.abort();
    await consumer;

    expect(collected).toEqual(['initial', 'new line A', 'new line B']);
  });
});
