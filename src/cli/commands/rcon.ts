import type { Command } from 'commander';
import {
  AxeError,
  connectRcon,
  ExitCode,
  hostPlatform,
  layoutAt,
  loadConfig,
  readServerSettings,
} from '../../core/index.ts';
import {
  readGlobalConfigPath,
  readOutputOptions,
  renderError,
  renderFail,
  renderOk,
} from '../output.ts';

type RconExecFlags = {
  rconHost?: string;
  rconPort?: string;
  rconPassword?: string;
};

type RconExecData = {
  command: string;
  response: string;
  host: string;
  port: number;
};

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 25575;

export function registerRcon(program: Command): void {
  const rcon = program.command('rcon').description('issue read-only RCON commands to the server');

  rcon
    .command('exec')
    .argument('<cmd...>', 'RCON command and arguments (joined with spaces)')
    .description('connect via RCON, run a single command, print the response')
    .option('--rcon-host <host>', `RCON host (env: AXE_RCON_HOST; default: ${DEFAULT_HOST})`)
    .option(
      '--rcon-port <port>',
      `RCON port (env: AXE_RCON_PORT; falls back to ServerSettings.ini, then ${DEFAULT_PORT})`,
    )
    .option(
      '--rcon-password <pass>',
      'RCON password (env: AXE_RCON_PASSWORD; falls back to ServerSettings.ini)',
    )
    .action(async (cmdArgs: string[], options: RconExecFlags, cmd: Command) => {
      const opts = readOutputOptions(cmd);
      const configPath = readGlobalConfigPath(cmd);
      const command = cmdArgs.join(' ').trim();
      if (command.length === 0) {
        renderFail({
          command: 'rcon exec',
          code: ExitCode.Misuse,
          message: 'no command supplied',
          opts,
        });
        return;
      }

      try {
        const config = await loadConfig(configPath);
        const layout = layoutAt(config.server.root, hostPlatform());
        const ini = await readServerSettings(layout);

        const host = options.rconHost ?? process.env.AXE_RCON_HOST ?? DEFAULT_HOST;

        const portStr = options.rconPort ?? process.env.AXE_RCON_PORT ?? null;
        const port =
          portStr !== null
            ? Number.parseInt(portStr, 10)
            : (ini.settings.rcon_port ?? DEFAULT_PORT);
        if (!Number.isFinite(port) || port <= 0) {
          renderFail({
            command: 'rcon exec',
            code: ExitCode.Misuse,
            message: `invalid RCON port: ${portStr ?? port}`,
            opts,
          });
          return;
        }

        const password =
          options.rconPassword ??
          process.env.AXE_RCON_PASSWORD ??
          ini.settings.rcon_password ??
          null;
        if (password === null) {
          throw new AxeError(
            'config',
            'no RCON password (set --rcon-password, AXE_RCON_PASSWORD, or RconPassword in ServerSettings.ini)',
          );
        }

        if (ini.settings.rcon_enabled === false && options.rconPort === undefined) {
          throw new AxeError(
            'config',
            'RCON is disabled in ServerSettings.ini (RconEnabled=0); set --rcon-port to override',
          );
        }

        const conn = await connectRcon({ host, port, password });
        try {
          const response = await conn.exec(command);
          const data: RconExecData = { command, response, host, port };
          renderOk({
            command: 'rcon exec',
            data,
            opts,
            human: () => {
              if (response.length > 0) console.log(response);
            },
          });
        } finally {
          conn.close();
        }
      } catch (e) {
        if (e instanceof AxeError) {
          renderError({ command: 'rcon exec', error: e, opts });
          return;
        }
        throw e;
      }
    });
}
