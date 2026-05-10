import { AxeError } from './errors.ts';

/**
 * Narrow VDF / Valve KeyValues parser.
 *
 * Only the surface axe needs:
 * - quoted and unquoted strings
 * - nested `{ ... }` objects
 * - `//` line comments
 * - outer wrapper `"AppWorkshop" { ... }` auto-unwrapped
 *
 * Preserves key case (ACF keys are CamelCase). Maps preserve insertion order.
 *
 * Hand-rolled because every npm candidate as of 2026-05-09 is either stale
 * (2-4 years) or a single-author 0-userbase personal project. See plan
 * §Library research §PR2.
 */

export type VdfValue = string | VdfObject;
export type VdfObject = Map<string, VdfValue>;

type Token = { kind: 'str'; value: string } | { kind: 'open' } | { kind: 'close' };

const ESCAPES: Record<string, string> = {
  n: '\n',
  t: '\t',
  '"': '"',
  '\\': '\\',
};

function isWhitespace(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r';
}

function isStructural(c: string): boolean {
  return c === '{' || c === '}' || c === '"';
}

/** Advance past whitespace and `//` line comments; return the next non-skip index. */
function skipWhitespaceAndComments(text: string, start: number): number {
  let i = start;
  while (i < text.length) {
    const c = text[i] ?? '';
    if (isWhitespace(c)) {
      i++;
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    return i;
  }
  return i;
}

/** Read a `"..."` quoted string starting at `text[start] === '"'`. */
function readQuotedString(text: string, start: number): { value: string; next: number } {
  let i = start + 1; // skip opening "
  let s = '';
  while (i < text.length && text[i] !== '"') {
    if (text[i] === '\\' && i + 1 < text.length) {
      const c = text[i + 1] ?? '';
      s += ESCAPES[c] ?? c;
      i += 2;
    } else {
      s += text[i];
      i++;
    }
  }
  if (i >= text.length) {
    throw new AxeError('acf_parse', 'unterminated quoted string');
  }
  return { value: s, next: i + 1 }; // skip closing "
}

/** Read an unquoted string (until whitespace or structural char). */
function readUnquotedString(text: string, start: number): { value: string; next: number } {
  let i = start;
  let s = '';
  while (i < text.length) {
    const c = text[i] ?? '';
    if (isWhitespace(c) || isStructural(c)) break;
    s += c;
    i++;
  }
  return { value: s, next: i };
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    i = skipWhitespaceAndComments(text, i);
    if (i >= text.length) break;
    const c = text[i] ?? '';
    if (c === '{') {
      tokens.push({ kind: 'open' });
      i++;
      continue;
    }
    if (c === '}') {
      tokens.push({ kind: 'close' });
      i++;
      continue;
    }
    const reader = c === '"' ? readQuotedString : readUnquotedString;
    const { value, next } = reader(text, i);
    tokens.push({ kind: 'str', value });
    i = next;
  }
  return tokens;
}

/**
 * Parse a VDF text into a `VdfObject`. If the document is wrapped in an outer
 * key-then-object pair (e.g. `"AppWorkshop" { ... }`), the outer wrapper is
 * unwrapped and the inner object returned.
 */
export function parseVdf(text: string): VdfObject {
  const tokens = tokenize(text);
  let pos = 0;

  function parseObject(): VdfObject {
    const obj: VdfObject = new Map();
    while (pos < tokens.length) {
      const tok = tokens[pos];
      if (!tok) break;
      if (tok.kind === 'close') {
        pos++;
        return obj;
      }
      if (tok.kind !== 'str') {
        throw new AxeError('acf_parse', `expected key, got ${tok.kind}`);
      }
      const key = tok.value;
      pos++;
      const next = tokens[pos];
      if (next?.kind === 'str') {
        obj.set(key, next.value);
        pos++;
      } else if (next?.kind === 'open') {
        pos++;
        obj.set(key, parseObject());
      } else {
        throw new AxeError('acf_parse', `expected value or '{' after key '${key}'`);
      }
    }
    return obj;
  }

  // outer wrapper: "Key" { ... } at top
  if (tokens[0]?.kind === 'str' && tokens[1]?.kind === 'open') {
    pos = 2;
    return parseObject();
  }
  return parseObject();
}
