import { access, mkdir } from 'node:fs/promises';
import * as posix from 'node:path/posix';
import type { Command } from 'commander';
import {
  AxeError,
  type Config,
  hostPlatform,
  type Layout,
  layoutAt,
  loadConfig,
  parseAppInfo,
  runSteamcmd,
  SERVER_APPID,
} from '../../core/index.ts';
import { readGlobalConfigPath, readOutputOptions, renderError, renderOk } from '../output.ts';

type InstallFlags = { validate?: boolean };

export type InstallData = {
  root: string;
  validated: boolean;
  build_id: string | null;
  log_file: string;
};

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
        const result = await performServerInstall(config, layout, {
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

export type ServerInstallOptions = {
  verb: 'install' | 'update' | 'verify';
  validate: boolean;
};

/**
 * Shared `steamcmd app_update` pipeline used by `install`, `update --apply`,
 * and `verify`. Captures a log under `<root>/.axe/`, verifies the binary
 * exists post-run, then best-effort fetches `build_id` via a follow-up
 * `app_info_print` (failures here surface as warnings, not errors).
 */
export async function performServerInstall(
  config: Config,
  layout: Layout,
  options: ServerInstallOptions,
): Promise<{ data: InstallData; warnings: string[] }> {
  const steamcmdBinary = config.steamcmd?.binary ?? Bun.which('steamcmd');
  if (!steamcmdBinary) {
    throw new AxeError(
      'config',
      'steamcmd binary not found; set [steamcmd].binary in axe.toml or install steamcmd on PATH',
    );
  }

  const logDir = posix.join(config.server.root, '.axe');
  await mkdir(logDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile = posix.join(logDir, `steamcmd-${options.verb}-${stamp}.log`);

  const warnings: string[] = [];

  const outcome = await runSteamcmd(
    {
      binary: steamcmdBinary,
      forceInstallDir: config.server.root,
      login: 'anonymous',
      actions: [{ kind: 'app_update', appid: SERVER_APPID, validate: options.validate }],
    },
    { logFile },
  );

  if (outcome.exit !== 0) {
    warnings.push(`steamcmd exited ${outcome.exit}; see ${logFile} for details`);
  }

  try {
    await access(layout.binary);
  } catch {
    throw new AxeError(
      'lifecycle',
      `${options.verb} completed but server binary not found at ${layout.binary}; check log: ${logFile}`,
    );
  }

  let build_id: string | null = null;
  try {
    const info = await runSteamcmd({
      binary: steamcmdBinary,
      forceInstallDir: config.server.root,
      login: 'anonymous',
      actions: [{ kind: 'app_info_print', appid: SERVER_APPID }],
    });
    build_id = parseAppInfo(info.stdout, SERVER_APPID).build_id;
    if (build_id === null) {
      warnings.push('build_id not found in app_info output');
    }
  } catch (e) {
    warnings.push(`build_id lookup failed: ${(e as Error).message}`);
  }

  const data: InstallData = {
    root: config.server.root,
    validated: options.validate,
    build_id,
    log_file: logFile,
  };

  return { data, warnings };
}

export function printInstallSummary(verb: string, data: InstallData): void {
  console.log(`${verb} complete: ${data.root}`);
  if (data.build_id) console.log(`  build_id: ${data.build_id}`);
  if (data.validated) console.log('  validated: yes');
  console.log(`  log: ${data.log_file}`);
}
