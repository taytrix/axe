import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { getPublishedFileDetails } from '../../src/core/workshop.ts';

// Gated: only runs when AXE_LIVE_TESTS=1. Hits the real Steam API.
describe.skipIf(!process.env.AXE_LIVE_TESTS)('workshop API (live)', () => {
  test('fetches the four fixture mods and confirms result=1, titles non-empty', async () => {
    const text = readFileSync(join(process.cwd(), 'tests/fixtures/live-test-mods.toml'), 'utf8');
    const parsed = parseToml(text) as { ids: (number | bigint)[] };
    const ids = parsed.ids.map((v) => BigInt(v));
    const items = await getPublishedFileDetails(ids);
    expect(items.length).toBe(ids.length);
    for (const item of items) {
      expect(item.result).toBe(1);
      expect(item.title.length).toBeGreaterThan(0);
    }
  });
});
