import { readdir, readFile, stat } from 'node:fs/promises';
import * as posix from 'node:path/posix';
import type { Config } from './config.ts';
import type { Layout } from './layout.ts';

export type Level = 'ok' | 'warn' | 'error';
export type Finding = { level: Level; topic: string; message: string };
export type Report = { findings: Finding[] };

/** Pure helper: returns the worst level present in the report. */
export function worstFinding(report: Report): Level {
  let worst: Level = 'ok';
  for (const f of report.findings) {
    if (f.level === 'error') return 'error';
    if (f.level === 'warn' && worst === 'ok') worst = 'warn';
  }
  return worst;
}

/** Run all v0.1 read-only checks against `layout` and the config it came from. */
export async function runDoctor(config: Config, layout: Layout): Promise<Report> {
  const findings: Finding[] = [];
  findings.push(await checkRoot(layout));
  findings.push(await checkBinary(layout));
  findings.push(await checkConfigDir(layout));
  findings.push(...(await checkInis(layout)));
  findings.push(await checkModlist(layout));
  findings.push(await checkWorkshop(layout));
  findings.push(await checkGameDb(layout));
  findings.push(await checkLogsDir(layout));
  findings.push(checkServerId(config));
  return { findings };
}

async function checkRoot(layout: Layout): Promise<Finding> {
  if (await isDirectory(layout.root)) {
    return { level: 'ok', topic: 'root', message: layout.root };
  }
  return { level: 'error', topic: 'root', message: `${layout.root} is not a directory` };
}

async function checkBinary(layout: Layout): Promise<Finding> {
  if (!(await isFile(layout.binary))) {
    return { level: 'error', topic: 'binary', message: `missing ${layout.binary}` };
  }
  if (process.platform !== 'win32') {
    try {
      const st = await stat(layout.binary);
      const executable = (st.mode & 0o111) !== 0;
      const name = posix.basename(layout.binary);
      if (executable) {
        return { level: 'ok', topic: 'binary', message: `${name} (executable)` };
      }
      return { level: 'warn', topic: 'binary', message: `${layout.binary} is not executable` };
    } catch (e) {
      return {
        level: 'warn',
        topic: 'binary',
        message: `stat ${layout.binary}: ${(e as Error).message}`,
      };
    }
  }
  return { level: 'ok', topic: 'binary', message: posix.basename(layout.binary) };
}

async function checkConfigDir(layout: Layout): Promise<Finding> {
  if (await isDirectory(layout.config_dir)) {
    return { level: 'ok', topic: 'config', message: layout.config_dir };
  }
  return {
    level: 'warn',
    topic: 'config',
    message: `${layout.config_dir} not present yet (server has not generated configs)`,
  };
}

async function checkInis(layout: Layout): Promise<Finding[]> {
  const checks: Array<[string, string]> = [
    ['ServerSettings.ini', layout.server_settings_ini],
    ['Engine.ini', layout.engine_ini],
    ['Game.ini', layout.game_ini],
  ];
  const out: Finding[] = [];
  for (const [label, path] of checks) {
    if (await isFile(path)) {
      out.push({ level: 'ok', topic: 'ini', message: `${label} present` });
    } else {
      out.push({ level: 'warn', topic: 'ini', message: `${label} not present at ${path}` });
    }
  }
  return out;
}

async function checkModlist(layout: Layout): Promise<Finding> {
  try {
    const text = await readFile(layout.modlist_txt, 'utf8');
    const n = text.split('\n').filter((l) => l.trim().length > 0).length;
    return {
      level: 'ok',
      topic: 'modlist',
      message: `${n} entr${n === 1 ? 'y' : 'ies'} in ${layout.modlist_txt}`,
    };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return {
        level: 'warn',
        topic: 'modlist',
        message: `${layout.modlist_txt} not present (no mods enabled)`,
      };
    }
    return {
      level: 'warn',
      topic: 'modlist',
      message: `read ${layout.modlist_txt}: ${(e as Error).message}`,
    };
  }
}

async function checkWorkshop(layout: Layout): Promise<Finding> {
  if (await isFile(layout.workshop_acf)) {
    return { level: 'ok', topic: 'workshop', message: `${layout.workshop_acf} present` };
  }
  return {
    level: 'warn',
    topic: 'workshop',
    message: `${layout.workshop_acf} not present (mods will populate it on first download)`,
  };
}

async function checkGameDb(layout: Layout): Promise<Finding> {
  if (await isFile(layout.game_db)) {
    return { level: 'ok', topic: 'game.db', message: layout.game_db };
  }
  if (layout.platform !== 'linux') {
    return { level: 'warn', topic: 'game.db', message: `${layout.game_db} not present yet` };
  }
  // Linux is case-sensitive; warn if a mis-cased file exists.
  const saved = posix.join(layout.root, 'ConanSandbox/Saved');
  try {
    const entries = await readdir(saved);
    for (const name of entries) {
      if (name.toLowerCase() === 'game.db' && name !== 'game.db') {
        return {
          level: 'error',
          topic: 'game.db',
          message: `found ${name} but Linux requires lowercase 'game.db'`,
        };
      }
    }
  } catch {
    /* saved/ doesn't exist yet — fall through */
  }
  return { level: 'warn', topic: 'game.db', message: `${layout.game_db} not present yet` };
}

async function checkLogsDir(layout: Layout): Promise<Finding> {
  if (await isDirectory(layout.logs_dir)) {
    return { level: 'ok', topic: 'logs', message: layout.logs_dir };
  }
  return { level: 'warn', topic: 'logs', message: `${layout.logs_dir} not present yet` };
}

function checkServerId(config: Config): Finding {
  if (config.server.id.trim().length === 0) {
    return { level: 'error', topic: 'server.id', message: 'axe.toml [server] id is empty' };
  }
  return { level: 'ok', topic: 'server.id', message: config.server.id };
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}
