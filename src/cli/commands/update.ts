import type { Command } from 'commander';
import {
  AxeError,
  ExitCode,
  hostPlatform,
  layoutAt,
  loadConfig,
  parseAppInfo,
  runSteamcmd,
  SERVER_APPID,
} from '../../core/index.ts';
import {
  readGlobalConfigPath,
  readOutputOptions,
  renderError,
  renderFail,
  renderOk,
} from '../output.ts';
import { type InstallData, performServerInstall, printInstallSummary } from './install.ts';

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
        // both unset (false===false), or both set (true===true) → misuse
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
        const layout = layoutAt(config.server.root, hostPlatform());

        if (options.checkOnly) {
          const steamcmdBinary = config.steamcmd?.binary ?? Bun.which('steamcmd');
          if (!steamcmdBinary) {
            throw new AxeError(
              'config',
              'steamcmd binary not found; set [steamcmd].binary in axe.toml or install steamcmd on PATH',
            );
          }
          const warnings: string[] = [];
          const info = await runSteamcmd({
            binary: steamcmdBinary,
            forceInstallDir: config.server.root,
            login: 'anonymous',
            actions: [{ kind: 'app_info_print', appid: SERVER_APPID }],
          });
          if (info.exit !== 0) {
            warnings.push(`steamcmd exited ${info.exit} during app_info_print`);
          }
          const { build_id } = parseAppInfo(info.stdout, SERVER_APPID);
          if (build_id === null) {
            warnings.push('build_id not found in app_info output');
          }
          const data: UpdateCheckData = { mode: 'check-only', build_id };
          renderOk({
            command: 'update',
            data,
            opts,
            human: () => {
              console.log(`server build_id: ${build_id ?? '<unknown>'}`);
            },
            warnings,
          });
          return;
        }

        // --apply
        const result = await performServerInstall(config, layout, {
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
