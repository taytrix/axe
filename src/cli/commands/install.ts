import type { Command } from 'commander';
import {
  AxeError,
  hostPlatform,
  type InstallData,
  layoutAt,
  loadConfig,
  runServerInstall,
} from '../../core/index.ts';
import { readGlobalConfigPath, readOutputOptions, renderError, renderOk } from '../output.ts';

type InstallFlags = { validate?: boolean };

export function registerInstall(program: Command): void {
  program
    .command('install')
    .description('install the dedicated server via steamcmd (writes to server.root)')
    .option('--validate', 'pass `validate` to app_update (slower; verifies file integrity)')
    .action(async (options: InstallFlags, cmd: Command) => {
      const opts = readOutputOptions(cmd);
      const configPath = readGlobalConfigPath(cmd);
      try {
        const config = await loadConfig(configPath);
        const layout = layoutAt(config.server.root, hostPlatform());
        const result = await runServerInstall(config, layout, {
          verb: 'install',
          validate: options.validate ?? false,
        });
        renderOk({
          command: 'install',
          data: result.data,
          opts,
          human: () => printInstallSummary('install', result.data),
          warnings: result.warnings,
        });
      } catch (e) {
        if (e instanceof AxeError) {
          renderError({ command: 'install', error: e, opts });
          return;
        }
        throw e;
      }
    });
}

export function printInstallSummary(verb: string, data: InstallData): void {
  console.log(`${verb} complete: ${data.root}`);
  if (data.build_id) console.log(`  build_id: ${data.build_id}`);
  if (data.validated) console.log('  validated: yes');
  console.log(`  log: ${data.log_file}`);
}
