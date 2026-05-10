import type { Command } from 'commander';
import {
  AxeError,
  ExitCode,
  hasDrift,
  loadConfig,
  loadContext,
  runModsCheck,
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
}
