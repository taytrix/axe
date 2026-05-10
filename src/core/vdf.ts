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

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
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
    if (c === '"') {
      i++;
      let s = '';
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < text.length) {
          const next = text[i + 1] ?? '';
          s +=
            next === 'n'
              ? '\n'
              : next === 't'
                ? '\t'
                : next === '"'
                  ? '"'
                  : next === '\\'
                    ? '\\'
                    : next;
          i += 2;
        } else {
          s += text[i];
          i++;
        }
      }
      if (i >= text.length) {
        throw new AxeError('acf_parse', 'unterminated quoted string');
      }
      i++; // closing quote
      tokens.push({ kind: 'str', value: s });
      continue;
    }
    // unquoted string: read until whitespace or structural char
    let s = '';
    while (i < text.length) {
      const ch = text[i] ?? '';
      if (
        ch === ' ' ||
        ch === '\t' ||
        ch === '\n' ||
        ch === '\r' ||
        ch === '{' ||
        ch === '}' ||
        ch === '"'
      ) {
        break;
      }
      s += ch;
      i++;
    }
    tokens.push({ kind: 'str', value: s });
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
