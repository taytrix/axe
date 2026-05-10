import { AxeError } from './errors.ts';

const PATTERN = /^(\d+)(s|m|h)$/;

/**
 * Parse a duration string like `"5m"`, `"30s"`, `"1h"`, `"90s"` into seconds.
 *
 * Unit is required — bare numbers (e.g. `"300"`) are rejected so callers
 * can't accidentally confuse seconds vs milliseconds. Days/weeks aren't
 * supported; if a future need arises, add `d` here deliberately.
 *
 * Throws `AxeError('config')` on invalid input.
 */
export function parseDuration(input: string): number {
  const match = input.trim().match(PATTERN);
  if (!match) {
    throw new AxeError('config', `invalid duration "${input}"; expected like "30s" / "5m" / "1h"`);
  }
  const n = Number.parseInt(match[1] as string, 10);
  switch (match[2]) {
    case 's':
      return n;
    case 'm':
      return n * 60;
    case 'h':
      return n * 3600;
    default:
      // Unreachable: the regex only allows s/m/h.
      throw new AxeError('config', `invalid duration unit in "${input}"`);
  }
}
