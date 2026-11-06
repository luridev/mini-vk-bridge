import { DEFAULT_API_MIN_INTERVAL_MS, DEFAULT_API_TIMEOUT_MS, DEFAULT_API_VERSION } from './config.js';
import type { ApiOptions, ResolvedApiOptions } from './types.js';

export function validateMilliseconds(value: number, name: string, allowZero = false): number {
  if (!Number.isFinite(value) || value < (allowZero ? 0 : 1) || value > 2_147_483_647) {
    throw new RangeError(`${name} must be between ${allowZero ? 0 : 1} and 2147483647 ms.`);
  }

  return value;
}

export function resolveApiOptions(options: ApiOptions = {}): ResolvedApiOptions {
  const version = options.version ?? DEFAULT_API_VERSION;

  if (!/^\d+\.\d+$/.test(version)) {
    throw new TypeError('api.version must be a VK API version such as 5.199.');
  }

  return {
    version,
    minIntervalMs: validateMilliseconds(options.minIntervalMs ?? DEFAULT_API_MIN_INTERVAL_MS, 'api.minIntervalMs', true),
    timeoutMs: validateMilliseconds(options.timeoutMs ?? DEFAULT_API_TIMEOUT_MS, 'api.timeoutMs'),
  };
}

export function normalizeScopes(scopes: ReadonlyArray<string>): Array<string> {
  const normalized = scopes.map((scope) => scope.trim());

  if (normalized.some((scope) => scope.length === 0 || /[,\s]/.test(scope))) {
    throw new TypeError('Pass scopes as individual nonempty permission names.');
  }

  return [...new Set(normalized)].sort();
}
