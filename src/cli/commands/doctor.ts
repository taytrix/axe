import type { Command } from 'commander';
import {
  AxeError,
  ExitCode,
  loadConfig,
  probe,
  runDoctor,
  worstFinding,
} from '../../core/index.ts';
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
      const out = readOutputOptions(cmd);
      const configPath = readGlobalConfigPath(cmd);

      try {
        const config = await loadConfig(configPath);
        const layout = await probe(config.server.root);
        const report = await runDoctor(config, layout);

        renderOk('doctor', report, out, () => renderReport(report, out));

        if (worstFinding(report) === 'error') {
          process.exitCode = ExitCode.Discovery;
        }
      } catch (e) {
        if (e instanceof AxeError) {
          renderError('doctor', e, out);
          return;
        }
        throw e;
      }
    });
}
