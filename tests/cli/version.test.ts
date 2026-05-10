import { describe, expect, test } from 'bun:test';
import pkg from '../../package.json' with { type: 'json' };

const ENTRY = 'src/bin.ts';

type RunResult = { stdout: string; stderr: string; exit: number };

async function runAxe(args: string[]): Promise<RunResult> {
  const proc = Bun.spawn(['bun', ENTRY, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exit = await proc.exited;
  return { stdout, stderr, exit };
}

describe('axe version', () => {
  test('prints human-readable version', async () => {
    const { stdout, exit } = await runAxe(['version']);
    expect(exit).toBe(0);
    expect(stdout.trim()).toBe(`axe ${pkg.version}`);
  });

  test('--json envelope', async () => {
    const { stdout, exit } = await runAxe(['--json', 'version']);
    expect(exit).toBe(0);
    const env = JSON.parse(stdout);
    expect(env.ok).toBe(true);
    expect(env.command).toBe('version');
    expect(env.data).toEqual({ version: pkg.version });
    expect(env.error).toBeNull();
  });
});
