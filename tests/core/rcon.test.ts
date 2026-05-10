import { afterEach, describe, expect, test } from 'bun:test';
import { Buffer } from 'node:buffer';
import { AxeError } from '../../src/core/errors.ts';
import { connectRcon, decodePackets, encodePacket } from '../../src/core/rcon.ts';

const STARTED_SERVERS: { stop: () => void }[] = [];

afterEach(() => {
  while (STARTED_SERVERS.length > 0) {
    const server = STARTED_SERVERS.pop();
    server?.stop();
  }
});

/**
 * Spin up an in-process Source RCON server on an ephemeral port.
 * `handleAuth` returns true to accept; false to reject (auth fail).
 * `handleExec` is called with the command body and returns the response
 * body (or an array of body chunks for multi-packet testing).
 */
async function startFakeRcon(handlers: {
  handleAuth: (password: string) => boolean;
  handleExec: (command: string) => string | string[];
}): Promise<{ port: number; stop: () => void }> {
  let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);

  const server = Bun.listen({
    hostname: '127.0.0.1',
    port: 0,
    socket: {
      data(socket, data) {
        buffer = Buffer.concat([buffer, Buffer.from(data)]);
        const decoded = decodePackets(buffer);
        buffer = decoded.rest;
        for (const packet of decoded.packets) {
          if (packet.type === 3) {
            // AUTH
            const ok = handlers.handleAuth(packet.body);
            // Source RCON: server first sends an empty SERVERDATA_RESPONSE_VALUE
            // packet, then the AUTH_RESPONSE. Some servers skip the empty packet.
            socket.write(encodePacket({ id: packet.id, type: 0, body: '' }));
            socket.write(encodePacket({ id: ok ? packet.id : -1, type: 2, body: '' }));
          } else if (packet.type === 2) {
            // EXECCOMMAND
            const result = handlers.handleExec(packet.body);
            const chunks = Array.isArray(result) ? result : [result];
            for (const chunk of chunks) {
              socket.write(encodePacket({ id: packet.id, type: 0, body: chunk }));
            }
          } else if (packet.type === 0) {
            // sentinel — echo back so the client knows the response is complete
            socket.write(encodePacket({ id: packet.id, type: 0, body: '' }));
          }
        }
      },
    },
  });

  const stop = () => server.stop(true);
  const handle = { port: server.port, stop };
  STARTED_SERVERS.push(handle);
  return handle;
}

describe('encodePacket / decodePackets', () => {
  test('round-trips a single packet (id, type, body)', () => {
    const packet = { id: 42, type: 2, body: 'status' };
    const buf = encodePacket(packet);
    // size field = 10 + body.length
    expect(buf.readInt32LE(0)).toBe(10 + 'status'.length);
    expect(buf.readInt32LE(4)).toBe(42);
    expect(buf.readInt32LE(8)).toBe(2);
    const decoded = decodePackets(buf);
    expect(decoded.packets).toEqual([packet]);
    expect(decoded.rest.length).toBe(0);
  });

  test('decodes two concatenated packets in one buffer', () => {
    const a = encodePacket({ id: 1, type: 0, body: 'first' });
    const b = encodePacket({ id: 2, type: 0, body: 'second chunk' });
    const both = Buffer.concat([a, b]);
    const decoded = decodePackets(both);
    expect(decoded.packets.length).toBe(2);
    expect(decoded.packets[0]?.body).toBe('first');
    expect(decoded.packets[1]?.body).toBe('second chunk');
  });

  test('returns rest when the buffer ends mid-packet', () => {
    const packet = encodePacket({ id: 1, type: 0, body: 'partial' });
    const truncated = packet.subarray(0, packet.length - 3);
    const decoded = decodePackets(truncated);
    expect(decoded.packets.length).toBe(0);
    expect(decoded.rest.length).toBe(truncated.length);
  });
});

describe('connectRcon', () => {
  test('auth happy path + exec round-trip', async () => {
    const { port } = await startFakeRcon({
      handleAuth: (p) => p === 'secret',
      handleExec: (cmd) => `echo: ${cmd}`,
    });
    const conn = await connectRcon({ host: '127.0.0.1', port, password: 'secret' });
    try {
      const response = await conn.exec('version');
      expect(response).toBe('echo: version');
    } finally {
      conn.close();
    }
  });

  test('auth failure throws AxeError(rcon)', async () => {
    const { port } = await startFakeRcon({
      handleAuth: () => false,
      handleExec: () => '',
    });
    await expect(
      connectRcon({ host: '127.0.0.1', port, password: 'wrong' }),
    ).rejects.toBeInstanceOf(AxeError);
  });

  test('multi-packet response is stitched in order', async () => {
    const chunks = ['line one\n', 'line two\n', 'line three\n'];
    const { port } = await startFakeRcon({
      handleAuth: () => true,
      handleExec: () => chunks,
    });
    const conn = await connectRcon({ host: '127.0.0.1', port, password: 'x' });
    try {
      const response = await conn.exec('listplayers');
      expect(response).toBe(chunks.join(''));
    } finally {
      conn.close();
    }
  });
});
