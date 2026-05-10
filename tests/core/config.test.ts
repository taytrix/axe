import { describe, expect, test } from 'bun:test';
import { configFromRoot, parseConfig, serializeConfig } from '../../src/core/config.ts';
import { AxeError } from '../../src/core/errors.ts';

const MINIMAL = `
schema = 1
[server]
id = "test"
root = "/srv/conan"
`;

describe('parseConfig', () => {
  test('parses minimal valid toml', () => {
    const cfg = parseConfig(MINIMAL);
    expect(cfg.server.id).toBe('test');
    expect(cfg.server.root).toBe('/srv/conan');
    expect(cfg.network.game_port).toBe(7777);
    expect(cfg.update.poll_interval).toBe('5m');
    expect(cfg.mods.ids).toEqual([]);
    expect(cfg.mods.restart_on_change).toBe(true);
  });

  test('rejects unknown schema', () => {
    const text = `
schema = 99
[server]
id = "x"
root = "/tmp"
`;
    expect(() => parseConfig(text)).toThrow(AxeError);
  });

  test('parses mods.ids as bigints', () => {
    const text = `
schema = 1
[server]
id = "x"
root = "/tmp"
[mods]
ids = [11, 22, 3721090132]
`;
    const cfg = parseConfig(text);
    expect(cfg.mods.ids).toEqual([11n, 22n, 3_721_090_132n]);
  });

  test('parsing invalid TOML throws AxeError(config)', () => {
    expect(() => parseConfig('not [valid toml = =')).toThrow(AxeError);
  });
});

describe('configFromRoot + serializeConfig', () => {
  test('round-trips through serialize -> parse', () => {
    const original = configFromRoot('test-server', '/var/lib/conan');
    const text = serializeConfig(original);
    const parsed = parseConfig(text);
    expect(parsed.server.id).toBe('test-server');
    expect(parsed.server.root).toBe('/var/lib/conan');
    expect(parsed.network.game_port).toBe(7777);
    expect(parsed.update.poll_interval).toBe('5m');
    expect(parsed.mods.ids).toEqual([]);
  });

  test('serializes mods.ids as TOML integers', () => {
    const cfg = configFromRoot('x', '/tmp');
    cfg.mods.ids = [11n, 22n, 3_721_090_132n];
    const text = serializeConfig(cfg);
    const parsed = parseConfig(text);
    expect(parsed.mods.ids).toEqual([11n, 22n, 3_721_090_132n]);
  });

  test('round-trips a 19-digit (manifest-sized) bigint without precision loss', () => {
    const cfg = configFromRoot('x', '/tmp');
    const manifestSized = 3_915_417_666_713_453_363n; // > 2^53
    cfg.mods.ids = [manifestSized];
    const text = serializeConfig(cfg);
    const parsed = parseConfig(text);
    expect(parsed.mods.ids).toEqual([manifestSized]);
    expect(parsed.mods.ids[0]).toBe(manifestSized);
  });
});
