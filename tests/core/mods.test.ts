import { describe, expect, test } from 'bun:test';
import type { AcfFile, ModManifest } from '../../src/core/acf.ts';
import { checkModFreshness } from '../../src/core/mods.ts';
import type { WorkshopItem } from '../../src/core/workshop.ts';

function fixtureMod(overrides: Partial<ModManifest> & { workshop_id: bigint }): ModManifest {
  return {
    workshop_id: overrides.workshop_id,
    manifest: overrides.manifest ?? 100n,
    time_updated: overrides.time_updated ?? 1000,
    latest_manifest: overrides.latest_manifest ?? 100n,
    latest_time_updated: overrides.latest_time_updated ?? 1000,
  };
}

function fixtureRemote(
  overrides: Partial<WorkshopItem> & { published_file_id: bigint },
): WorkshopItem {
  return {
    published_file_id: overrides.published_file_id,
    title: overrides.title ?? 'Test Mod',
    time_updated: overrides.time_updated ?? 1000,
    visibility: overrides.visibility ?? 0,
    result: overrides.result ?? 1,
  };
}

describe('checkModFreshness', () => {
  test('classifies current / stale / missing_local correctly', () => {
    const local: AcfFile = {
      mods: new Map([
        [11n, fixtureMod({ workshop_id: 11n, time_updated: 2000 })],
        [22n, fixtureMod({ workshop_id: 22n, time_updated: 1000 })],
      ]),
    };
    const remote = [
      fixtureRemote({ published_file_id: 11n, time_updated: 2000 }), // matches -> current
      fixtureRemote({ published_file_id: 22n, time_updated: 3000 }), // upstream newer -> stale
      fixtureRemote({ published_file_id: 33n, time_updated: 1000 }), // not in ACF -> missing_local
    ];
    const report = checkModFreshness([11n, 22n, 33n], local, remote);
    expect(report.total).toBe(3);
    expect(report.current).toBe(1);
    expect(report.stale).toBe(1);
    expect(report.missing_local).toBe(1);
    expect(report.unmanaged).toBe(0);
  });

  test('detects unmanaged ACF entries', () => {
    const local: AcfFile = {
      mods: new Map([
        [11n, fixtureMod({ workshop_id: 11n })],
        [99n, fixtureMod({ workshop_id: 99n })],
      ]),
    };
    const remote = [fixtureRemote({ published_file_id: 11n })];
    const report = checkModFreshness([11n], local, remote);
    expect(report.unmanaged).toBe(1);
    expect(report.items.find((i) => i.id === 99n)?.state).toBe('unmanaged');
  });

  test('empty declared yields all-unmanaged report', () => {
    const local: AcfFile = {
      mods: new Map([[11n, fixtureMod({ workshop_id: 11n })]]),
    };
    const report = checkModFreshness([], local, []);
    expect(report.total).toBe(0);
    expect(report.unmanaged).toBe(1);
  });
});
