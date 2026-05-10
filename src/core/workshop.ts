import { z } from 'zod';
import type { WorkshopId } from './acf.ts';
import { AxeError } from './errors.ts';

const URL = 'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/';
const TIMEOUT_MS = 15_000;

const ItemRawSchema = z
  .object({
    publishedfileid: z.string(),
    title: z.string(),
    time_updated: z.number().int(),
    visibility: z.number().int(),
    result: z.number().int(),
  })
  .passthrough();

const ResponseSchema = z.object({
  response: z.object({
    publishedfiledetails: z.array(ItemRawSchema),
  }),
});

export type WorkshopItem = {
  published_file_id: WorkshopId;
  title: string;
  time_updated: number;
  visibility: number;
  result: number; // 1 = published; non-1 = errored / deleted
};

/** Function shape compatible with global `fetch`; loose on purpose so tests can supply minimal fakes. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type GetDetailsOptions = {
  signal?: AbortSignal;
  fetchImpl?: FetchLike; // injection point for tests; not part of public contract
};

/**
 * Query the Workshop API for the given list of published file IDs.
 *
 * No API key required (public endpoint). 15s timeout. Returns typed items
 * with bigint IDs; throws AxeError(workshop_api) on HTTP / JSON / shape
 * failures.
 */
export async function getPublishedFileDetails(
  ids: readonly WorkshopId[],
  options: GetDetailsOptions = {},
): Promise<WorkshopItem[]> {
  if (ids.length === 0) return [];

  const body = new URLSearchParams();
  body.set('itemcount', String(ids.length));
  for (let i = 0; i < ids.length; i++) {
    body.set(`publishedfileids[${i}]`, (ids[i] as bigint).toString());
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  if (options.signal) {
    options.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  const fetcher = options.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await fetcher(URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal,
    });
  } catch (e) {
    throw new AxeError('workshop_api', `HTTP request: ${errorMessage(e)}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new AxeError('workshop_api', `HTTP ${response.status} ${response.statusText}`);
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch (e) {
    throw new AxeError('workshop_api', `parsing JSON: ${errorMessage(e)}`);
  }

  const parsed = ResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AxeError('workshop_api', `unexpected response shape: ${parsed.error.message}`);
  }

  return parsed.data.response.publishedfiledetails.map((item) => ({
    published_file_id: BigInt(item.publishedfileid),
    title: item.title,
    time_updated: item.time_updated,
    visibility: item.visibility,
    result: item.result,
  }));
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
