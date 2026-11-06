import { assertActive, notify, waitForRequest } from '../../internal/lifecycle/lifecycle.js';
import type { MiniBridge, MiniBridgeOptions } from '../../client/types.js';
import type { BridgeConfig, MiniBridgeConfig } from './types.js';

export function createConfig(
  transport: Pick<MiniBridge, 'send' | 'on'>,
  signal: AbortSignal,
  onListenerError?: MiniBridgeOptions['onListenerError'],
): MiniBridgeConfig {
  let current: BridgeConfig | undefined;
  let revision = 0;
  let pending: Promise<BridgeConfig> | undefined;
  const listeners = new Set<(config: BridgeConfig) => void>();

  function publish(config: BridgeConfig): BridgeConfig {
    const snapshot = Object.freeze({ ...config });
    current = snapshot;

    for (const listener of [...listeners]) {
      if (!signal.aborted && listeners.has(listener)) {
        notify(listener, snapshot, onListenerError);
      }
    }

    return snapshot;
  }

  transport.on('VKWebAppUpdateConfig', (config) => {
    revision += 1;
    publish(config);
  });

  signal.addEventListener('abort', () => {
    current = undefined;
    listeners.clear();
  }, { once: true });

  return {
    async get() {
      assertActive(signal);

      if (pending !== undefined) {
        return pending;
      }

      const startedAtRevision = revision;

      pending = waitForRequest(transport.send('VKWebAppGetConfig'), signal).then((config) => {
        assertActive(signal);

        if (startedAtRevision !== revision && current !== undefined) {
          return current;
        }

        return publish(config);
      });

      try {
        return await pending;
      } finally {
        pending = undefined;
      }
    },
    snapshot() {
      assertActive(signal);

      return current;
    },
    subscribe(listener, { immediate = true } = {}) {
      assertActive(signal);

      const subscription = (config: BridgeConfig) => {
        listener(config);
      };

      listeners.add(subscription);

      if (immediate && current !== undefined) {
        notify(subscription, current, onListenerError);
      }

      return () => {
        listeners.delete(subscription);
      };
    },
  };
}
