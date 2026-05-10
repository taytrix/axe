import type { Command } from 'commander';
import { AxeError, hostPlatform, layoutAt, loadConfig } from '../../core/index.ts';
import { readGlobalConfigPath, readOutputOptions, renderError, renderOk } from '../output.ts';
import { performServerInstall, printInstallSummary } from './install.ts';

export function registerVerify(program: Command): void {
  program
    .command('verify')
    .description('re-run app_update with --validate to verify install integrity')
    .action(async (_options: unknown, cmd: Command) => {
      const opts = readOutputOptions(cmd);
      const configPath = readGlobalConfigPath(cmd);
      try {
        const config = await loadConfig(configPath);
        const layout = layoutAt(config.server.root, hostPlatform());
        const result = await performServerInstall(config, layout, {
          verb: 'verify',
          validate: true,
        });
        renderOk({
          command: 'verify',
          data: result.data,
          opts,
          human: () => printInstallSummary('verify', result.data),
          warnings: result.warnings,
        });
      } catch (e) {
        if (e instanceof AxeError) {
          renderError({ command: 'verify', error: e, opts });
          return;
        }
        throw e;
      }
    });
}
