import type { Command } from 'commander';
import pkg from '../../../package.json' with { type: 'json' };
import { readOutputOptions, renderOk } from '../output.ts';

type VersionData = { version: string };

export function registerVersion(program: Command): void {
  program
    .command('version')
    .description('print version information')
    .action((_options: unknown, cmd: Command) => {
      const opts = readOutputOptions(cmd);
      const data: VersionData = { version: pkg.version };
      renderOk({
        command: 'version',
        data,
        opts,
        human: () => console.log(`axe ${pkg.version}`),
      });
    });
}
