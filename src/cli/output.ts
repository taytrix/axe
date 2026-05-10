import type { Command } from 'commander';
import pc from 'picocolors';
import type { Finding, Report } from '../core/doctor.ts';
import { type AxeError, ExitCode as Exit, type ExitCode } from '../core/errors.ts';

export type OutputOptions = {
  json: boolean;
  quiet: boolean;
  noColor: boolean;
};

function rootCommand(cmd: Command): Command {
  let current = cmd;
  while (current.parent) current = current.parent;
  return current;
}

export function readOutputOptions(cmd: Command): OutputOptions {
  const root = rootCommand(cmd);
  const opts = root.opts<{ json?: boolean; quiet?: boolean; color?: boolean }>();
  return {
    json: opts.json ?? false,
    quiet: opts.quiet ?? false,
    // commander turns --no-color into { color: false }
    noColor: opts.color === false,
  };
}

export function readGlobalConfigPath(cmd: Command): string {
  const root = rootCommand(cmd);
  const opts = root.opts<{ config?: string }>();
  return opts.config ?? 'axe.toml';
}

export function stringifyJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? v.toString() : v));
}

function shouldColor(opts: OutputOptions): boolean {
  if (opts.noColor) return false;
  if (process.env.NO_COLOR) return false;
  return process.stdout.isTTY ?? false;
}

export function renderOk<T>(
  command: string,
  data: T,
  opts: OutputOptions,
  human?: () => void,
  warnings?: readonly string[],
): void {
  if (opts.json) {
    const envelope = {
      ok: true,
      command,
      data,
      error: null,
      ...(warnings && warnings.length > 0 ? { warnings: [...warnings] } : {}),
    };
    console.log(stringifyJson(envelope));
    return;
  }
  if (opts.quiet) return;
  human?.();
  if (warnings && warnings.length > 0) {
    const color = shouldColor(opts);
    for (const w of warnings) {
      const tag = color ? pc.yellow(pc.bold('warn')) : 'warn';
      console.error(`${tag} ${w}`);
    }
  }
}

/**
 * Render a typed AxeError. Sets process.exitCode and prints either a JSON
 * envelope (with semantic `kind`) or a one-line stderr message.
 */
export function renderError(command: string, error: AxeError, opts: OutputOptions): void {
  const code = error.exitCode();
  if (opts.json) {
    const envelope = {
      ok: false,
      command,
      data: null,
      error: { code, kind: error.kind, message: error.message },
    };
    console.log(stringifyJson(envelope));
  } else {
    const prefix = `axe ${command}:`;
    const colored = shouldColor(opts) ? pc.red(prefix) : prefix;
    console.error(`${colored} ${error.message}`);
  }
  process.exitCode = code;
}

/**
 * Render a non-AxeError failure (misuse, internal precondition violation).
 * Sets process.exitCode. For typed errors, prefer `renderError`.
 */
export function renderFail(
  command: string,
  code: ExitCode,
  message: string,
  opts: OutputOptions,
): void {
  if (opts.json) {
    const kind = code === Exit.Misuse ? 'misuse' : 'error';
    const envelope = {
      ok: false,
      command,
      data: null,
      error: { code, kind, message },
    };
    console.log(stringifyJson(envelope));
  } else {
    const prefix = `axe ${command}:`;
    const colored = shouldColor(opts) ? pc.red(prefix) : prefix;
    console.error(`${colored} ${message}`);
  }
  process.exitCode = code;
}

/** Human-mode renderer for a doctor Report. */
export function renderReport(report: Report, opts: OutputOptions): void {
  const color = shouldColor(opts);
  for (const f of report.findings) {
    const label = renderLevel(f.level, color);
    const topic = color ? pc.dim(f.topic.padStart(8)) : f.topic.padStart(8);
    console.log(`${label} ${topic}  ${f.message}`);
  }
}

function renderLevel(level: Finding['level'], color: boolean): string {
  const text = level === 'ok' ? 'ok   ' : level === 'warn' ? 'warn ' : 'error';
  if (!color) return text;
  if (level === 'ok') return pc.green(pc.bold(text));
  if (level === 'warn') return pc.yellow(pc.bold(text));
  return pc.red(pc.bold(text));
}
