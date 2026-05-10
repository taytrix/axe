import { randomUUID } from 'node:crypto';
import { rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { AxeError } from './errors.ts';

/**
 * Atomically replace `path` with `contents` (write tmp -> rename).
 *
 * Temp file lives in the same directory as `path` (rename stays on one
 * mountpoint) with a unique suffix (`pid.timestamp.uuid8.tmp`) so concurrent
 * or interrupted writers cannot collide.
 */
export async function atomicWrite(path: string, contents: string | Uint8Array): Promise<void> {
  const dir = dirname(path);
  const base = basename(path);
  const tmpPath = join(dir, `${base}.${process.pid}.${Date.now()}.${randomUUID().slice(0, 8)}.tmp`);

  try {
    await writeFile(tmpPath, contents);
  } catch (e) {
    throw new AxeError('filesystem', `writing ${tmpPath}: ${errorMessage(e)}`);
  }

  try {
    await rename(tmpPath, path);
  } catch (e) {
    // best-effort cleanup of the orphan tmp
    try {
      await unlink(tmpPath);
    } catch {
      /* ignore */
    }
    throw new AxeError('filesystem', `renaming ${tmpPath} -> ${path}: ${errorMessage(e)}`);
  }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
