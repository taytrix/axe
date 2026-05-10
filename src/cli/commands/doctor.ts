import type { Command } from 'commander';
import { AxeError, ExitCode, loadContext, runDoctor, worstFinding } from '../../core/index.ts';
import {
  readGlobalConfigPath,
  readOutputOptions,
  renderError,
  renderOk,
  renderReport,
} from '../output.ts';

export function registerDoctor(program: Command): void {
  program
    .command('doctor')
    .description('run a series of read-only sanity checks against the install')
    .action(async (_options: unknown, cmd: Command) => {
      const opts = readOutputOptions(cmd);
      const configPath = readGlobalConfigPath(cmd);
      try {
        const { config, layout } = await loadContext(configPath);
        const report = await runDoctor(config, layout);

        renderOk({
          command: 'doctor',
          data: report,
          opts,
          human: () => renderReport(report, opts),
        });

        if (worstFinding(report) === 'error') {
          process.exitCode = ExitCode.Discovery;
        }
      } catch (e) {
        if (e instanceof AxeError) {
          renderError({ command: 'doctor', error: e, opts });
          return;
        }
        throw e;
      }
    });
}
