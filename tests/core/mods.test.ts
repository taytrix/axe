import { describe, expect, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AcfFile, ModManifest } from '../../src/core/acf.ts';
import { AxeError } from '../../src/core/errors.ts';
import type { Layout } from '../../src/core/layout.ts';
import { checkModFreshness, hasDrift, runModsCheck } from '../../src/core/mods.ts';
import type { FetchLike, WorkshopItem } from '../../src/core/workshop.ts';

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

const ACF_FIXTURE = `"AppWorkshop"
{
  "appid"  "440900"
  "WorkshopItemsInstalled"
  {
    "11"
    {
      "manifest"  "1000"
      "timeupdated"  "2000"
    }
  }
  "WorkshopItemDetails"
  {
    "11"
    {
      "manifest"  "1000"
      "timeupdated"  "2000"
      "latest_manifest"  "1000"
      "latest_timeupdated"  "2000"
    }
  }
}
`;

async function freshLayout(): Promise<Layout> {
  const root = join(tmpdir(), `axe-runmods-${Date.now()}-${Math.random()}`);
  await mkdir(root, { recursive: true });
  return {
    platform: 'linux',
    root,
    binary: join(root, 'bin'),
    config_dir: join(root, 'cfg'),
    server_settings_ini: join(root, 'cfg/ServerSettings.ini'),
    engine_ini: join(root, 'cfg/Engine.ini'),
    game_ini: join(root, 'cfg/Game.ini'),
    mods_dir: join(root, 'Mods'),
    modlist_txt: join(root, 'Mods/modlist.txt'),
    workshop_content: join(root, 'workshop/content'),
    workshop_acf: join(root, 'workshop/appworkshop_440900.acf'),
    game_db: join(root, 'game.db'),
    logs_dir: join(root, 'logs'),
  };
}

function fakeFetchOk(items: WorkshopItem[]): FetchLike {
  return async () => {
    const body = {
      response: {
        publishedfiledetails: items.map((it) => ({
          publishedfileid: it.published_file_id.toString(),
          title: it.title,
          time_updated: it.time_updated,
          visibility: it.visibility,
          result: it.result,
        })),
      },
    };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
}

describe('runModsCheck', () => {
  test('happy path: fake fetch returns success -> all current, no warnings', async () => {
    const layout = await freshLayout();
    await mkdir(join(layout.workshop_acf, '..'), { recursive: true });
    await writeFile(layout.workshop_acf, ACF_FIXTURE);
    const fetchImpl = fakeFetchOk([
      {
        published_file_id: 11n,
        title: 'Mod 11',
        time_updated: 2000,
        visibility: 0,
        result: 1,
      },
    ]);
    const { report, warnings } = await runModsCheck(layout, [11n], { fetchImpl });
    expect(report.current).toBe(1);
    expect(report.stale).toBe(0);
    expect(warnings).toEqual([]);
    expect(report.items[0]?.title).toBe('Mod 11');
  });

  test('workshop API failure -> warning populated; falls back to ACF latest_*', async () => {
    const layout = await freshLayout();
    await mkdir(join(layout.workshop_acf, '..'), { recursive: true });
    await writeFile(layout.workshop_acf, ACF_FIXTURE);
    const fetchImpl: FetchLike = async () => {
      throw new AxeError('workshop_api', 'HTTP 503');
    };
    const { report, warnings } = await runModsCheck(layout, [11n], { fetchImpl });
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('workshop API unreachable');
    expect(report.current).toBe(1);
    expect(report.items[0]?.title).toBeNull();
  });

  test('missing ACF (ENOENT) -> empty local; declared all classified missing_local', async () => {
    const layout = await freshLayout();
    // do NOT write the ACF
    const fetchImpl = fakeFetchOk([
      {
        published_file_id: 11n,
        title: 'Mod 11',
        time_updated: 2000,
        visibility: 0,
        result: 1,
      },
    ]);
    const { report, warnings } = await runModsCheck(layout, [11n], { fetchImpl });
    expect(warnings).toEqual([]);
    expect(report.missing_local).toBe(1);
    expect(report.current).toBe(0);
    expect(report.items[0]?.state).toBe('missing_local');
  });
});

describe('hasDrift', () => {
  function emptyReport() {
    return {
      total: 0,
      current: 0,
      stale: 0,
      missing_local: 0,
      missing_remote: 0,
      unmanaged: 0,
      items: [],
    };
  }

  test('false when all current', () => {
    expect(hasDrift({ ...emptyReport(), current: 4, total: 4 })).toBe(false);
  });

  test('true when stale > 0', () => {
    expect(hasDrift({ ...emptyReport(), stale: 1 })).toBe(true);
  });

  test('true when missing_local > 0', () => {
    expect(hasDrift({ ...emptyReport(), missing_local: 1 })).toBe(true);
  });

  test('true when missing_remote > 0', () => {
    expect(hasDrift({ ...emptyReport(), missing_remote: 1 })).toBe(true);
  });

  test('false when only unmanaged > 0', () => {
    expect(hasDrift({ ...emptyReport(), unmanaged: 5 })).toBe(false);
  });
});
