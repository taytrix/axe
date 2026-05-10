import { readdir, readFile, readlink } from 'node:fs/promises';
import { basename } from 'node:path';
import type { Layout } from './layout.ts';
import type { SpawnLike } from './steamcmd.ts';

export type RunningServer = { pid: number };

export type FindRunningServerOptions = {
  /**
   * Linux: directory rooted at the kernel's /proc filesystem. Tests pass a
   * synthetic dir with `<pid>/exe` symlinks. Defaults to `/proc`.
   */
  procRoot?: string;
  /** Windows: spawn injector for `tasklist`. Defaults to `Bun.spawn`. */
  spawn?: SpawnLike;
};

/**
 * Resolve the running server PID for a given layout, or null if no process
 * matches `layout.binary`.
 *
 * - Linux: walks `<procRoot>/<pid>/exe` symlinks; matches when the symlink
 *   target equals `layout.binary` exactly.
 * - Windows: spawns `tasklist /FI "IMAGENAME eq <basename>" /FO CSV /NH`
 *   and parses the first matching row.
 *
 * Single function with internal platform branch — callers don't thread
 * platform awareness through their call sites.
 */
export async function findRunningServer(
  layout: Layout,
  options: FindRunningServerOptions = {},
): Promise<RunningServer | null> {
  if (layout.platform === 'linux') {
    return findOnLinux(layout, options.procRoot ?? '/proc');
  }
  return findOnWindows(layout, options.spawn);
}

async function findOnLinux(layout: Layout, procRoot: string): Promise<RunningServer | null> {
  let entries: string[];
  try {
    entries = await readdir(procRoot);
  } catch {
    return null;
  }

  // Single pass over /proc with two precedence tiers:
  // 1. Exact match on `/proc/<pid>/exe` symlink target — preferred.
  // 2. Fallback: `/proc/<pid>/cmdline` first argv equals binary or launcher.
  //
  // The fallback covers Conan installs where the launcher script does not
  // exec the binary (so `/proc/<pid>/exe` resolves to bash instead). The
  // canonical Conan launcher does `exec ...`, but this tolerates variants.
  const launcher = layout.launcher_script ?? null;
  let cmdlineMatch: number | null = null;

  for (const name of entries) {
    if (!/^\d+$/.test(name)) continue;
    const pid = Number.parseInt(name, 10);

    try {
      const exe = await readlink(`${procRoot}/${name}/exe`);
      if (exe === layout.binary) return { pid };
    } catch {
      // permission denied / race — fall through to cmdline check
    }

    if (cmdlineMatch === null) {
      try {
        const raw = await readFile(`${procRoot}/${name}/cmdline`);
        const argv0 = parseCmdlineArgv0(raw);
        if (argv0 !== null && (argv0 === layout.binary || argv0 === launcher)) {
          cmdlineMatch = pid;
        }
      } catch {
        // cmdline unreadable — skip
      }
    }
  }

  return cmdlineMatch !== null ? { pid: cmdlineMatch } : null;
}

/** Extract argv[0] from a `/proc/<pid>/cmdline` buffer (null-byte separated). */
function parseCmdlineArgv0(raw: Uint8Array): string | null {
  const nul = raw.indexOf(0);
  if (nul <= 0) return null;
  return new TextDecoder().decode(raw.subarray(0, nul));
}

async function findOnWindows(
  layout: Layout,
  spawn: SpawnLike | undefined,
): Promise<RunningServer | null> {
  const expected = basename(layout.binary);
  const argv = ['tasklist', '/FI', `IMAGENAME eq ${expected}`, '/FO', 'CSV', '/NH'];
  const proc = spawn ? spawn(argv) : defaultSpawnTasklist(argv);
  const stdout = await new Response(proc.stdout).text();
  const exit = await proc.exited;
  if (exit !== 0) return null;

  for (const line of stdout.trim().split(/\r?\n/)) {
    if (!line.includes(expected)) continue;
    const cols = parseCsvRow(line);
    const pidStr = cols[1];
    if (!pidStr) continue;
    const pid = Number.parseInt(pidStr, 10);
    if (!Number.isNaN(pid)) return { pid };
  }
  return null;
}

const defaultSpawnTasklist: SpawnLike = (cmd) => {
  const proc = Bun.spawn([...cmd], { stdout: 'pipe', stderr: 'pipe' });
  return {
    stdout: proc.stdout as ReadableStream<Uint8Array>,
    stderr: proc.stderr as ReadableStream<Uint8Array>,
    exited: proc.exited,
  };
};

/** Minimal CSV row parser sufficient for `tasklist /FO CSV` output. */
function parseCsvRow(line: string): string[] {
  const cols: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      i++;
      let s = '';
      while (i < line.length && line[i] !== '"') {
        s += line[i];
        i++;
      }
      cols.push(s);
      i++; // skip closing "
      if (line[i] === ',') i++;
    } else {
      let s = '';
      while (i < line.length && line[i] !== ',') {
        s += line[i];
        i++;
      }
      cols.push(s);
      if (line[i] === ',') i++;
    }
  }
  return cols;
}
