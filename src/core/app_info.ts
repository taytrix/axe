import { parseVdf, type VdfObject } from './vdf.ts';

export type AppInfo = {
  build_id: string | null;
};

/**
 * Parse `steamcmd +app_info_print <appid> +quit` output.
 *
 * Steamcmd's output begins with login/loading prompts, then the VDF block
 * `"<appid>" { ... }` containing app metadata, then a trailing prompt. This
 * function locates the VDF block (first occurrence of `"<appid>"` followed
 * by `{` ... matching `}`), parses it, and extracts:
 *
 *   <appid> -> depots -> branches -> public -> buildid
 *
 * Best-effort: returns `{ build_id: null }` on any structural surprise
 * (block not found, parse fail, missing key path). Caller surfaces null via
 * a warning rather than failing the verb.
 */
export function parseAppInfo(text: string, appid: number): AppInfo {
  const block = extractAppBlock(text, appid);
  if (block === null) return { build_id: null };

  let tree: VdfObject;
  try {
    tree = parseVdf(block);
  } catch {
    return { build_id: null };
  }

  const depots = tree.get('depots');
  if (!(depots instanceof Map)) return { build_id: null };
  const branches = depots.get('branches');
  if (!(branches instanceof Map)) return { build_id: null };
  const pub = branches.get('public');
  if (!(pub instanceof Map)) return { build_id: null };
  const buildid = pub.get('buildid');
  return { build_id: typeof buildid === 'string' ? buildid : null };
}

/**
 * Extract `"<appid>" { ... }` from a possibly-noisy steamcmd transcript.
 * Returns the substring including the wrapper key + braces, or `null` if
 * we can't find a balanced block.
 */
function extractAppBlock(text: string, appid: number): string | null {
  const marker = `"${appid}"`;
  const start = text.indexOf(marker);
  if (start === -1) return null;
  const open = text.indexOf('{', start);
  if (open === -1) return null;

  let depth = 1;
  let i = open + 1;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      // skip past quoted string (handle simple `\"` and `\\` escapes)
      i++;
      while (i < text.length) {
        if (text[i] === '\\') {
          i += 2;
        } else if (text[i] === '"') {
          i++;
          break;
        } else {
          i++;
        }
      }
    } else if (c === '{') {
      depth++;
      i++;
    } else if (c === '}') {
      depth--;
      i++;
      if (depth === 0) return text.slice(start, i);
    } else {
      i++;
    }
  }
  return null;
}
