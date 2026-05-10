import { describe, expect, test } from 'bun:test';
import { parseDuration } from '../../src/core/duration.ts';
import { AxeError } from '../../src/core/errors.ts';

describe('parseDuration', () => {
  test('parses seconds, minutes, hours into seconds', () => {
    expect(parseDuration('30s')).toBe(30);
    expect(parseDuration('5m')).toBe(300);
    expect(parseDuration('1h')).toBe(3600);
    expect(parseDuration('90s')).toBe(90);
  });

  test('rejects bare numbers (unit required)', () => {
    expect(() => parseDuration('300')).toThrow(AxeError);
  });

  test('rejects unknown units and garbage', () => {
    expect(() => parseDuration('5d')).toThrow(AxeError);
    expect(() => parseDuration('5x')).toThrow(AxeError);
    expect(() => parseDuration('five')).toThrow(AxeError);
    expect(() => parseDuration('')).toThrow(AxeError);
  });
});
