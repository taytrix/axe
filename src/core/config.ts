import { readFile } from 'node:fs/promises';
import * as toml from 'smol-toml';
import { z } from 'zod';
import { AxeError } from './errors.ts';
import { atomicWrite } from './io.ts';

export const SCHEMA = 1;

const ServerSchema = z.object({
  id: z.string().min(1),
  root: z.string().min(1),
  launch_args: z.array(z.string()).default(['ConanSandbox', '-log']),
});

const NetworkSchema = z
  .object({
    game_port: z.number().int().default(7777),
    steam_port: z.number().int().default(7778),
    rcon_port: z.number().int().default(25575),
  })
  .default({ game_port: 7777, steam_port: 7778, rcon_port: 25575 });

const UpdateSchema = z
  .object({
    poll_interval: z.string().default('5m'),
    branch: z.string().default('public'),
  })
  .default({ poll_interval: '5m', branch: 'public' });

/**
 * mods.ids accepts both `bigint` (smol-toml output for >2^53) and `number`
 * (smol-toml output for safe integers) and normalizes to `bigint`. Workshop
 * IDs are 10-digit safe-integer numbers; reserve bigint headroom for the
 * future without forcing operators to type a `n` suffix.
 */
const ModIdSchema = z.union([z.bigint(), z.number().int()]).transform((v) => BigInt(v));

const ModsSchema = z
  .object({
    ids: z.array(ModIdSchema).default([]),
    restart_on_change: z.boolean().default(true),
  })
  .default({ ids: [], restart_on_change: true });

export const ConfigSchema = z.object({
  schema: z.literal(SCHEMA),
  server: ServerSchema,
  network: NetworkSchema,
  update: UpdateSchema,
  mods: ModsSchema,
});

export type Config = z.infer<typeof ConfigSchema>;

/** Build a minimal `Config` from a probed install root. */
export function configFromRoot(id: string, root: string): Config {
  return ConfigSchema.parse({
    schema: SCHEMA,
    server: { id, root },
  });
}

/** Parse a TOML string into a `Config`. */
export function parseConfig(text: string): Config {
  let raw: unknown;
  try {
    // `asNeeded` keeps small integers (e.g. ports, 10-digit workshop IDs) as
    // `number` while promoting >2^53 values (manifest IDs) to `bigint`. Without
    // this, smol-toml errors out on any integer literal that exceeds JS safe-int.
    raw = toml.parse(text, { integersAsBigInt: 'asNeeded' });
  } catch (e) {
    throw new AxeError('config', `parsing axe.toml: ${(e as Error).message}`);
  }

  // Pre-flight schema check so we get a friendlier message than zod's literal mismatch.
  if (typeof raw === 'object' && raw !== null && 'schema' in raw) {
    const s = (raw as { schema: unknown }).schema;
    if (typeof s === 'number' && s !== SCHEMA) {
      throw new AxeError('config', `axe.toml schema = ${s} but axe expects ${SCHEMA}`);
    }
  }

  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new AxeError('config', `parsing axe.toml: ${formatZodError(result.error)}`);
  }
  return result.data;
}

/** Read and parse `axe.toml`. */
export async function loadConfig(path: string): Promise<Config> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (e) {
    throw new AxeError('config', `reading ${path}: ${(e as Error).message}`);
  }
  return parseConfig(text);
}

/** Serialize a `Config` to a TOML string. */
export function serializeConfig(cfg: Config): string {
  // smol-toml stringifies bigints as TOML integers (no `n` suffix).
  // The Config object is already a plain JS object after zod parsing.
  try {
    return toml.stringify(cfg as unknown as toml.TomlPrimitive);
  } catch (e) {
    throw new AxeError('config', `serializing axe.toml: ${(e as Error).message}`);
  }
}

/** Atomically write a `Config` to `path`. */
export async function saveConfig(cfg: Config, path: string): Promise<void> {
  const body = serializeConfig(cfg);
  await atomicWrite(path, body);
}

function formatZodError(err: z.ZodError): string {
  return err.issues
    .map((i) => `${i.path.length > 0 ? i.path.join('.') : '<root>'}: ${i.message}`)
    .join('; ');
}
