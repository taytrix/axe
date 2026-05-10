import { homedir } from 'node:os';
import * as posix from 'node:path/posix';

/**
 * Service mode — drives the ExecStart axe verb.
 *
 *   foreground → `axe ... start --foreground` (the actual Conan server)
 *   daemon     → `axe ... daemon run`         (the drift sensor tickloop)
 *
 * Both are systemd `Type=simple` user units; only the verb differs.
 */
export type ServiceMode = 'foreground' | 'daemon';

export type SystemdUserUnitInput = {
  mode: ServiceMode;
  /** Unit name without the `.service` suffix (e.g. `axe-conan`). */
  name: string;
  /** Absolute path to the axe binary. */
  axePath: string;
  /** Absolute path to the operator's `axe.toml`. */
  configPath: string;
  /** systemd `WorkingDirectory=`; per the axe-root convention, equals `server.root`. */
  workingDirectory: string;
};

const FOREGROUND_DESCRIPTION = 'Conan Exiles dedicated server (via axe)';
const DAEMON_DESCRIPTION = 'axe drift sensor for Conan Exiles dedicated server';

const FOREGROUND_HEADER = '# axe-generated systemd user unit (foreground server mode)';
const DAEMON_HEADER = '# axe-generated systemd user unit (drift sensor / daemon mode)';

/**
 * Render a systemd user unit. Pure: no I/O, no environment lookup, no
 * `os.homedir()` calls — the caller computes those and passes them in.
 *
 * Output is a stable text block the operator can pipe to
 * `~/.config/systemd/user/<name>.service`. axe never writes it.
 */
export function renderSystemdUserUnit(input: SystemdUserUnitInput): string {
  const verb = input.mode === 'foreground' ? 'start --foreground' : 'daemon run';
  const description = input.mode === 'foreground' ? FOREGROUND_DESCRIPTION : DAEMON_DESCRIPTION;
  const header = input.mode === 'foreground' ? FOREGROUND_HEADER : DAEMON_HEADER;
  const execStart = `${input.axePath} --config ${input.configPath} ${verb}`;
  return [
    header,
    `# install: ~/.config/systemd/user/${input.name}.service`,
    `# enable:  systemctl --user enable --now ${input.name}`,
    `# survive reboot without login: loginctl enable-linger $USER`,
    `# axe-path: ${input.axePath}`,
    '',
    '[Unit]',
    `Description=${description}`,
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    'Type=simple',
    `ExecStart=${execStart}`,
    'Restart=on-failure',
    'RestartSec=10',
    `WorkingDirectory=${input.workingDirectory}`,
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n');
}

/**
 * Default unit name (no `.service` suffix). Mirrors the convention:
 *   foreground → `axe-<server.id>`
 *   daemon     → `axe-<server.id>-daemon`
 */
export function defaultUnitName(serverId: string, mode: ServiceMode): string {
  return mode === 'foreground' ? `axe-${serverId}` : `axe-${serverId}-daemon`;
}

/**
 * Compute the suggested install path for a unit name. Informational only —
 * axe never writes here. Resolves `~` via `os.homedir()`.
 */
export function defaultInstallPath(name: string): string {
  return posix.join(homedir(), '.config', 'systemd', 'user', `${name}.service`);
}
