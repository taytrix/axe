import { open, readdir, readFile, stat } from 'node:fs/promises';
import * as posix from 'node:path/posix';
import { AxeError } from './errors.ts';
import type { Layout } from './layout.ts';

const PRIMARY_LOG_NAME = 'ConanSandbox.log';

export type TailOptions = {
  /** Lines to emit before optionally entering follow mode. Default 100. */
  lines?: number;
  /** Continue reading appended bytes until aborted. Default false. */
  follow?: boolean;
  /** Polling interval (ms) when `follow` is set. Default 500. */
  pollMs?: number;
  /** Abort follow loop. */
  signal?: AbortSignal;
};

/**
 * Resolve the "current" Conan log file, preferring `ConanSandbox.log` and
 * falling back to the most recently modified `*.log`. Returns null when
 * the logs directory exists but contains no `*.log` files.
 *
 * Throws `AxeError('discovery')` if `layout.logs_dir` doesn't exist.
 */
export async function findLatestLog(layout: Layout): Promise<string | null> {
  let entries: string[];
  try {
    entries = await readdir(layout.logs_dir);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new AxeError('discovery', `logs directory not found: ${layout.logs_dir}`);
    }
    throw new AxeError('discovery', `reading ${layout.logs_dir}: ${(e as Error).message}`);
  }

  const primary = entries.find((name) => name === PRIMARY_LOG_NAME);
  if (primary) return posix.join(layout.logs_dir, primary);

  const logs = entries.filter((name) => name.toLowerCase().endsWith('.log'));
  if (logs.length === 0) return null;

  // Sort by mtime descending; newest first.
  const stamped = await Promise.all(
    logs.map(async (name) => {
      const full = posix.join(layout.logs_dir, name);
      const st = await stat(full);
      return { full, mtimeMs: st.mtimeMs };
    }),
  );
  stamped.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return stamped[0]?.full ?? null;
}

/**
 * Yield the last `lines` lines from `path`, then optionally watch for
 * appended bytes and yield each new line as it arrives.
 *
 * Follow mode polls `stat()` every `pollMs` ms. If the file size shrinks
 * (rotation/truncation), we reset to offset 0 — the next pass picks up
 * from the new start of file. Abort by signalling `opts.signal`.
 */
export async function* tailLog(
  path: string,
  opts: TailOptions = {},
): AsyncIterableIterator<string> {
  const wantLines = opts.lines ?? 100;
  const pollMs = opts.pollMs ?? 500;
  const follow = opts.follow ?? false;

  const initial = await readFile(path, 'utf8');
  const initialLines = splitLines(initial);
  const start = Math.max(0, initialLines.length - wantLines);
  for (let i = start; i < initialLines.length; i++) {
    const line = initialLines[i];
    if (line !== undefined) yield line;
  }

  if (!follow) return;

  let lastSize = (await stat(path)).size;
  while (!opts.signal?.aborted) {
    await sleep(pollMs);
    if (opts.signal?.aborted) break;
    let st: Awaited<ReturnType<typeof stat>>;
    try {
      st = await stat(path);
    } catch {
      // file may have been rotated away; loop again
      continue;
    }
    if (st.size < lastSize) {
      // truncation/rotation — re-read from 0
      lastSize = 0;
    }
    if (st.size === lastSize) continue;

    const handle = await open(path, 'r');
    try {
      const buf = Buffer.alloc(st.size - lastSize);
      await handle.read(buf, 0, buf.length, lastSize);
      const text = buf.toString('utf8');
      for (const line of splitLines(text)) yield line;
      lastSize = st.size;
    } finally {
      await handle.close();
    }
  }
}

function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
