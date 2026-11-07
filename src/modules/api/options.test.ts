import { describe, expect, it } from 'vitest';
import { resolveApiOptions, validateMilliseconds } from './options.js';

describe('API options', () => {
  it('uses documented defaults and allows explicit zero spacing', () => {
    expect(resolveApiOptions()).toStrictEqual({ version: '5.199', minIntervalMs: 500, timeoutMs: 30_000 });

    expect(resolveApiOptions({ version: '5.200', minIntervalMs: 0, timeoutMs: 15 }))
      .toStrictEqual({ version: '5.200', minIntervalMs: 0, timeoutMs: 15 });
  });

  it.each(['', '5', '5.', 'v5.199', ' 5.199', '5.199\n'])('rejects invalid API version %j', (version) => {
    expect(() => resolveApiOptions({ version })).toThrow(TypeError);
  });

  it.each([NaN, Infinity, -Infinity, -1, 2_147_483_648])('rejects unsupported timer delay %s', (value) => {
    expect(() => resolveApiOptions({ minIntervalMs: value })).toThrow(RangeError);
    expect(() => resolveApiOptions({ timeoutMs: value })).toThrow(RangeError);
  });

  it('requires a positive timeout and accepts the largest supported timer delay', () => {
    expect(() => resolveApiOptions({ timeoutMs: 0 })).toThrow(RangeError);
    expect(() => validateMilliseconds(0.5, 'timeoutMs')).toThrow(RangeError);
    expect(validateMilliseconds(2_147_483_647, 'timeoutMs')).toBe(2_147_483_647);
  });
});
