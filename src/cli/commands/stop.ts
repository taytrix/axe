import type { Command } from 'commander';
import { AxeError, ExitCode, loadContext, stopServer } from '../../core/index.ts';
import {
  readGlobalConfigPath,
  readOutputOptions,
  renderError,
  renderFail,
  renderOk,
} from '../output.ts';

type StopFlags = { timeout?: string };

type StopData = {
  pid: number;
  method: 'term' | 'kill';
  elapsed_ms: number;
};

export function registerStop(program: Command): void {
  program
    .command('stop')
    .description('SIGTERM the running server, escalating to SIGKILL after --timeout')
    .option('--timeout <seconds>', 'seconds to wait after SIGTERM before SIGKILL', '60')
    .action(async (options: StopFlags, cmd: Command) => {
      const opts = readOutputOptions(cmd);
      const configPath = readGlobalConfigPath(cmd);

      const timeoutSec = Number.parseInt(options.timeout ?? '60', 10);
      if (!Number.isFinite(timeoutSec) || timeoutSec < 0) {
        renderFail({
          command: 'stop',
          code: ExitCode.Misuse,
          message: `--timeout expects a non-negative integer (seconds); got "${options.timeout}"`,
          opts,
        });
        return;
      }

      try {
        const { layout } = await loadContext(configPath);
        const outcome = await stopServer(layout, { timeoutSec });
        const data: StopData = outcome;
        renderOk({
          command: 'stop',
          data,
          opts,
          human: () => {
            const verb = outcome.method === 'kill' ? 'killed' : 'stopped';
            console.log(`${verb} pid ${outcome.pid} after ${outcome.elapsed_ms}ms`);
          },
        });
      } catch (e) {
        if (e instanceof AxeError) {
          renderError({ command: 'stop', error: e, opts });
          return;
        }
        throw e;
      }
    });
}
