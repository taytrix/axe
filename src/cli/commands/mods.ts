import { readFile } from 'node:fs/promises';
import type { Command } from 'commander';
import pc from 'picocolors';
import {
  AxeError,
  checkModFreshness,
  ExitCode,
  type FreshnessReport,
  type FreshnessState,
  getPublishedFileDetails,
  loadConfig,
  type ModFreshness,
  parseAcf,
  probe,
  type WorkshopItem,
} from '../../core/index.ts';
import { readGlobalConfigPath, readOutputOptions, renderError, renderOk } from '../output.ts';

export function registerMods(program: Command): void {
  const mods = program.command('mods').description('manage the canonical mod list');

  mods
    .command('list')
    .description('show the mod list from axe.toml')
    .action(async (_options: unknown, cmd: Command) => {
      const out = readOutputOptions(cmd);
      const configPath = readGlobalConfigPath(cmd);
      try {
        const config = await loadConfig(configPath);
        const items = config.mods.ids.map((id) => ({ id }));
        renderOk('mods list', { items }, out, () => {
          if (items.length === 0) {
            console.log('no mods configured in axe.toml');
            return;
          }
          console.log(`${items.length} mod${items.length === 1 ? '' : 's'} configured:`);
          for (const m of items) console.log(`  ${m.id.toString()}`);
        });
      } catch (e) {
        if (e instanceof AxeError) {
          renderError('mods list', e, out);
          return;
        }
        throw e;
      }
    });

  mods
    .command('check')
    .description('compare installed mods against Steam Workshop; report stale/missing')
    .action(async (_options: unknown, cmd: Command) => {
      const out = readOutputOptions(cmd);
      const configPath = readGlobalConfigPath(cmd);
      try {
        const config = await loadConfig(configPath);
        const layout = await probe(config.server.root);
        const declared = config.mods.ids;

        const localAcf = await readAcfFromLayout(layout.workshop_acf);

        const warnings: string[] = [];
        let remote: WorkshopItem[] = [];
        if (declared.length > 0) {
          try {
            remote = await getPublishedFileDetails(declared);
          } catch (apiErr) {
            if (apiErr instanceof AxeError && apiErr.kind === 'workshop_api') {
              warnings.push(`workshop API unreachable: ${apiErr.message}; using ACF latest_* only`);
            } else {
              throw apiErr;
            }
          }
        }

        const report = checkModFreshness(declared, localAcf, remote);

        renderOk('mods check', report, out, () => renderFreshnessHuman(report, out), warnings);

        if (report.stale > 0 || report.missing_local > 0 || report.missing_remote > 0) {
          process.exitCode = ExitCode.Drift;
        }
      } catch (e) {
        if (e instanceof AxeError) {
          renderError('mods check', e, out);
          return;
        }
        throw e;
      }
    });
}

async function readAcfFromLayout(path: string): Promise<ReturnType<typeof parseAcf>> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return { mods: new Map() };
    }
    throw new AxeError('filesystem', `reading ${path}: ${(e as Error).message}`);
  }
  return parseAcf(text);
}

function renderFreshnessHuman(report: FreshnessReport, opts: { noColor: boolean }): void {
  const color = !opts.noColor && (process.stdout.isTTY ?? false) && !process.env.NO_COLOR;
  if (report.items.length === 0) {
    console.log('no mods configured');
    return;
  }
  for (const m of report.items) {
    console.log(formatItem(m, color));
  }
  console.log(
    `${report.total} declared: ${report.current} current, ${report.stale} stale, ${report.missing_local} missing_local, ${report.missing_remote} missing_remote, ${report.unmanaged} unmanaged`,
  );
}

function formatItem(m: ModFreshness, color: boolean): string {
  const stateText = stateLabel(m.state, color);
  const title = m.title ?? `mod-${m.id.toString()}`;
  const idTag = color ? pc.dim(`(${m.id.toString()})`) : `(${m.id.toString()})`;
  if (m.state === 'stale') {
    const inst = fmtDate(m.local_time_updated);
    const lat = fmtDate(m.latest_time_updated);
    return `${stateText} ${title} ${idTag} updated ${inst} -> ${lat}`;
  }
  return `${stateText} ${title} ${idTag}`;
}

function stateLabel(state: FreshnessState, color: boolean): string {
  const text = padState(state);
  if (!color) return text;
  switch (state) {
    case 'current':
      return pc.green(pc.bold(text));
    case 'stale':
      return pc.yellow(pc.bold(text));
    case 'missing_local':
    case 'missing_remote':
      return pc.red(pc.bold(text));
    case 'unmanaged':
      return pc.dim(text);
  }
}

function padState(state: FreshnessState): string {
  return state.padEnd(14);
}

function fmtDate(ts: number | null): string {
  if (ts === null || ts === 0) return '?';
  return new Date(ts * 1000).toISOString().slice(0, 10);
}
