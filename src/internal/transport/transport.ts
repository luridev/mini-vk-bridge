import bridge from '@vkontakte/vk-bridge';
import { ClientDisposedError } from '../../errors/errors.js';
import { assertActive, notify, waitForRequest } from '../lifecycle/lifecycle.js';
import { createScheduler } from '../scheduler/scheduler.js';
import type { RequestProps, VKBridgeSend, VKBridgeSubscribeHandler } from '@vkontakte/vk-bridge';
import type { MiniBridge, MiniBridgeOptions } from '../../client/types.js';
import type { BridgeEventData } from '../../shared/types.js';
import type { BridgeTransport } from './types.js';

export function createTransport(
  minIntervalMs: number,
  signal: AbortSignal,
  onListenerError?: MiniBridgeOptions['onListenerError'],
): BridgeTransport {
  const scheduler = createScheduler(minIntervalMs, signal);
  const listeners = new Set<VKBridgeSubscribeHandler>();

  const receive: VKBridgeSubscribeHandler = (event) => {
    for (const listener of [...listeners]) {
      if (!signal.aborted && listeners.has(listener)) {
        notify(listener, event, onListenerError);
      }
    }
  };

  bridge.subscribe(receive);

  signal.addEventListener('abort', () => {
    bridge.unsubscribe(receive);
    listeners.clear();
  }, { once: true });

  const send: VKBridgeSend = (method, props) => {
    if (signal.aborted) {
      return Promise.reject(new ClientDisposedError());
    }

    if (method === 'VKWebAppCallAPIMethod') {
      const snapshot = props === undefined
        ? undefined
        : {
            ...props,
            params: { ...(props as RequestProps<'VKWebAppCallAPIMethod'>).params },
          };

      return scheduler.enqueue(() => bridge.send(method, snapshot));
    }

    return bridge.send(method, props);
  };

  const on: MiniBridge['on'] = (name, listener) => {
    assertActive(signal);

    const subscription: VKBridgeSubscribeHandler = ({ detail }) => {
      if (detail.type === name) {
        listener(detail.data as BridgeEventData<typeof name>);
      }
    };

    listeners.add(subscription);

    return () => {
      listeners.delete(subscription);
    };
  };

  return {
    send,
    on,
    async supports(method) {
      assertActive(signal);

      return waitForRequest(bridge.supportsAsync(method), signal);
    },
    callApi(props, wait, prepare) {
      return scheduler.enqueue(
        () => {
          const startedAt = performance.now();

          return waitForRequest(bridge.send('VKWebAppCallAPIMethod', props), signal, wait, startedAt);
        },
        prepare,
      );
    },
  };
}
