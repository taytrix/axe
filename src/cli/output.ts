import type { Command } from 'commander';
import pc from 'picocolors';
import type { Finding, Report } from '../core/doctor.ts';
import { type AxeError, ExitCode as Exit, type ExitCode } from '../core/errors.ts';
import type { FreshnessReport, FreshnessState, ModFreshness } from '../core/mods.ts';

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

/** Whether colour escape codes should be emitted given options + terminal. */
export function shouldColor(opts: OutputOptions): boolean {
  if (opts.noColor) return false;
  if (process.env.NO_COLOR) return false;
  return process.stdout.isTTY ?? false;
}

/** Compile-time exhaustiveness assertion for switches over discriminated unions. */
export function assertNever(x: never): never {
  throw new Error(`unexpected variant: ${String(x)}`);
}

export type RenderOkArgs<T> = {
  command: string;
  data: T;
  opts: OutputOptions;
  human?: () => void;
  warnings?: readonly string[];
};

export type RenderErrorArgs = {
  command: string;
  error: AxeError;
  opts: OutputOptions;
};

export type RenderFailArgs = {
  command: string;
  code: ExitCode;
  message: string;
  opts: OutputOptions;
};

export function renderOk<T>({ command, data, opts, human, warnings }: RenderOkArgs<T>): void {
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
export function renderError({ command, error, opts }: RenderErrorArgs): void {
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
export function renderFail({ command, code, message, opts }: RenderFailArgs): void {
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
    const label = renderLevelLabel(f.level, color);
    const topic = color ? pc.dim(f.topic.padStart(8)) : f.topic.padStart(8);
    console.log(`${label} ${topic}  ${f.message}`);
  }
}

function renderLevelLabel(level: Finding['level'], color: boolean): string {
  const text = level === 'ok' ? 'ok   ' : level === 'warn' ? 'warn ' : 'error';
  if (!color) return text;
  if (level === 'ok') return pc.green(pc.bold(text));
  if (level === 'warn') return pc.yellow(pc.bold(text));
  return pc.red(pc.bold(text));
}

/** Human-mode renderer for a mod freshness report. */
export function renderFreshness(report: FreshnessReport, opts: OutputOptions): void {
  if (report.items.length === 0) {
    console.log('no mods configured');
    return;
  }
  const color = shouldColor(opts);
  for (const m of report.items) {
    console.log(formatFreshnessItem(m, color));
  }
  console.log(
    `${report.total} declared: ${report.current} current, ${report.stale} stale, ${report.missing_local} missing_local, ${report.missing_remote} missing_remote, ${report.unmanaged} unmanaged`,
  );
}

function formatFreshnessItem(m: ModFreshness, color: boolean): string {
  const stateText = renderStateLabel(m.state, color);
  const title = m.title ?? `mod-${m.id.toString()}`;
  const idTag = color ? pc.dim(`(${m.id.toString()})`) : `(${m.id.toString()})`;
  if (m.state === 'stale') {
    const inst = formatDate(m.local_time_updated);
    const lat = formatDate(m.latest_time_updated);
    return `${stateText} ${title} ${idTag} updated ${inst} -> ${lat}`;
  }
  return `${stateText} ${title} ${idTag}`;
}

function renderStateLabel(state: FreshnessState, color: boolean): string {
  const text = state.padEnd(14);
  if (!color) return text;
  switch (state) {
    case 'current':
      return pc.green(pc.bold(text));
    case 'stale':
      return pc.yellow(pc.bold(text));
    case 'missing_local':
    case 'missing_remote':
      return pc.red(pc.bold(text));
    case 'unmanaged':
      return pc.dim(text);
    default:
      return assertNever(state);
  }
}

function formatDate(ts: number | null): string {
  if (ts === null || ts === 0) return '?';
  return new Date(ts * 1000).toISOString().slice(0, 10);
}
