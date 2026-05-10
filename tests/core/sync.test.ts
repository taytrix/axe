import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as posix from 'node:path/posix';
import { type Layout, layoutAt } from '../../src/core/layout.ts';
import { syncModlist } from '../../src/core/sync.ts';
import type { FetchLike, WorkshopItem } from '../../src/core/workshop.ts';

const STUB = join(process.cwd(), 'tests/fixtures/steamcmd-stub.sh');
const TMP_DIRS: string[] = [];

afterEach(async () => {
  while (TMP_DIRS.length > 0) {
    const dir = TMP_DIRS.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

async function freshRoot(): Promise<{ root: string; layout: Layout }> {
  const root = join(tmpdir(), `axe-sync-${Date.now()}-${Math.random()}`);
  await mkdir(root, { recursive: true });
  TMP_DIRS.push(root);
  const layout = layoutAt(root, 'linux');
  return { root, layout };
}

function fakeFetchEmpty(): FetchLike {
  return async () =>
    new Response(JSON.stringify({ response: { publishedfiledetails: [] } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
}

function fakeFetchOk(items: WorkshopItem[]): FetchLike {
  return async () =>
    new Response(
      JSON.stringify({
        response: {
          publishedfiledetails: items.map((it) => ({
            publishedfileid: it.published_file_id.toString(),
            title: it.title,
            time_updated: it.time_updated,
            visibility: it.visibility,
            result: it.result,
          })),
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
}

function configFor(root: string, ids: bigint[]) {
  return {
    schema: 1 as const,
    server: { id: 'test', root, launch_args: ['ConanSandbox', '-log'] },
    network: { game_port: 7777, steam_port: 7778, rcon_port: 25575 },
    update: { poll_interval: '5m', branch: 'public', build_check_every: 12 },
    mods: { ids, restart_on_change: true },
    steamcmd: { binary: STUB },
  };
}

describe('syncModlist', () => {
  test('downloads and writes modlist in declared order', async () => {
    const { root, layout } = await freshRoot();
    const config = configFor(root, [11n, 22n, 33n]);

    const outcome = await syncModlist(config, layout, {
      fetchImpl: fakeFetchEmpty(), // empty remote -> all missing_local -> all downloaded
    });

    expect(outcome.downloaded.map(String)).toEqual(['11', '22', '33']);
    expect(outcome.missing).toEqual([]);
    expect(outcome.modlist_changed).toBe(true);

    const modlist = await readFile(layout.modlist_txt, 'utf8');
    const lines = modlist.split('\n').filter(Boolean);
    expect(lines).toEqual([
      posix.join(layout.workshop_content, '11', '11.pak'),
      posix.join(layout.workshop_content, '22', '22.pak'),
      posix.join(layout.workshop_content, '33', '33.pak'),
    ]);
    // final newline preserved
    expect(modlist.endsWith('\n')).toBe(true);
  });

  test('idempotent re-run is zero-write (modlist_changed=false, mtime unchanged)', async () => {
    const { root, layout } = await freshRoot();
    const config = configFor(root, [11n]);

    // First run: downloads + writes
    await syncModlist(config, layout, { fetchImpl: fakeFetchEmpty() });
    const stat1 = await stat(layout.modlist_txt);

    // Second run: API still says nothing (empty), local now has the .pak so
    // freshness check classifies as... actually empty remote means all
    // missing_local still. But the .pak is on disk now. Re-classify.
    //
    // Actually with empty remote, `runModsCheck` returns missing_local for
    // declared ids (because remote doesn't know them). To get a true fast
    // path we need to either populate remote or have current freshness.
    //
    // Use a fake API that returns the mod with matching time (current).
    const remote = fakeFetchOk([
      { published_file_id: 11n, title: 'Mod 11', time_updated: 0, visibility: 0, result: 1 },
    ]);
    // Stage ACF so local has time_updated >= remote
    await mkdir(join(layout.workshop_acf, '..'), { recursive: true });
    await writeFile(
      layout.workshop_acf,
      `"AppWorkshop"
{
  "WorkshopItemsInstalled"
  {
    "11"
    {
      "manifest"  "100"
      "timeupdated"  "1000"
    }
  }
  "WorkshopItemDetails"
  {
    "11"
    {
      "manifest"  "100"
      "timeupdated"  "1000"
      "latest_manifest"  "100"
      "latest_timeupdated"  "1000"
    }
  }
}
`,
    );

    // Sleep 10ms to ensure any write would change mtime
    await new Promise((r) => setTimeout(r, 10));

    const outcome2 = await syncModlist(config, layout, { fetchImpl: remote });
    expect(outcome2.downloaded).toEqual([]);
    expect(outcome2.modlist_changed).toBe(false);

    const stat2 = await stat(layout.modlist_txt);
    expect(stat2.mtimeMs).toBe(stat1.mtimeMs);
  });

  test('missing-id surfaces in `missing[]` when content tree has no .pak', async () => {
    const { root, layout } = await freshRoot();
    const config = configFor(root, [11n, 22n]);

    // Stub creates paks for what we ask. Force a failure mode by making
    // steamcmd write only to id 11 — easiest: pre-create a content dir for
    // 11 and let the stub write 22's pak normally; then forcibly delete 22's
    // pak before the modlist scan happens.
    //
    // Simpler: monkey via injected spawn that ONLY creates pak for 11.
    const partialSpawn = (cmd: readonly string[]) => {
      // Run the stub but post-process by deleting any 22.pak that gets made
      const proc = Bun.spawn([...cmd], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      return {
        stdout: proc.stdout as ReadableStream<Uint8Array>,
        stderr: proc.stderr as ReadableStream<Uint8Array>,
        exited: (async () => {
          const exit = await proc.exited;
          // After stub finishes, remove 22's pak to simulate a failed download
          await rm(join(layout.workshop_content, '22'), { recursive: true, force: true });
          return exit;
        })(),
      };
    };

    const outcome = await syncModlist(config, layout, {
      fetchImpl: fakeFetchEmpty(),
      spawn: partialSpawn,
    });

    expect(outcome.downloaded.map(String)).toEqual(['11']);
    expect(outcome.missing.map(String)).toEqual(['22']);
  });
});
