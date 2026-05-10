import type { Command } from 'commander';
import { ExitCode } from '../../core/index.ts';
import { readOutputOptions, renderFail } from '../output.ts';

export function registerDoctor(program: Command): void {
  program
    .command('doctor')
    .description('run a series of read-only sanity checks against the install')
    .action((_options: unknown, cmd: Command) => {
      const out = readOutputOptions(cmd);
      const code = renderFail('doctor', ExitCode.Misuse, 'not implemented yet (lands in PR1)', out);
      process.exit(code);
    });
}
