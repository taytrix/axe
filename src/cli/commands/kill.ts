import type { Command } from 'commander';
import { AxeError, killServer, loadContext } from '../../core/index.ts';
import { readGlobalConfigPath, readOutputOptions, renderError, renderOk } from '../output.ts';

type KillData = { pid: number };

export function registerKill(program: Command): void {
  program
    .command('kill')
    .description('SIGKILL the running server immediately (no graceful shutdown)')
    .action(async (_options: unknown, cmd: Command) => {
      const opts = readOutputOptions(cmd);
      const configPath = readGlobalConfigPath(cmd);
      try {
        const { layout } = await loadContext(configPath);
        const running = await killServer(layout);
        const data: KillData = { pid: running.pid };
        renderOk({
          command: 'kill',
          data,
          opts,
          human: () => console.log(`killed pid ${running.pid}`),
        });
      } catch (e) {
        if (e instanceof AxeError) {
          renderError({ command: 'kill', error: e, opts });
          return;
        }
        throw e;
      }
    });
}
