import type { Command } from 'commander';
import pc from 'picocolors';
import type { ExitCode } from '../core/errors.ts';

export type OutputOptions = {
  json: boolean;
  quiet: boolean;
  noColor: boolean;
};

export function readOutputOptions(cmd: Command): OutputOptions {
  const root = cmd.parent ?? cmd;
  const opts = root.opts<{ json?: boolean; quiet?: boolean; color?: boolean }>();
  return {
    json: opts.json ?? false,
    quiet: opts.quiet ?? false,
    // commander turns --no-color into { color: false }
    noColor: opts.color === false,
  };
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
): void {
  if (opts.json) {
    const envelope = { ok: true, command, data, error: null };
    console.log(stringifyJson(envelope));
    return;
  }
  if (opts.quiet) return;
  human?.();
}

export function renderFail(
  command: string,
  code: ExitCode,
  message: string,
  opts: OutputOptions,
): ExitCode {
  if (opts.json) {
    const envelope = {
      ok: false,
      command,
      data: null,
      error: { code, kind: 'error', message },
    };
    console.log(stringifyJson(envelope));
  } else {
    const prefix = `axe ${command}:`;
    const colored = shouldColor(opts) ? pc.red(prefix) : prefix;
    console.error(`${colored} ${message}`);
  }
  return code;
}
