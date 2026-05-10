import { afterEach, describe, expect, test } from 'bun:test';
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readServerSettings } from '../../src/core/ini.ts';
import { layoutAt } from '../../src/core/layout.ts';

const FIXTURE = join(process.cwd(), 'tests/fixtures/sample-server-settings.ini');
const TMP_DIRS: string[] = [];

afterEach(async () => {
  while (TMP_DIRS.length > 0) {
    const dir = TMP_DIRS.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

async function freshLayout(): Promise<{ root: string; layout: ReturnType<typeof layoutAt> }> {
  const root = join(tmpdir(), `axe-ini-${Date.now()}-${Math.random()}`);
  await mkdir(root, { recursive: true });
  TMP_DIRS.push(root);
  const layout = layoutAt(root, 'linux');
  await mkdir(layout.config_dir, { recursive: true });
  return { root, layout };
}

describe('readServerSettings', () => {
  test('extracts the four RCON keys from the fixture', async () => {
    const { layout } = await freshLayout();
    await copyFile(FIXTURE, layout.server_settings_ini);

    const { settings, warnings } = await readServerSettings(layout);
    expect(warnings).toEqual([]);
    expect(settings.rcon_enabled).toBe(true);
    expect(settings.rcon_port).toBe(25575);
    expect(settings.rcon_password).toBe('secretpassword');
    expect(settings.rcon_max_karma).toBe(60);
  });

  test('returns nulls + warning when ServerSettings.ini is missing', async () => {
    const { layout } = await freshLayout();
    // do NOT write the file
    const { settings, warnings } = await readServerSettings(layout);
    expect(settings.rcon_enabled).toBeNull();
    expect(settings.rcon_port).toBeNull();
    expect(settings.rcon_password).toBeNull();
    expect(settings.rcon_max_karma).toBeNull();
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('not found');
  });

  test('reflects RconEnabled=False in the returned shape', async () => {
    const { layout } = await freshLayout();
    await writeFile(
      layout.server_settings_ini,
      `[ServerSettings]
RconEnabled=False
RconPort=25575
RconPassword=
`,
    );
    const { settings } = await readServerSettings(layout);
    expect(settings.rcon_enabled).toBe(false);
    expect(settings.rcon_port).toBe(25575);
    expect(settings.rcon_password).toBeNull();
  });
});
