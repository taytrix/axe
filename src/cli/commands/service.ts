import * as posix from 'node:path/posix';
import type { Command } from 'commander';
import {
  AxeError,
  defaultInstallPath,
  defaultUnitName,
  ExitCode,
  loadContext,
  renderSystemdUserUnit,
  type ServiceMode,
} from '../../core/index.ts';
import {
  readGlobalConfigPath,
  readOutputOptions,
  renderError,
  renderFail,
  renderOk,
} from '../output.ts';

type ServicePrintFlags = {
  mode?: string;
  name?: string;
  axePath?: string;
};

type ServicePrintData = {
  mode: ServiceMode;
  name: string;
  axe_path: string;
  config_path: string;
  install_path: string;
  text: string;
};

export function registerService(program: Command): void {
  const service = program.command('service').description('generate service definitions');

  service
    .command('print')
    .description('print a systemd user unit (linux-only); operator installs it themselves')
    .option('--mode <mode>', 'foreground (default; runs the server) or daemon (drift sensor)')
    .option('--name <name>', 'unit name without .service suffix; default from server.id + mode')
    .option('--axe-path <path>', 'absolute axe binary path; default to process.execPath')
    .action(async (options: ServicePrintFlags, cmd: Command) => {
      const opts = readOutputOptions(cmd);
      const configPath = readGlobalConfigPath(cmd);

      const mode = parseMode(options.mode);
      if (mode === null) {
        renderFail({
          command: 'service print',
          code: ExitCode.Misuse,
          message: `--mode expects "foreground" or "daemon"; got "${options.mode}"`,
          opts,
        });
        return;
      }

      try {
        const { config } = await loadContext(configPath);
        const name = options.name ?? defaultUnitName(config.server.id, mode);
        // Bun-compiled binaries put a virtual `/$bunfs/...` path in argv[1];
        // process.execPath is the real on-disk binary that systemd can spawn.
        const axePath = options.axePath ?? process.execPath;
        const absoluteConfig = posix.resolve(configPath);
        const absoluteRoot = posix.resolve(config.server.root);
        const text = renderSystemdUserUnit({
          mode,
          name,
          axePath,
          configPath: absoluteConfig,
          workingDirectory: absoluteRoot,
        });
        const data: ServicePrintData = {
          mode,
          name,
          axe_path: axePath,
          config_path: absoluteConfig,
          install_path: defaultInstallPath(name),
          text,
        };
        renderOk({
          command: 'service print',
          data,
          opts,
          human: () => process.stdout.write(text),
        });
      } catch (e) {
        if (e instanceof AxeError) {
          renderError({ command: 'service print', error: e, opts });
          return;
        }
        throw e;
      }
    });
}

function parseMode(raw: string | undefined): ServiceMode | null {
  if (raw === undefined) return 'foreground';
  if (raw === 'foreground' || raw === 'daemon') return raw;
  return null;
}
