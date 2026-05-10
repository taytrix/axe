import type { WorkshopId } from './acf.ts';
import { AxeError } from './errors.ts';
import { atomicWrite } from './io.ts';

/**
 * Tagged-union of steamcmd actions. The serializer in `buildArgv` emits each
 * in canonical Steam order, so callers cannot mis-order `+force_install_dir`
 * vs `+login` or pass mistyped argv.
 */
export type SteamcmdAction =
  | { kind: 'app_update'; appid: number; validate: boolean }
  | { kind: 'workshop_download_item'; appid: number; id: WorkshopId }
  | { kind: 'app_info_print'; appid: number }
  | { kind: 'app_info_update' };

export type SteamcmdLogin = 'anonymous' | { user: string; password?: string };

export type SteamcmdRequest = {
  binary: string;
  forceInstallDir: string;
  login: SteamcmdLogin;
  actions: readonly SteamcmdAction[];
};

export type SteamcmdOutcome = {
  exit: number;
  stdout: string;
  stderr: string;
};

/**
 * Function-shape spawn injector mirroring `FetchLike` from `workshop.ts`.
 * Tests inject a fake; production uses the default that wraps `Bun.spawn`.
 */
export type SpawnedProcess = {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
};

export type SpawnLike = (
  cmd: readonly string[],
  options?: { cwd?: string; signal?: AbortSignal },
) => SpawnedProcess;

export type RunSteamcmdOptions = {
  spawn?: SpawnLike;
  logFile?: string;
  signal?: AbortSignal;
};

/**
 * Build the steamcmd argv from a request. `+force_install_dir` is emitted
 * BEFORE `+login` regardless of action insertion order — Steam requires that
 * order for the install dir to take effect on the login session. `+quit` is
 * always last.
 */
export function buildArgv(req: SteamcmdRequest): string[] {
  const argv: string[] = [req.binary, '+force_install_dir', req.forceInstallDir];
  if (req.login === 'anonymous') {
    argv.push('+login', 'anonymous');
  } else {
    argv.push('+login', req.login.user);
    if (req.login.password !== undefined) argv.push(req.login.password);
  }
  for (const action of req.actions) {
    switch (action.kind) {
      case 'app_update':
        argv.push('+app_update', String(action.appid));
        if (action.validate) argv.push('validate');
        break;
      case 'workshop_download_item':
        argv.push('+workshop_download_item', String(action.appid), action.id.toString());
        break;
      case 'app_info_print':
        argv.push('+app_info_print', String(action.appid));
        break;
      case 'app_info_update':
        argv.push('+app_info_update', '1');
        break;
    }
  }
  argv.push('+quit');
  return argv;
}

/**
 * Run steamcmd with a typed request. Throws `AxeError(lifecycle)` on spawn
 * failure (binary missing, unable to start). Does NOT throw on non-zero exit
 * — steamcmd routinely exits non-zero on transient issues that shouldn't
 * fail the verb. Callers inspect `outcome.exit` and decide.
 *
 * If `logFile` is provided, writes a combined `# stdout` / `# stderr` block
 * to it via `atomicWrite` after the process exits. A filesystem failure on
 * the log write surfaces as `AxeError(filesystem)` and propagates.
 */
export async function runSteamcmd(
  req: SteamcmdRequest,
  options: RunSteamcmdOptions = {},
): Promise<SteamcmdOutcome> {
  const spawn = options.spawn ?? defaultSpawn;
  const argv = buildArgv(req);

  let proc: SpawnedProcess;
  try {
    proc = options.signal ? spawn(argv, { signal: options.signal }) : spawn(argv);
  } catch (e) {
    throw new AxeError('lifecycle', `spawn steamcmd: ${errorMessage(e)}`);
  }

  const [stdout, stderr, exit] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (options.logFile) {
    await atomicWrite(options.logFile, formatLog(argv, exit, stdout, stderr));
  }

  return { exit, stdout, stderr };
}

const defaultSpawn: SpawnLike = (cmd, options) => {
  const proc = Bun.spawn([...cmd], {
    stdout: 'pipe',
    stderr: 'pipe',
    ...(options?.cwd !== undefined ? { cwd: options.cwd } : {}),
    ...(options?.signal !== undefined ? { signal: options.signal } : {}),
  });
  return {
    stdout: proc.stdout as ReadableStream<Uint8Array>,
    stderr: proc.stderr as ReadableStream<Uint8Array>,
    exited: proc.exited,
  };
};

function formatLog(argv: readonly string[], exit: number, stdout: string, stderr: string): string {
  return [
    `# argv: ${argv.join(' ')}`,
    `# exit: ${exit}`,
    '# stdout',
    stdout,
    '# stderr',
    stderr,
  ].join('\n');
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
