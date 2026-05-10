import type { Command } from 'commander';
import { AxeError, ExitCode, loadContext, restartServer } from '../../core/index.ts';
import {
  readGlobalConfigPath,
  readOutputOptions,
  renderError,
  renderFail,
  renderOk,
} from '../output.ts';

type RestartFlags = { reason?: string; timeout?: string };

type RestartData = {
  stopped_pid: number | null;
  new_pid: number;
  reason: string | null;
};

export function registerRestart(program: Command): void {
  program
    .command('restart')
    .description('stop (if running) then start the dedicated server')
    .option('--reason <text>', 'free-form reason to record (e.g. "post mods sync")')
    .option('--timeout <seconds>', 'stop timeout before SIGKILL', '60')
    .action(async (options: RestartFlags, cmd: Command) => {
      const opts = readOutputOptions(cmd);
      const configPath = readGlobalConfigPath(cmd);

      const timeoutSec = Number.parseInt(options.timeout ?? '60', 10);
      if (!Number.isFinite(timeoutSec) || timeoutSec < 0) {
        renderFail({
          command: 'restart',
          code: ExitCode.Misuse,
          message: `--timeout expects a non-negative integer (seconds); got "${options.timeout}"`,
          opts,
        });
        return;
      }

      try {
        const { config, layout } = await loadContext(configPath);
        const outcome = await restartServer(config, layout, { timeoutSec });
        const data: RestartData = {
          stopped_pid: outcome.stopped_pid,
          new_pid: outcome.new_pid,
          reason: options.reason ?? null,
        };
        renderOk({
          command: 'restart',
          data,
          opts,
          human: () => {
            if (outcome.stopped_pid !== null) {
              console.log(`stopped pid ${outcome.stopped_pid}; started pid ${outcome.new_pid}`);
            } else {
              console.log(`server was not running; started pid ${outcome.new_pid}`);
            }
            if (options.reason) console.log(`  reason: ${options.reason}`);
          },
        });
      } catch (e) {
        if (e instanceof AxeError) {
          renderError({ command: 'restart', error: e, opts });
          return;
        }
        throw e;
      }
    });
}
