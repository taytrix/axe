import { type Command, Option } from 'commander';
import {
  AxeError,
  type DaemonState,
  ExitCode,
  hostPlatform,
  layoutAt,
  loadConfig,
  loadDaemonState,
  parseDuration,
  readDaemonPid,
  runDaemonLoop,
} from '../../core/index.ts';
import {
  type OutputOptions,
  readGlobalConfigPath,
  readOutputOptions,
  renderError,
  renderFail,
  renderOk,
  stringifyJson,
} from '../output.ts';

type DaemonRunFlags = {
  maxTicks?: string;
  interval?: string;
};

type DaemonStatusData = {
  running: boolean;
  pid: number | null;
  stale_pid_file: boolean;
  last_state: unknown | null;
};

export function registerDaemon(program: Command): void {
  const daemon = program
    .command('daemon')
    .description('long-running drift sensor (no auto-fix in v0.1)');

  daemon
    .command('run')
    .description('foreground tickloop; writes <root>/.axe/state.json each tick')
    .option('--interval <duration>', 'override update.poll_interval (e.g. 5m, 30s)')
    .addOption(new Option('--max-ticks <n>', 'stop after N ticks (testing only)').hideHelp())
    .action(async (options: DaemonRunFlags, cmd: Command) => {
      const opts = readOutputOptions(cmd);
      const configPath = readGlobalConfigPath(cmd);

      let intervalSeconds: number | undefined;
      if (options.interval !== undefined) {
        try {
          intervalSeconds = parseDuration(options.interval);
        } catch (e) {
          if (e instanceof AxeError) {
            renderFail({
              command: 'daemon run',
              code: ExitCode.Misuse,
              message: e.message,
              opts,
            });
            return;
          }
          throw e;
        }
      }

      let maxTicks: number | undefined;
      if (options.maxTicks !== undefined) {
        const parsed = Number.parseInt(options.maxTicks, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          renderFail({
            command: 'daemon run',
            code: ExitCode.Misuse,
            message: `--max-ticks expects a positive integer; got "${options.maxTicks}"`,
            opts,
          });
          return;
        }
        maxTicks = parsed;
      }

      try {
        const config = await loadConfig(configPath);
        const layout = layoutAt(config.server.root, hostPlatform());

        const controller = new AbortController();
        const onSignal = () => controller.abort();
        process.once('SIGTERM', onSignal);
        process.once('SIGINT', onSignal);

        try {
          const loopOpts: Parameters<typeof runDaemonLoop>[2] = {
            signal: controller.signal,
            onTick: (state) => printTick(state, opts),
          };
          if (intervalSeconds !== undefined) loopOpts.intervalSeconds = intervalSeconds;
          if (maxTicks !== undefined) loopOpts.maxTicks = maxTicks;

          await runDaemonLoop(config, layout, loopOpts);
        } finally {
          process.off('SIGTERM', onSignal);
          process.off('SIGINT', onSignal);
        }
      } catch (e) {
        if (e instanceof AxeError) {
          renderError({ command: 'daemon run', error: e, opts });
          return;
        }
        throw e;
      }
    });

  daemon
    .command('status')
    .description('print last daemon state.json snapshot; exit 50 on mods drift')
    .action(async (_options: unknown, cmd: Command) => {
      const opts = readOutputOptions(cmd);
      const configPath = readGlobalConfigPath(cmd);
      try {
        const config = await loadConfig(configPath);
        const pid = await readDaemonPid(config.server.root);
        const last_state = await loadDaemonState(config.server.root);

        // `readDaemonPid` already removes stale pid files. If pid is null
        // and last_state exists, the daemon is stopped but ran previously.
        const data: DaemonStatusData = {
          running: pid !== null,
          pid,
          stale_pid_file: false,
          last_state,
        };

        renderOk({
          command: 'daemon status',
          data,
          opts,
          human: () => printStatusHuman(data),
        });

        if (isDriftingState(last_state)) {
          process.exitCode = ExitCode.Drift;
        }
      } catch (e) {
        if (e instanceof AxeError) {
          renderError({ command: 'daemon status', error: e, opts });
          return;
        }
        throw e;
      }
    });
}

function printTick(state: DaemonState, opts: OutputOptions): void {
  if (opts.json) {
    console.log(
      stringifyJson({
        ok: true,
        command: 'daemon run',
        data: state,
        error: null,
      }),
    );
    return;
  }
  if (opts.quiet) return;
  const t = state.tick;
  const m = state.mods.report;
  const b = state.build;
  const r = state.running;
  const stalePart = m.stale > 0 ? ` (${m.stale} stale)` : '';
  const missingPart = m.missing_local > 0 ? ` (${m.missing_local} missing)` : '';
  const buildPart = b !== null ? (b.build_id ?? '?') : '?';
  const runningPart = r !== null ? `pid ${r.pid}` : 'no';
  const time = t.at.slice(11, 19);
  console.log(
    `[${time}] tick ${t.n}  mods: ${m.current}/${m.total} current${stalePart}${missingPart}  build: ${buildPart}  running: ${runningPart}`,
  );
}

function printStatusHuman(data: DaemonStatusData): void {
  if (data.running) {
    console.log(`daemon: running (pid ${data.pid})`);
  } else {
    console.log(`daemon: not running${data.last_state ? '' : ' (no prior state)'}`);
  }
  const last = data.last_state as
    | (Partial<DaemonState> & {
        tick?: { n: number; at: string; duration_ms: number };
        mods?: {
          drift: boolean;
          report?: { current: number; stale: number; missing_local: number };
        };
        build?: { build_id: string | null } | null;
      })
    | null;
  if (last?.tick) {
    console.log(`last tick: ${last.tick.at} (n=${last.tick.n}, ${last.tick.duration_ms}ms)`);
  }
  if (last?.mods?.report) {
    const r = last.mods.report;
    console.log(`mods: ${r.current} current, ${r.stale} stale, ${r.missing_local} missing_local`);
  }
  if (last?.build !== null && last?.build !== undefined) {
    console.log(`build: ${last.build.build_id ?? '?'}`);
  }
}

function isDriftingState(state: unknown): boolean {
  if (state === null || typeof state !== 'object') return false;
  const mods = (state as { mods?: { drift?: unknown } }).mods;
  return mods !== undefined && (mods as { drift?: unknown }).drift === true;
}
