import { BridgeResponseError } from '../../errors/errors.js';
import { assertActive, waitForRequest } from '../../internal/lifecycle/lifecycle.js';
import type { VKBridgeSend } from '@vkontakte/vk-bridge';
import type { LaunchParams, LaunchState } from '../launch/types.js';
import type { TokenEntry } from './types.js';

function contextKey(launch: LaunchParams): string {
  if (!Number.isSafeInteger(launch.vk_app_id) || launch.vk_app_id <= 0
    || !Number.isSafeInteger(launch.vk_user_id) || launch.vk_user_id <= 0) {
    throw new BridgeResponseError(
      'VKWebAppGetLaunchParams', launch, 'VK API authorization requires positive vk_app_id and vk_user_id launch parameters.',
    );
  }

  return `${launch.vk_app_id}:${launch.vk_user_id}`;
}

function validateTokenResponse(response: unknown): void {
  if (typeof response !== 'object' || response === null
    || !('access_token' in response) || typeof response.access_token !== 'string'
    || response.access_token.trim().length === 0
    || !('scope' in response) || typeof response.scope !== 'string'
    || ('status' in response && response.status === false)) {
    throw new BridgeResponseError('VKWebAppGetAuthToken', response, 'VK did not return an active token with granted scopes.');
  }
}

/** Private control flow: this queued attempt never reached the SDK. */
export class StaleTokenError extends Error {}

export function createTokens(send: VKBridgeSend, launch: LaunchState, signal: AbortSignal) {
  let entries: Array<TokenEntry> = [];
  let pending: Promise<void> | undefined;

  signal.addEventListener('abort', () => {
    entries = [];
  }, { once: true });

  async function acquire(params: LaunchParams, scopes: ReadonlyArray<string>): Promise<void> {
    const key = contextKey(params);

    const response = await waitForRequest(send('VKWebAppGetAuthToken', {
      app_id: params.vk_app_id,
      scope: scopes.join(','),
    }), signal);

    assertActive(signal);
    validateTokenResponse(response);
    const granted = new Set(response.scope.split(',').map((scope) => scope.trim()).filter(Boolean));

    if (!scopes.every((scope) => granted.has(scope))) {
      throw new BridgeResponseError(
        'VKWebAppGetAuthToken', response, `VK did not grant all requested scopes: ${scopes.join(',')}.`,
      );
    }

    entries.push({ contextKey: key, response: Object.freeze({ ...response }), scopes: granted });
  }

  return {
    async get(scopes: ReadonlyArray<string>): Promise<TokenEntry> {
      for (;;) {
        assertActive(signal);
        const params = await launch.launch.get();
        assertActive(signal);
        const key = contextKey(params);

        const cached = entries.find((entry) => entry.contextKey === key
          && scopes.every((scope) => entry.scopes.has(scope)));

        if (cached !== undefined) {
          return cached;
        }

        if (pending !== undefined) {
          await pending;
          continue;
        }

        pending = acquire(params, scopes);

        try {
          await pending;
        } finally {
          pending = undefined;
        }
      }
    },
    assertCurrent(entry: TokenEntry): void {
      assertActive(signal);
      const params = launch.snapshot();

      if (!entries.includes(entry) || params === undefined || entry.contextKey !== contextKey(params)) {
        throw new StaleTokenError();
      }
    },
    invalidate(entry: TokenEntry): void {
      const failedIndex = entries.indexOf(entry);

      if (failedIndex !== -1) {
        entries = entries.filter((candidate, index) => index > failedIndex || candidate.contextKey !== entry.contextKey
          || candidate.response.access_token !== entry.response.access_token);
      }
    },
  };
}
