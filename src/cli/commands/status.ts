import type { Command } from 'commander';
import {
  AxeError,
  ExitCode,
  type FreshnessReport,
  findRunningServer,
  hasDrift,
  loadContext,
  type Platform,
  type RunningServer,
  runModsCheck,
} from '../../core/index.ts';
import { readGlobalConfigPath, readOutputOptions, renderError, renderOk } from '../output.ts';

type StatusFlags = { withMods?: boolean };

type StatusData = {
  config_path: string;
  server_id: string;
  platform: Platform;
  root: string;
  running: RunningServer | null;
  mods: FreshnessReport | null;
};

export function registerStatus(program: Command): void {
  program
    .command('status')
    .description('summarize config, layout, running pid, and (with --with-mods) mod freshness')
    .option('--with-mods', 'also query the Workshop API and include a freshness summary')
    .action(async (options: StatusFlags, cmd: Command) => {
      const opts = readOutputOptions(cmd);
      const configPath = readGlobalConfigPath(cmd);
      const warnings: string[] = [];
      try {
        const { config, layout } = await loadContext(configPath);
        const running = await findRunningServer(layout);

        let mods: FreshnessReport | null = null;
        let drift = false;
        if (options.withMods) {
          const result = await runModsCheck(layout, config.mods.ids);
          mods = result.report;
          warnings.push(...result.warnings);
          drift = hasDrift(result.report);
        }

        const data: StatusData = {
          config_path: configPath,
          server_id: config.server.id,
          platform: layout.platform,
          root: layout.root,
          running,
          mods,
        };

        renderOk({
          command: 'status',
          data,
          opts,
          human: () => printStatusHuman(data),
          warnings,
        });

        if (drift) process.exitCode = ExitCode.Drift;
      } catch (e) {
        if (e instanceof AxeError) {
          renderError({ command: 'status', error: e, opts });
          return;
        }
        throw e;
      }
    });
}

function printStatusHuman(data: StatusData): void {
  console.log(`server: ${data.server_id} (${data.platform})`);
  console.log(`  root: ${data.root}`);
  console.log(`  config: ${data.config_path}`);
  if (data.running) {
    console.log(`  running: pid ${data.running.pid}`);
  } else {
    console.log('  running: no');
  }
  if (data.mods) {
    const m = data.mods;
    console.log(
      `  mods: ${m.total} declared (${m.current} current, ${m.stale} stale, ${m.missing_local} missing_local, ${m.missing_remote} missing_remote, ${m.unmanaged} unmanaged)`,
    );
  }
}
