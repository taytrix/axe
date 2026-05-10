import { afterEach, describe, expect, test } from 'bun:test';
import { Buffer } from 'node:buffer';
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodePackets, encodePacket } from '../../src/core/rcon.ts';

const ENTRY = 'src/bin.ts';
const REPO_ROOT = process.cwd();
const TMP_DIRS: string[] = [];
const SERVERS: { stop: () => void }[] = [];

afterEach(async () => {
  while (SERVERS.length > 0) {
    SERVERS.pop()?.stop();
  }
  while (TMP_DIRS.length > 0) {
    const dir = TMP_DIRS.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

async function freshTmp(prefix: string): Promise<string> {
  const dir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random()}`);
  await mkdir(dir, { recursive: true });
  TMP_DIRS.push(dir);
  return dir;
}

async function syntheticInstall(): Promise<{ root: string; configPath: string }> {
  const root = await freshTmp('axe-cli-rcon');
  // Probe is NOT used by rcon (it uses loadConfig + layoutAt directly), but we
  // still need a binary file for layoutAt-based discovery to make sense.
  const binDir = join(root, 'ConanSandbox/Binaries/Linux');
  await mkdir(binDir, { recursive: true });
  const bin = join(binDir, 'ConanSandboxServer-Linux-Shipping');
  await writeFile(bin, '');
  await chmod(bin, 0o755);
  const configPath = join(root, 'axe.toml');
  await writeFile(
    configPath,
    `schema = 1
[server]
id = "test"
root = "${root}"
`,
  );
  return { root, configPath };
}

async function startFakeRcon(password: string): Promise<{ port: number; stop: () => void }> {
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
            const ok = packet.body === password;
            socket.write(encodePacket({ id: packet.id, type: 0, body: '' }));
            socket.write(encodePacket({ id: ok ? packet.id : -1, type: 2, body: '' }));
          } else if (packet.type === 2) {
            socket.write(encodePacket({ id: packet.id, type: 0, body: `axe-rig: ${packet.body}` }));
          } else if (packet.type === 0) {
            socket.write(encodePacket({ id: packet.id, type: 0, body: '' }));
          }
        }
      },
    },
  });
  const handle = { port: server.port, stop: () => server.stop(true) };
  SERVERS.push(handle);
  return handle;
}

type RunResult = { stdout: string; stderr: string; exit: number };

async function runAxe(
  args: string[],
  cwd: string,
  env?: Record<string, string>,
): Promise<RunResult> {
  const proc = Bun.spawn(['bun', join(REPO_ROOT, ENTRY), ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, ...(env ?? {}) },
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exit = await proc.exited;
  return { stdout, stderr, exit };
}

describe('axe rcon exec', () => {
  test('connects to a fake RCON server, runs the command, and prints the response', async () => {
    const { root, configPath } = await syntheticInstall();
    const fake = await startFakeRcon('rigpass');

    const { stdout, exit } = await runAxe(
      [
        '--json',
        '--config',
        configPath,
        'rcon',
        'exec',
        '--rcon-host',
        '127.0.0.1',
        '--rcon-port',
        String(fake.port),
        '--rcon-password',
        'rigpass',
        'version',
      ],
      root,
    );

    expect(exit).toBe(0);
    const env = JSON.parse(stdout);
    expect(env.ok).toBe(true);
    expect(env.command).toBe('rcon exec');
    expect(env.data.command).toBe('version');
    expect(env.data.response).toBe('axe-rig: version');
    expect(env.data.host).toBe('127.0.0.1');
    expect(env.data.port).toBe(fake.port);
  });
});
