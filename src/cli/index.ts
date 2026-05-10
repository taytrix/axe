import { Command } from 'commander';
import pkg from '../../package.json' with { type: 'json' };
import { registerDoctor } from './commands/doctor.ts';
import { registerInit } from './commands/init.ts';
import { registerVersion } from './commands/version.ts';

export const program = new Command();

program
  .name('axe')
  .description('Conan Exiles Enhanced dedicated-server CLI')
  .version(pkg.version)
  .option('--json', 'emit JSON envelope on stdout instead of human-readable output')
  .option('--quiet', 'suppress non-error output')
  .option('--config <path>', 'path to axe.toml', 'axe.toml')
  .option('--no-color', 'disable terminal colors');

registerVersion(program);
registerInit(program);
registerDoctor(program);
