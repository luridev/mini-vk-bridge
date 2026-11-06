import { BridgeResponseError, ClientDisposedError } from '../errors/errors.js';
import { assertActive, waitForRequest } from '../internal/lifecycle/lifecycle.js';
import { createTransport } from '../internal/transport/transport.js';
import { createApi } from '../modules/api/api.js';
import { resolveApiOptions } from '../modules/api/options.js';
import { createConfig } from '../modules/configuration/configuration.js';
import { createLaunch } from '../modules/launch/launch.js';
import { createStorage } from '../modules/storage/storage.js';
import type { ReceiveData } from '@vkontakte/vk-bridge';
import type { MiniBridge, MiniBridgeOptions } from './types.js';

function validateInit(response: unknown): void {
  if (typeof response !== 'object' || response === null || !('result' in response) || response.result !== true) {
    throw new BridgeResponseError('VKWebAppInit', response, 'VK did not confirm Mini App initialization.');
  }
}

export function createMiniBridge(options: MiniBridgeOptions = {}): MiniBridge {
  if (typeof window === 'undefined') {
    throw new Error('createMiniBridge requires a browser environment.');
  }

  const apiOptions = resolveApiOptions(options.api);
  const { onListenerError } = options;
  const lifetime = new AbortController();
  const { signal } = lifetime;
  const transport = createTransport(apiOptions.minIntervalMs, signal, onListenerError);
  const launchState = createLaunch(transport.send, window.location.search, signal);
  const config = createConfig(transport, signal, onListenerError);
  const api = createApi(transport, launchState, apiOptions, signal);
  let initialization: Promise<ReceiveData<'VKWebAppInit'>> | undefined;

  return {
    init() {
      if (signal.aborted) {
        return Promise.reject(new ClientDisposedError());
      }

      initialization ??= waitForRequest(transport.send('VKWebAppInit'), signal).then((response) => {
        assertActive(signal);
        validateInit(response);

        return response;
      }).catch((error: unknown) => {
        initialization = undefined;
        throw error;
      });

      return initialization;
    },
    send: transport.send,
    on: transport.on,
    supports: transport.supports,
    dispose: () => { lifetime.abort(); },
    launch: launchState.launch,
    config,
    storage: createStorage(transport.send, signal),
    api,
  };
}
