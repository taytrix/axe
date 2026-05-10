import { describe, expect, test } from 'bun:test';
import { AxeError } from '../../src/core/errors.ts';
import { parseVdf, type VdfObject } from '../../src/core/vdf.ts';

describe('parseVdf', () => {
  test('parses quoted and unquoted strings', () => {
    const text = `"Outer"
{
  "key1" "Value 1"
  key2 unquoted_value
  "key3" "with \\"escaped\\" quotes"
}`;
    const tree = parseVdf(text);
    expect(tree.get('key1')).toBe('Value 1');
    expect(tree.get('key2')).toBe('unquoted_value');
    expect(tree.get('key3')).toBe('with "escaped" quotes');
  });

  test('parses nested objects', () => {
    const text = `"AppWorkshop"
{
  "WorkshopItemsInstalled"
  {
    "12345"
    {
      "manifest" "999"
      "timeupdated" "1778"
    }
  }
}`;
    const tree = parseVdf(text);
    const installed = tree.get('WorkshopItemsInstalled') as VdfObject;
    expect(installed).toBeInstanceOf(Map);
    const entry = installed.get('12345') as VdfObject;
    expect(entry.get('manifest')).toBe('999');
    expect(entry.get('timeupdated')).toBe('1778');
  });

  test('strips // line comments', () => {
    const text = `"Wrapper"
{
  // this is a comment
  "k1" "v1"
  "k2" "v2" // trailing comment ignored
}`;
    const tree = parseVdf(text);
    expect(tree.get('k1')).toBe('v1');
    expect(tree.get('k2')).toBe('v2');
  });

  test('throws AxeError(acf_parse) on key without value', () => {
    expect(() => parseVdf('"key_without_value"')).toThrow(AxeError);
  });

  test('throws AxeError(acf_parse) on unterminated quoted string', () => {
    expect(() => parseVdf('"unterminated')).toThrow(AxeError);
  });
});
