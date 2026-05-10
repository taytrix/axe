import type { Command } from 'commander';
import { ExitCode } from '../../core/index.ts';
import { readOutputOptions, renderFail } from '../output.ts';

export function registerInit(program: Command): void {
  program
    .command('init')
    .description('write a starter axe.toml in the current directory')
    .action((_options: unknown, cmd: Command) => {
      const out = readOutputOptions(cmd);
      const code = renderFail('init', ExitCode.Misuse, 'not implemented yet (lands in PR1)', out);
      process.exit(code);
    });
}
