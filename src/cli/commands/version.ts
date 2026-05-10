import type { Command } from 'commander';
import pkg from '../../../package.json' with { type: 'json' };
import { readOutputOptions, renderOk } from '../output.ts';

type VersionData = { version: string };

export function registerVersion(program: Command): void {
  program
    .command('version')
    .description('print version information')
    .action((_options: unknown, cmd: Command) => {
      const out = readOutputOptions(cmd);
      const data: VersionData = { version: pkg.version };
      renderOk('version', data, out, () => {
        console.log(`axe ${pkg.version}`);
      });
    });
}
