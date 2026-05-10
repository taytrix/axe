import { Buffer } from 'node:buffer';
import { AxeError } from './errors.ts';

/**
 * Hand-rolled Source RCON client.
 *
 * Protocol: every packet is a 4-byte little-endian size, then size bytes of
 * (id i32, type i32, body, two null bytes). For client requests:
 *   type 3 = AUTH (body = password)
 *   type 2 = EXECCOMMAND (body = command)
 *   type 0 = RESPONSE_VALUE (used as multi-packet sentinel)
 * For server responses:
 *   type 2 = AUTH_RESPONSE (id = request id, or -1 on auth failure)
 *   type 0 = RESPONSE_VALUE (one or more chunks per command)
 *
 * Multi-packet trick: after EXECCOMMAND, send a RESPONSE_VALUE with a
 * fresh id. The server returns all real chunks for the command id, then
 * an "Unknown request" reply for the sentinel id. When we see a packet
 * with the sentinel id, we know the command response is complete.
 *
 * Hand-rolled because every npm option as of 2026-05-10 was stale, dead,
 * or shallow. ~150 lines is smaller than any candidate's surface.
 */

export type RconOptions = {
  host: string;
  port: number;
  password: string;
  /** Connect + auth deadline. Default 5_000ms. */
  timeoutMs?: number;
};

export type RconConnection = {
  exec(command: string): Promise<string>;
  close(): void;
};

const PACKET_TYPE_AUTH = 3;
const PACKET_TYPE_AUTH_RESPONSE = 2;
const PACKET_TYPE_EXECCOMMAND = 2;
const PACKET_TYPE_RESPONSE_VALUE = 0;
const DEFAULT_TIMEOUT_MS = 5000;

type Packet = { id: number; type: number; body: string };

/**
 * Wire layout: [size:i32 LE][id:i32 LE][type:i32 LE][body utf8][\0][\0].
 * `size` is the byte count of everything after the size field itself, i.e.
 * 10 + body.length. Total bytes on the wire = 4 + size = 14 + body.length.
 */
export function encodePacket(packet: Packet): Buffer {
  const body = Buffer.from(packet.body, 'utf8');
  const size = 10 + body.length;
  const out = Buffer.alloc(4 + size);
  out.writeInt32LE(size, 0);
  out.writeInt32LE(packet.id, 4);
  out.writeInt32LE(packet.type, 8);
  body.copy(out, 12);
  out.writeUInt8(0, 12 + body.length);
  out.writeUInt8(0, 12 + body.length + 1);
  return out;
}

export function decodePackets(buffer: Buffer): { packets: Packet[]; rest: Buffer } {
  const packets: Packet[] = [];
  let i = 0;
  while (i + 4 <= buffer.length) {
    const size = buffer.readInt32LE(i);
    if (size < 10) {
      throw new AxeError('rcon', `invalid packet size ${size}`);
    }
    if (i + 4 + size > buffer.length) break; // incomplete; wait for more
    const id = buffer.readInt32LE(i + 4);
    const type = buffer.readInt32LE(i + 8);
    // body runs from i+12 to i+4+size-2 (last two bytes are null terminators)
    const body = buffer.toString('utf8', i + 12, i + 4 + size - 2);
    packets.push({ id, type, body });
    i += 4 + size;
  }
  return { packets, rest: buffer.subarray(i) };
}

type PendingExec = {
  commandId: number;
  sentinelId: number;
  accumulated: string;
  resolve: (value: string) => void;
  reject: (reason: unknown) => void;
};

type PendingAuth = {
  id: number;
  resolve: () => void;
  reject: (reason: unknown) => void;
};

/**
 * Connect to a Source RCON server and authenticate. Returns a connection
 * that serializes `exec` calls (one round-trip in flight at a time).
 *
 * Throws `AxeError('rcon')` on:
 *   - connect failure (refused, timeout)
 *   - auth failure (server returned id = -1)
 *   - protocol violation (unexpected packet type / id)
 *   - timeout while awaiting a response
 */
export async function connectRcon(options: RconOptions): Promise<RconConnection> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let nextRequestId = 1;
  let pendingAuth: PendingAuth | null = null;
  let pendingExec: PendingExec | null = null;
  let closed = false;

  let socket: Awaited<ReturnType<typeof Bun.connect>>;
  try {
    socket = await withTimeout(
      Bun.connect({
        hostname: options.host,
        port: options.port,
        socket: socketHandlers(),
      }),
      timeoutMs,
      'connect',
    );
  } catch (e) {
    if (e instanceof AxeError) throw e;
    throw new AxeError('rcon', `connect ${options.host}:${options.port}: ${(e as Error).message}`);
  }

  function socketHandlers(): Parameters<typeof Bun.connect>[0]['socket'] {
    return {
      data(_socket, data) {
        buffer = Buffer.concat([buffer, Buffer.from(data)]);
        let decoded: { packets: Packet[]; rest: Buffer };
        try {
          decoded = decodePackets(buffer);
        } catch (e) {
          // protocol violation; reject any in-flight request and tear down
          const err = e instanceof AxeError ? e : new AxeError('rcon', String(e));
          if (pendingAuth) pendingAuth.reject(err);
          if (pendingExec) pendingExec.reject(err);
          pendingAuth = null;
          pendingExec = null;
          closed = true;
          return;
        }
        buffer = decoded.rest;
        for (const packet of decoded.packets) handlePacket(packet);
      },
      error(_socket, err) {
        const wrapped = new AxeError('rcon', `socket error: ${err.message}`);
        if (pendingAuth) pendingAuth.reject(wrapped);
        if (pendingExec) pendingExec.reject(wrapped);
        pendingAuth = null;
        pendingExec = null;
        closed = true;
      },
      close(_socket) {
        closed = true;
        if (pendingAuth) pendingAuth.reject(new AxeError('rcon', 'connection closed during auth'));
        if (pendingExec) pendingExec.reject(new AxeError('rcon', 'connection closed during exec'));
        pendingAuth = null;
        pendingExec = null;
      },
    };
  }

  function handlePacket(packet: Packet): void {
    if (pendingAuth && packet.type === PACKET_TYPE_AUTH_RESPONSE) {
      const auth = pendingAuth;
      pendingAuth = null;
      if (packet.id === -1) {
        auth.reject(new AxeError('rcon', 'authentication failed (wrong password?)'));
        return;
      }
      if (packet.id !== auth.id) {
        auth.reject(
          new AxeError('rcon', `auth response id mismatch (got ${packet.id}, want ${auth.id})`),
        );
        return;
      }
      auth.resolve();
      return;
    }
    if (pendingExec) {
      if (packet.id === pendingExec.sentinelId) {
        const exec = pendingExec;
        pendingExec = null;
        exec.resolve(exec.accumulated);
        return;
      }
      if (packet.id === pendingExec.commandId) {
        pendingExec.accumulated += packet.body;
        return;
      }
    }
    // unmatched packet — ignore (some servers emit warnings)
  }

  // Auth handshake
  await withTimeout(
    new Promise<void>((resolve, reject) => {
      const id = nextRequestId++;
      pendingAuth = { id, resolve, reject };
      socket.write(encodePacket({ id, type: PACKET_TYPE_AUTH, body: options.password }));
    }),
    timeoutMs,
    'auth',
  );

  return {
    async exec(command: string): Promise<string> {
      if (closed) throw new AxeError('rcon', 'connection is closed');
      if (pendingExec) {
        throw new AxeError('rcon', 'another exec is already in flight on this connection');
      }
      const commandId = nextRequestId++;
      const sentinelId = nextRequestId++;
      return withTimeout(
        new Promise<string>((resolve, reject) => {
          pendingExec = { commandId, sentinelId, accumulated: '', resolve, reject };
          socket.write(
            encodePacket({ id: commandId, type: PACKET_TYPE_EXECCOMMAND, body: command }),
          );
          socket.write(
            encodePacket({ id: sentinelId, type: PACKET_TYPE_RESPONSE_VALUE, body: '' }),
          );
        }),
        timeoutMs,
        'exec',
      );
    },
    close(): void {
      if (!closed) {
        closed = true;
        socket.end();
      }
    },
  };
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new AxeError('rcon', `${label} timed out after ${ms}ms`));
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
