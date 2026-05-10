import type { Command } from 'commander';
import {
  AxeError,
  checkServerBuild,
  ExitCode,
  hostPlatform,
  type InstallData,
  layoutAt,
  loadConfig,
  runServerInstall,
} from '../../core/index.ts';
import {
  readGlobalConfigPath,
  readOutputOptions,
  renderError,
  renderFail,
  renderOk,
} from '../output.ts';
import { printInstallSummary } from './install.ts';

type UpdateFlags = {
  checkOnly?: boolean;
  apply?: boolean;
  validate?: boolean;
};

type UpdateCheckData = {
  mode: 'check-only';
  build_id: string | null;
};

type UpdateApplyData = InstallData & { mode: 'apply' };

export function registerUpdate(program: Command): void {
  program
    .command('update')
    .description('check for or apply server build updates via steamcmd')
    .option('--check-only', 'print the latest build_id without modifying anything')
    .option('--apply', 'run app_update against server.root (mutating)')
    .option('--validate', 'with --apply, also validate file integrity (slower)')
    .action(async (options: UpdateFlags, cmd: Command) => {
      const opts = readOutputOptions(cmd);
      const configPath = readGlobalConfigPath(cmd);

      if (options.checkOnly === options.apply) {
        renderFail({
          command: 'update',
          code: ExitCode.Misuse,
          message:
            options.checkOnly && options.apply
              ? 'pass either --check-only or --apply, not both'
              : 'pass --check-only (read-only) or --apply (mutates) — neither given',
          opts,
        });
        return;
      }

      try {
        const config = await loadConfig(configPath);

        if (options.checkOnly) {
          const { build_id, warnings } = await checkServerBuild(config);
          const data: UpdateCheckData = { mode: 'check-only', build_id };
          renderOk({
            command: 'update',
            data,
            opts,
            human: () => console.log(`server build_id: ${build_id ?? '<unknown>'}`),
            warnings,
          });
          return;
        }

        const layout = layoutAt(config.server.root, hostPlatform());
        const result = await runServerInstall(config, layout, {
          verb: 'update',
          validate: options.validate ?? false,
        });
        const data: UpdateApplyData = { mode: 'apply', ...result.data };
        renderOk({
          command: 'update',
          data,
          opts,
          human: () => printInstallSummary('update', result.data),
          warnings: result.warnings,
        });
      } catch (e) {
        if (e instanceof AxeError) {
          renderError({ command: 'update', error: e, opts });
          return;
        }
        throw e;
      }
    });
}
