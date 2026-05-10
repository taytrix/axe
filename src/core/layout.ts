import * as posix from 'node:path/posix';
import type { Platform } from './types.ts';

/** Steam appid of the Conan Exiles dedicated-server depot. */
export const SERVER_APPID = 443_030;

/** Steam appid of the Conan Exiles client (which owns Workshop content). */
export const WORKSHOP_APPID = 440_900;

/**
 * Resolved view of every well-known path inside an install root.
 * `launcher_script` is omitted on Windows (no `ConanSandboxServer.sh`).
 */
export type Layout = {
  platform: Platform;
  root: string;
  binary: string;
  launcher_script?: string;
  config_dir: string;
  server_settings_ini: string;
  engine_ini: string;
  game_ini: string;
  mods_dir: string;
  modlist_txt: string;
  workshop_content: string;
  workshop_acf: string;
  game_db: string;
  logs_dir: string;
};

const LINUX = {
  binary_subdir: 'ConanSandbox/Binaries/Linux',
  binary_name: 'ConanSandboxServer-Linux-Shipping',
  config_subdir: 'ConanSandbox/Saved/Config/LinuxServer',
} as const;

const WINDOWS = {
  binary_subdir: 'ConanSandbox/Binaries/Win64',
  binary_name: 'ConanSandboxServer.exe',
  config_subdir: 'ConanSandbox/Saved/Config/WindowsServer',
} as const;

/** Build a `Layout` for `root` on `platform` without checking existence. */
export function layoutAt(root: string, platform: Platform): Layout {
  const meta = platform === 'linux' ? LINUX : WINDOWS;
  const binDir = posix.join(root, meta.binary_subdir);
  const cfgDir = posix.join(root, meta.config_subdir);
  const saved = posix.join(root, 'ConanSandbox/Saved');
  const workshop = posix.join(root, 'steamapps/workshop');

  const base: Layout = {
    platform,
    root,
    binary: posix.join(binDir, meta.binary_name),
    config_dir: cfgDir,
    server_settings_ini: posix.join(cfgDir, 'ServerSettings.ini'),
    engine_ini: posix.join(cfgDir, 'Engine.ini'),
    game_ini: posix.join(cfgDir, 'Game.ini'),
    mods_dir: posix.join(root, 'ConanSandbox/Mods'),
    modlist_txt: posix.join(root, 'ConanSandbox/Mods/modlist.txt'),
    workshop_content: posix.join(workshop, `content/${WORKSHOP_APPID}`),
    workshop_acf: posix.join(workshop, `appworkshop_${WORKSHOP_APPID}.acf`),
    game_db: posix.join(saved, 'game.db'),
    logs_dir: posix.join(saved, 'Logs'),
  };

  if (platform === 'linux') {
    return { ...base, launcher_script: posix.join(root, 'ConanSandboxServer.sh') };
  }
  return base;
}
