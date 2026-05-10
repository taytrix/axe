import type { Command } from 'commander';
import { AxeError, loadContext, startServer } from '../../core/index.ts';
import { readGlobalConfigPath, readOutputOptions, renderError, renderOk } from '../output.ts';

type StartFlags = { foreground?: boolean };

type StartData = {
  pid: number;
  foreground: boolean;
  logs_dir: string;
};

export function registerStart(program: Command): void {
  program
    .command('start')
    .description('start the dedicated server')
    .option('--foreground', 'inherit stdio and block until the server exits')
    .action(async (options: StartFlags, cmd: Command) => {
      const opts = readOutputOptions(cmd);
      const configPath = readGlobalConfigPath(cmd);
      try {
        const { config, layout } = await loadContext(configPath);
        const outcome = await startServer(config, layout, {
          foreground: options.foreground ?? false,
        });
        const data: StartData = {
          pid: outcome.pid,
          foreground: outcome.foreground,
          logs_dir: layout.logs_dir,
        };
        renderOk({
          command: 'start',
          data,
          opts,
          human: () => {
            console.log(`server started (pid ${outcome.pid})`);
            console.log(`  logs: ${layout.logs_dir}`);
          },
        });
      } catch (e) {
        if (e instanceof AxeError) {
          renderError({ command: 'start', error: e, opts });
          return;
        }
        throw e;
      }
    });
}
