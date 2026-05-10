import { readFile } from 'node:fs/promises';
import * as ini from 'ini';
import { AxeError } from './errors.ts';
import type { Layout } from './layout.ts';

export type ServerSettings = {
  /** True when `RconEnabled=1` (or `True`); false when `0`/`False`; null on missing. */
  rcon_enabled: boolean | null;
  /** Numeric RCON port; null if missing or unparseable. */
  rcon_port: number | null;
  /** Raw password string; null if missing. */
  rcon_password: string | null;
  /** Conan-specific spam mitigation; null if missing. */
  rcon_max_karma: number | null;
};

const EMPTY: ServerSettings = {
  rcon_enabled: null,
  rcon_port: null,
  rcon_password: null,
  rcon_max_karma: null,
};

/**
 * Read `ServerSettings.ini` and extract the four RCON keys under
 * `[ServerSettings]`. Tolerant: missing file returns nulls + a warning;
 * malformed ini surfaces as `AxeError('config')`.
 */
export async function readServerSettings(
  layout: Layout,
): Promise<{ settings: ServerSettings; warnings: string[] }> {
  const warnings: string[] = [];
  let text: string;
  try {
    text = await readFile(layout.server_settings_ini, 'utf8');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      warnings.push(`${layout.server_settings_ini} not found; RCON config unknown`);
      return { settings: { ...EMPTY }, warnings };
    }
    throw new AxeError('config', `reading ${layout.server_settings_ini}: ${(e as Error).message}`);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = ini.parse(text) as Record<string, unknown>;
  } catch (e) {
    throw new AxeError('config', `parsing ${layout.server_settings_ini}: ${(e as Error).message}`);
  }

  const section = (parsed.ServerSettings ?? parsed.serversettings) as
    | Record<string, unknown>
    | undefined;
  if (!section) {
    warnings.push(`${layout.server_settings_ini} has no [ServerSettings] section`);
    return { settings: { ...EMPTY }, warnings };
  }

  return {
    settings: {
      rcon_enabled: parseBool(section.RconEnabled),
      rcon_port: parseInt10(section.RconPort),
      rcon_password: parseString(section.RconPassword),
      rcon_max_karma: parseInt10(section.RconMaxKarma),
    },
    warnings,
  };
}

function parseBool(v: unknown): boolean | null {
  if (v === undefined) return null;
  const s = String(v).trim().toLowerCase();
  if (s === '1' || s === 'true') return true;
  if (s === '0' || s === 'false') return false;
  return null;
}

function parseInt10(v: unknown): number | null {
  if (v === undefined) return null;
  const n = Number.parseInt(String(v).trim(), 10);
  return Number.isFinite(n) ? n : null;
}

function parseString(v: unknown): string | null {
  if (v === undefined) return null;
  const s = String(v);
  return s.length > 0 ? s : null;
}
