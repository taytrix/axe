import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildArgv, runSteamcmd, type SteamcmdRequest } from '../../src/core/steamcmd.ts';

const STUB = join(process.cwd(), 'tests/fixtures/steamcmd-stub.sh');
const TMP_DIRS: string[] = [];

afterEach(async () => {
  while (TMP_DIRS.length > 0) {
    const dir = TMP_DIRS.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

async function freshRoot(): Promise<string> {
  const dir = join(tmpdir(), `axe-steamcmd-${Date.now()}-${Math.random()}`);
  await mkdir(dir, { recursive: true });
  TMP_DIRS.push(dir);
  return dir;
}

function req(
  actions: SteamcmdRequest['actions'],
  overrides: Partial<SteamcmdRequest> = {},
): SteamcmdRequest {
  return {
    binary: '/opt/steamcmd/steamcmd.sh',
    forceInstallDir: '/srv/conan',
    login: 'anonymous',
    actions,
    ...overrides,
  };
}

describe('buildArgv', () => {
  test('emits +force_install_dir before +login regardless of action insertion order', () => {
    const argv = buildArgv(
      req([{ kind: 'app_info_update' }, { kind: 'app_update', appid: 443030, validate: false }]),
    );
    const idxForce = argv.indexOf('+force_install_dir');
    const idxLogin = argv.indexOf('+login');
    expect(idxForce).toBeGreaterThanOrEqual(0);
    expect(idxLogin).toBeGreaterThanOrEqual(0);
    expect(idxForce).toBeLessThan(idxLogin);
    expect(argv[argv.length - 1]).toBe('+quit');
  });

  test('app_update with validate emits the validate token', () => {
    const argv = buildArgv(req([{ kind: 'app_update', appid: 443030, validate: true }]));
    const idx = argv.indexOf('+app_update');
    expect(argv[idx + 1]).toBe('443030');
    expect(argv[idx + 2]).toBe('validate');
  });

  test('workshop_download_item serializes BigInt id as decimal string (no `n` suffix)', () => {
    const id = 3_915_417_666_713_453_363n;
    const argv = buildArgv(req([{ kind: 'workshop_download_item', appid: 440900, id }]));
    const idx = argv.indexOf('+workshop_download_item');
    expect(argv[idx + 1]).toBe('440900');
    expect(argv[idx + 2]).toBe('3915417666713453363');
    expect(argv[idx + 2]?.endsWith('n')).toBe(false);
  });
});

describe('runSteamcmd', () => {
  test('runs against the stub bash and captures stdout/stderr/exit', async () => {
    const root = await freshRoot();
    const outcome = await runSteamcmd(
      req([{ kind: 'app_update', appid: 443030, validate: false }], {
        binary: STUB,
        forceInstallDir: root,
      }),
    );
    expect(outcome.exit).toBe(0);
    expect(outcome.stdout).toContain('stub: updated 443030');
    expect(outcome.stderr).toBe('');
  });

  test('does NOT throw on non-zero exit; surfaces exit code', async () => {
    const root = await freshRoot();
    const outcome = await runSteamcmd(
      req([{ kind: 'app_update', appid: 443030, validate: false }], {
        binary: STUB,
        forceInstallDir: root,
      }),
      {
        spawn: (cmd, options) => {
          const proc = Bun.spawn([...cmd], {
            stdout: 'pipe',
            stderr: 'pipe',
            env: { ...process.env, AXE_STUB_FAIL: '7' },
            ...(options?.signal !== undefined ? { signal: options.signal } : {}),
          });
          return {
            stdout: proc.stdout as ReadableStream<Uint8Array>,
            stderr: proc.stderr as ReadableStream<Uint8Array>,
            exited: proc.exited,
          };
        },
      },
    );
    expect(outcome.exit).toBe(7);
    expect(outcome.stderr).toContain('AXE_STUB_FAIL=7');
  });
});
