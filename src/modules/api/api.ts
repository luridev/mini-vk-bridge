import { ApiRetryError, ApiTimeoutError, ClientDisposedError } from '../../errors/errors.js';
import { assertActive } from '../../internal/lifecycle/lifecycle.js';
import { normalizeScopes, validateMilliseconds } from './options.js';
import { createTokens, StaleTokenError } from './tokens.js';
import type { BridgeTransport } from '../../internal/transport/types.js';
import type { LaunchState } from '../launch/types.js';
import type { MiniBridgeApi, ResolvedApiOptions } from './types.js';

function isInvalidToken(error: unknown): boolean {
  return typeof error === 'object' && error !== null
    && 'error_type' in error && error.error_type === 'api_error'
    && 'error_data' in error && typeof error.error_data === 'object' && error.error_data !== null
    && 'error_code' in error.error_data && error.error_data.error_code === 5;
}

export function createApi(
  transport: BridgeTransport,
  launch: LaunchState,
  options: ResolvedApiOptions,
  signal: AbortSignal,
): MiniBridgeApi {
  const tokens = createTokens(transport.send, launch, signal);

  return {
    async authorize({ scopes = [] } = {}) {
      assertActive(signal);

      return (await tokens.get(normalizeScopes(scopes))).response;
    },
    async call(method, params = {}, callOptions = {}) {
      assertActive(signal);

      if ('access_token' in params || 'v' in params) {
        throw new TypeError('api.call manages access_token and v; use send for a raw API request.');
      }

      const payload = { ...params };
      const scopes = normalizeScopes(callOptions.scopes ?? []);
      const timeoutMs = validateMilliseconds(callOptions.timeoutMs ?? options.timeoutMs, 'timeoutMs');

      let retrying = false;
      let initialError: unknown;

      try {
        for (;;) {
          const token = await tokens.get(scopes);

          try {
            const result = await transport.callApi({
              method,
              params: { ...payload, access_token: token.response.access_token, v: options.version },
            }, { method, timeoutMs, initialError }, () => { tokens.assertCurrent(token); });

            const response: unknown = result.response;

            return response;
          } catch (error) {
            if (error instanceof StaleTokenError) {
              continue;
            }

            if (!isInvalidToken(error)) {
              throw error;
            }

            tokens.invalidate(token);

            if (retrying) {
              throw error;
            }

            initialError = error;
            retrying = true;
          }
        }
      } catch (error) {
        if (retrying && !(error instanceof ApiTimeoutError) && !(error instanceof ClientDisposedError)) {
          throw new ApiRetryError(initialError, error);
        }

        throw error;
      }
    },
  };
}
