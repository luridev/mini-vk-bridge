import { assertActive, waitForRequest } from '../../internal/lifecycle/lifecycle.js';
import type { VKBridgeSend } from '@vkontakte/vk-bridge';
import type { LaunchParams, LaunchState, MiniBridgeLaunch } from './types.js';

export function createLaunch(send: VKBridgeSend, rawQuery: string, signal: AbortSignal): LaunchState {
  let snapshot: LaunchParams | undefined;
  let pending: Promise<LaunchParams> | undefined;

  signal.addEventListener('abort', () => {
    snapshot = undefined;
  }, { once: true });

  const launch: MiniBridgeLaunch = {
    rawQuery,
    query() {
      assertActive(signal);

      return new URLSearchParams(rawQuery);
    },
    async get({ refresh = false } = {}) {
      assertActive(signal);

      if (pending !== undefined) {
        return pending;
      }

      if (snapshot !== undefined && !refresh) {
        return snapshot;
      }

      pending = waitForRequest(send('VKWebAppGetLaunchParams'), signal).then((params) => {
        assertActive(signal);
        snapshot = Object.freeze({ ...params });

        return snapshot;
      });

      try {
        return await pending;
      } finally {
        pending = undefined;
      }
    },
  };

  return { launch, snapshot: () => snapshot };
}
