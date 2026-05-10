import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAppInfo } from '../../src/core/app_info.ts';

const SAMPLE = readFileSync(join(process.cwd(), 'tests/fixtures/sample-app-info.txt'), 'utf8');

describe('parseAppInfo', () => {
  test('extracts public.buildid from sample fixture', () => {
    const result = parseAppInfo(SAMPLE, 443030);
    expect(result.build_id).toBe('17234956');
  });

  test('returns null when the appid block is missing', () => {
    expect(parseAppInfo(SAMPLE, 999999).build_id).toBeNull();
  });

  test('returns null on malformed input (no opening brace)', () => {
    expect(parseAppInfo('"443030" garbage', 443030).build_id).toBeNull();
  });

  test('returns null when buildid path is absent', () => {
    const text = `"443030"
{
  "common"
  {
    "name"  "x"
  }
}`;
    expect(parseAppInfo(text, 443030).build_id).toBeNull();
  });

  test('tolerates trailing prompt text after the appid block', () => {
    const text = `${SAMPLE}\n\nLoading the App Info... OK\n[unconnected]\n`;
    expect(parseAppInfo(text, 443030).build_id).toBe('17234956');
  });
});
