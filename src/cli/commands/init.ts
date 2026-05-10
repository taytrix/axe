import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as posix from 'node:path/posix';
import type { Command } from 'commander';
import pc from 'picocolors';
import {
  AxeError,
  type Config,
  configFromRoot,
  ExitCode,
  type Platform,
  probe,
  saveConfig,
  serializeConfig,
} from '../../core/index.ts';
import {
  readGlobalConfigPath,
  readOutputOptions,
  renderError,
  renderFail,
  renderOk,
} from '../output.ts';

type InitFlags = { probe?: boolean; dryRun?: boolean };
type InitData = {
  config_path: string;
  server_id: string;
  root: string;
  platform: Platform | null;
  dry_run: boolean;
};

export function registerInit(program: Command): void {
  program
    .command('init')
    .description('write a starter axe.toml')
    .option('--probe', 'probe the install root and prefill platform + paths')
    .option('--dry-run', 'print what would be written; do not write the file')
    .argument('[root]', 'server install root to set as server.root (default: cwd)')
    .action(async (rootArg: string | undefined, options: InitFlags, cmd: Command) => {
      const opts = readOutputOptions(cmd);
      const configPath = readGlobalConfigPath(cmd);

      try {
        const root = canonicalize(rootArg ?? process.cwd());
        let config: Config;
        let platform: Platform | null = null;

        if (options.probe) {
          const layout = await probe(root);
          config = configFromRoot(deriveServerId(layout.root), layout.root);
          platform = layout.platform;
        } else {
          config = configFromRoot(deriveServerId(root), root);
        }

        if (options.dryRun) {
          const data: InitData = {
            config_path: configPath,
            server_id: config.server.id,
            root: config.server.root,
            platform,
            dry_run: true,
          };
          renderOk({
            command: 'init',
            data,
            opts,
            human: () => {
              console.log(pc.dim(`# would write to ${configPath}:`));
              console.log(serializeConfig(config));
            },
          });
          return;
        }

        if (await pathExists(configPath)) {
          renderFail({
            command: 'init',
            code: ExitCode.Config,
            message: `${configPath} already exists; refusing to overwrite`,
            opts,
          });
          return;
        }

        await saveConfig(config, configPath);

        const data: InitData = {
          config_path: configPath,
          server_id: config.server.id,
          root: config.server.root,
          platform,
          dry_run: false,
        };
        renderOk({
          command: 'init',
          data,
          opts,
          human: () => {
            console.log(`${pc.green(pc.bold('wrote'))} ${configPath}`);
            console.log(`  ${pc.dim('server.id =')} ${config.server.id}`);
            console.log(`  ${pc.dim('server.root =')} ${config.server.root}`);
            if (platform) console.log(`  ${pc.dim('platform =')} ${platform}`);
          },
        });
      } catch (e) {
        if (e instanceof AxeError) {
          renderError({ command: 'init', error: e, opts });
          return;
        }
        throw e;
      }
    });
}

function deriveServerId(root: string): string {
  const name = posix.basename(root);
  return name.length > 0 && name !== '.' && name !== '/' ? name : 'conan';
}

function canonicalize(p: string): string {
  // resolve `.`/`..` segments. We intentionally do not call realpath here;
  // doctor will surface real filesystem problems. Always returns posix-style.
  return resolve(p).replace(/\\/g, '/');
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}
