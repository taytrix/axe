import type { Command } from 'commander';
import {
  AxeError,
  ExitCode,
  hasDrift,
  loadConfig,
  loadContext,
  reserveSteamcmdLog,
  runModsCheck,
  syncModlist,
} from '../../core/index.ts';
import {
  readGlobalConfigPath,
  readOutputOptions,
  renderError,
  renderFreshness,
  renderOk,
} from '../output.ts';

export function registerMods(program: Command): void {
  const mods = program.command('mods').description('manage the canonical mod list');

  mods
    .command('list')
    .description('show the mod list from axe.toml')
    .action(async (_options: unknown, cmd: Command) => {
      const opts = readOutputOptions(cmd);
      const configPath = readGlobalConfigPath(cmd);
      try {
        const config = await loadConfig(configPath);
        const items = config.mods.ids.map((id) => ({ id }));
        renderOk({
          command: 'mods list',
          data: { items },
          opts,
          human: () => {
            if (items.length === 0) {
              console.log('no mods configured in axe.toml');
              return;
            }
            console.log(`${items.length} mod${items.length === 1 ? '' : 's'} configured:`);
            for (const m of items) console.log(`  ${m.id.toString()}`);
          },
        });
      } catch (e) {
        if (e instanceof AxeError) {
          renderError({ command: 'mods list', error: e, opts });
          return;
        }
        throw e;
      }
    });

  mods
    .command('check')
    .description('compare installed mods against Steam Workshop; report stale/missing')
    .action(async (_options: unknown, cmd: Command) => {
      const opts = readOutputOptions(cmd);
      const configPath = readGlobalConfigPath(cmd);
      try {
        const { config, layout } = await loadContext(configPath);
        const { report, warnings } = await runModsCheck(layout, config.mods.ids);
        renderOk({
          command: 'mods check',
          data: report,
          opts,
          human: () => renderFreshness(report, opts),
          warnings,
        });
        if (hasDrift(report)) process.exitCode = ExitCode.Drift;
      } catch (e) {
        if (e instanceof AxeError) {
          renderError({ command: 'mods check', error: e, opts });
          return;
        }
        throw e;
      }
    });

  mods
    .command('sync')
    .description('download stale/missing mods via steamcmd; rewrite modlist.txt if changed')
    .option('--no-restart', 'reserved for daemon use; tweaks the running-server warning')
    .action(async (options: { restart?: boolean }, cmd: Command) => {
      const opts = readOutputOptions(cmd);
      const configPath = readGlobalConfigPath(cmd);
      try {
        const { config, layout } = await loadContext(configPath);
        const logFile = await reserveSteamcmdLog(config.server.root, 'sync');
        const outcome = await syncModlist(config, layout, { logFile });

        const warnings = [...outcome.warnings];
        // PR3: warning text reflects the --no-restart flag without checking
        // for an actual running server (PR4 adds findRunningServer).
        if (outcome.modlist_changed) {
          warnings.push(
            options.restart === false
              ? 'modlist.txt rewritten; daemon will sequence the restart'
              : 'modlist.txt rewritten; if the server is running, restart for changes to take effect',
          );
        }

        renderOk({
          command: 'mods sync',
          data: outcome,
          opts,
          human: () => {
            if (outcome.downloaded.length === 0 && !outcome.modlist_changed) {
              console.log('all mods current; nothing to do');
              return;
            }
            console.log(
              `downloaded ${outcome.downloaded.length} mod${outcome.downloaded.length === 1 ? '' : 's'}; ${
                outcome.modlist_changed ? 'modlist.txt rewritten' : 'modlist.txt unchanged'
              }`,
            );
            if (outcome.missing.length > 0) {
              console.log(
                `  still missing: ${outcome.missing.map((id) => id.toString()).join(', ')}`,
              );
            }
          },
          warnings,
        });

        if (outcome.missing.length > 0) process.exitCode = ExitCode.Drift;
      } catch (e) {
        if (e instanceof AxeError) {
          renderError({ command: 'mods sync', error: e, opts });
          return;
        }
        throw e;
      }
    });
}
