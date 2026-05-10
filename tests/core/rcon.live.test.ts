import { describe, expect, test } from 'bun:test';
import { connectRcon } from '../../src/core/rcon.ts';

const LIVE = process.env.AXE_LIVE_RCON_TESTS === '1';

describe.skipIf(!LIVE)('rcon live (AXE_LIVE_RCON_TESTS=1)', () => {
  test('connects to a real Conan RCON via env credentials and runs `version`', async () => {
    const host = process.env.AXE_LIVE_RCON_HOST;
    const portStr = process.env.AXE_LIVE_RCON_PORT;
    const password = process.env.AXE_LIVE_RCON_PASSWORD;
    if (!host || !portStr || !password) {
      throw new Error(
        'AXE_LIVE_RCON_TESTS=1 set but AXE_LIVE_RCON_{HOST,PORT,PASSWORD} not all defined',
      );
    }
    const port = Number.parseInt(portStr, 10);
    const conn = await connectRcon({ host, port, password });
    try {
      const response = await conn.exec('version');
      expect(response.length).toBeGreaterThan(0);
    } finally {
      conn.close();
    }
  });
});
