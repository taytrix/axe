import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAcf } from '../../src/core/acf.ts';

const SAMPLE = readFileSync(join(process.cwd(), 'tests/fixtures/sample-workshop.acf'), 'utf8');

describe('parseAcf', () => {
  test('parses sample fixture (4 mods, all installed == latest)', () => {
    const acf = parseAcf(SAMPLE);
    expect(acf.mods.size).toBe(4);
    for (const m of acf.mods.values()) {
      expect(m.workshop_id).toBeGreaterThan(0n);
      expect(m.manifest).toBeGreaterThan(0n);
      expect(m.time_updated).toBeGreaterThan(0);
      expect(m.latest_manifest).toBeGreaterThan(0n);
      expect(m.latest_time_updated).toBeGreaterThan(0);
      expect(m.manifest).toBe(m.latest_manifest);
      expect(m.time_updated).toBe(m.latest_time_updated);
    }
  });

  test('tolerates missing WorkshopItemDetails (falls back to installed values)', () => {
    const text = `"AppWorkshop"
{
  "WorkshopItemsInstalled"
  {
    "12345"
    {
      "manifest" "999"
      "timeupdated" "100"
    }
  }
}`;
    const acf = parseAcf(text);
    const m = acf.mods.get(12345n);
    expect(m).toBeDefined();
    expect(m?.manifest).toBe(999n);
    expect(m?.latest_manifest).toBe(999n);
    expect(m?.latest_time_updated).toBe(100);
  });

  test('preserves big manifest IDs (>2^53) as bigint without loss', () => {
    const acf = parseAcf(SAMPLE);
    const m = acf.mods.get(3721090132n);
    expect(m).toBeDefined();
    expect(m?.manifest).toBe(3915417666713453363n);
    expect(m?.latest_manifest).toBe(3915417666713453363n);
  });

  test('skips non-numeric IDs and ignores unknown sections', () => {
    const text = `"AppWorkshop"
{
  "appid" "440900"
  "WorkshopItemsInstalled"
  {
    "abc" { "manifest" "1" "timeupdated" "2" }
    "999" { "manifest" "1" "timeupdated" "2" }
  }
  "FutureSectionWeDontKnow"
  {
    "anything" "goes"
  }
}`;
    const acf = parseAcf(text);
    expect(acf.mods.size).toBe(1);
    expect(acf.mods.has(999n)).toBe(true);
  });
});
