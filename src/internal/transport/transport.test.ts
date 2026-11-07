import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '../../../tests/deferred.support.js';
import { launchParams, lightConfig } from '../../../tests/fixtures.support.js';
import { emit, onSend, reply, sdk, subscriberCount } from '../../../tests/sdk.support.js';
import { ClientDisposedError, createMiniBridge } from '../../index.js';
import type { MiniBridge, MiniBridgeOptions } from '../../client/types.js';

const clients: Array<MiniBridge> = [];

function createClient(options?: MiniBridgeOptions): MiniBridge {
  const client = createMiniBridge(options);
  clients.push(client);

  return client;
}

describe('bridge transport', () => {
  afterEach(() => {
    for (const client of clients.splice(0)) {
      client.dispose();
    }
  });

  describe('raw SDK operations', () => {
    it('forwards command parameters and preserves the original response without initialization', async () => {
      const response = { result: true };
      const props = { text: 'copy me', request_id: 'caller-id' };
      reply('VKWebAppCopyText', response);
      await expect(createClient().send('VKWebAppCopyText', props)).resolves.toBe(response);
      expect(sdk.send).toHaveBeenCalledExactlyOnceWith('VKWebAppCopyText', props);
      expect(sdk.send.mock.calls[0]?.[1]).toBe(props);
    });

    it('preserves rejected SDK data and does not send it to onListenerError', async () => {
      const onListenerError = vi.fn();
      const request = deferred<unknown>();
      const error = { error_type: 'client_error', error_data: { error_code: 4 } };
      onSend('VKWebAppCopyText', () => request.promise);
      const failed = createClient({ onListenerError }).send('VKWebAppCopyText', { text: 'x' });
      request.reject(error);
      await expect(failed).rejects.toBe(error);
      expect(onListenerError).not.toHaveBeenCalled();
    });

    it.each([true, false])('delegates support detection to supportsAsync: %s', async (supported) => {
      sdk.supportsAsync.mockResolvedValue(supported);
      await expect(createClient().supports('VKWebAppDownloadFile')).resolves.toBe(supported);
      expect(sdk.supportsAsync).toHaveBeenCalledExactlyOnceWith('VKWebAppDownloadFile');
      expect(sdk.send).not.toHaveBeenCalled();
    });

    it('ends its own supports wait on disposal while a sent raw request stays alive', async () => {
      const supportRequest = deferred<boolean>();
      const rawRequest = deferred<unknown>();
      sdk.supportsAsync.mockReturnValue(supportRequest.promise);
      onSend('VKWebAppCopyText', () => rawRequest.promise);
      const client = createClient();
      const support = client.supports('VKWebAppCopyText');
      const raw = client.send('VKWebAppCopyText', { text: 'x' });
      client.dispose();
      await expect(support).rejects.toBeInstanceOf(ClientDisposedError);
      supportRequest.resolve(true);
      rawRequest.resolve({ result: true });
      await expect(raw).resolves.toStrictEqual({ result: true });
    });
  });

  describe('queued raw API request parameters', () => {
    const dispatched = vi.fn();

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
      dispatched.mockReset();

      onSend('VKWebAppCallAPIMethod', (props) => {
        dispatched(performance.now(), props === undefined
          ? undefined
          : {
              ...props, params: { ...props.params },
            });

        return { response: props?.params.user_ids };
      });
    });

    it('captures outer props before enqueueing, including method, request_id and a replaced params object', async () => {
      const client = createClient({ api: { minIntervalMs: 100 } });
      const firstProps = { method: 'users.get', params: { access_token: 'raw-token', v: '5.199', user_ids: '1' } };
      await client.send('VKWebAppCallAPIMethod', firstProps);
      const originalParams = { access_token: 'raw-token', v: '5.199', user_ids: '2' };
      const props = { method: 'users.get', params: originalParams, request_id: 'request-2' };
      const request = client.send('VKWebAppCallAPIMethod', props);

      expect(props).toStrictEqual({ method: 'users.get', params: originalParams, request_id: 'request-2' });
      expect(props.params).toBe(originalParams);
      props.method = 'friends.get';
      props.request_id = 'changed';
      props.params = { access_token: 'replacement-token', v: '5.200', user_ids: '99' };
      await vi.advanceTimersByTimeAsync(100);

      expect(dispatched.mock.calls).toStrictEqual([
        [0, firstProps],
        [100, { method: 'users.get', params: originalParams, request_id: 'request-2' }],
      ]);

      await expect(request).resolves.toStrictEqual({ response: '2' });

      expect(props).toStrictEqual({
        method: 'friends.get',
        request_id: 'changed',
        params: { access_token: 'replacement-token', v: '5.200', user_ids: '99' },
      });
    });

    it('captures nested params for every reuse of the same request object in FIFO dispatch order', async () => {
      const client = createClient({ api: { minIntervalMs: 100 } });
      const params = { access_token: 'token-1', v: '5.199', user_ids: '1', count: 1 };
      const props = { method: 'users.get', params };
      const first = client.send('VKWebAppCallAPIMethod', props);
      params.user_ids = '2';
      params.count = 2;
      params.access_token = 'token-2';
      const second = client.send('VKWebAppCallAPIMethod', props);
      params.user_ids = '3';
      params.count = 3;
      params.access_token = 'token-3';
      params.v = '5.200';
      const third = client.send('VKWebAppCallAPIMethod', props);

      await vi.advanceTimersByTimeAsync(200);

      expect(dispatched.mock.calls).toStrictEqual([
        [0, { method: 'users.get', params: { access_token: 'token-1', v: '5.199', user_ids: '1', count: 1 } }],
        [100, { method: 'users.get', params: { access_token: 'token-2', v: '5.199', user_ids: '2', count: 2 } }],
        [200, { method: 'users.get', params: { access_token: 'token-3', v: '5.200', user_ids: '3', count: 3 } }],
      ]);

      await expect(Promise.all([first, second, third])).resolves.toStrictEqual([
        { response: '1' }, { response: '2' }, { response: '3' },
      ]);

      expect(props.params).toBe(params);
      expect(params).toStrictEqual({ access_token: 'token-3', v: '5.200', user_ids: '3', count: 3 });
    });

    it('preserves independent raw and high-level snapshots in their shared scheduler', async () => {
      const client = createClient({ api: { minIntervalMs: 100 } });
      reply('VKWebAppGetLaunchParams', launchParams);
      reply('VKWebAppGetAuthToken', { access_token: 'managed-token', scope: '' });
      await client.api.authorize();
      const props = { method: 'users.get', params: { access_token: 'raw-token', v: '5.199', user_ids: '1' } };
      const first = client.send('VKWebAppCallAPIMethod', props);
      const managedParams = { user_ids: '2' };
      const second = client.api.call('users.get', managedParams);
      await vi.advanceTimersByTimeAsync(0);
      props.params.user_ids = '3';
      const third = client.send('VKWebAppCallAPIMethod', props);
      props.params.user_ids = 'changed-raw';
      managedParams.user_ids = 'changed-managed';

      await vi.advanceTimersByTimeAsync(200);

      expect(dispatched.mock.calls).toStrictEqual([
        [0, { method: 'users.get', params: { access_token: 'raw-token', v: '5.199', user_ids: '1' } }],
        [100, { method: 'users.get', params: { access_token: 'managed-token', v: '5.199', user_ids: '2' } }],
        [200, { method: 'users.get', params: { access_token: 'raw-token', v: '5.199', user_ids: '3' } }],
      ]);

      await expect(Promise.all([first, second, third])).resolves.toStrictEqual([{ response: '1' }, '2', { response: '3' }]);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('passes omitted raw API props through to the SDK without constructing a payload', async () => {
      const client = createClient({ api: { minIntervalMs: 100 } });

      await client.send('VKWebAppCallAPIMethod', {
        method: 'users.get', params: { access_token: 'raw-token', v: '5.199', user_ids: '1' },
      });

      const request = client.send('VKWebAppCallAPIMethod');
      await vi.advanceTimersByTimeAsync(100);
      expect(dispatched).toHaveBeenLastCalledWith(100, undefined);
      await expect(request).resolves.toStrictEqual({ response: undefined });
    });
  });

  describe('event delivery', () => {
    it('notifies only matching subscribers in registration order', () => {
      const client = createClient();
      const order: Array<string> = [];

      const first = vi.fn(() => {
        order.push('first');
      });

      const second = vi.fn(() => {
        order.push('second');
      });

      const other = vi.fn();
      client.on('VKWebAppUpdateConfig', first);
      client.on('VKWebAppGetConfigFailed', other);
      client.on('VKWebAppUpdateConfig', second);
      emit({ detail: { type: 'VKWebAppUpdateConfig', data: lightConfig } });
      expect(first).toHaveBeenCalledExactlyOnceWith(lightConfig);
      expect(second).toHaveBeenCalledExactlyOnceWith(lightConfig);
      expect(order).toStrictEqual(['first', 'second']);
      expect(other).not.toHaveBeenCalled();
    });

    it('registers the same callback independently and makes each unsubscribe idempotent', () => {
      const client = createClient();
      const listener = vi.fn();
      const stopFirst = client.on('VKWebAppUpdateConfig', listener);
      const stopSecond = client.on('VKWebAppUpdateConfig', listener);
      stopFirst();
      stopFirst();
      emit({ detail: { type: 'VKWebAppUpdateConfig', data: lightConfig } });
      expect(listener).toHaveBeenCalledOnce();
      stopSecond();
      emit({ detail: { type: 'VKWebAppUpdateConfig', data: lightConfig } });
      expect(listener).toHaveBeenCalledOnce();
    });

    it('reports an original thrown value once and continues notifying later subscribers', () => {
      expect.assertions(3);
      const error: unknown = { subscriber: 'failed' };
      const order: Array<string> = [];

      const onListenerError = vi.fn((received: unknown) => {
        expect(received).toBe(error);
        order.push('error');
      });

      const client = createClient({ onListenerError });

      client.on('VKWebAppUpdateConfig', () => {
        order.push('throwing');
        throw error;
      });

      client.on('VKWebAppUpdateConfig', () => {
        order.push('last');
      });

      emit({ detail: { type: 'VKWebAppUpdateConfig', data: lightConfig } });
      expect(order).toStrictEqual(['throwing', 'error', 'last']);
      expect(onListenerError).toHaveBeenCalledExactlyOnceWith(error);
    });

    it('isolates listener errors and disposal between clients on the same SDK', () => {
      const firstError: unknown = { client: 1 };
      const secondError: unknown = { client: 2 };
      const firstReporter = vi.fn();
      const secondReporter = vi.fn();
      const first = createClient({ onListenerError: firstReporter });
      const second = createClient({ onListenerError: secondReporter });

      first.on('VKWebAppUpdateConfig', () => {
        throw firstError;
      });

      second.on('VKWebAppUpdateConfig', () => {
        throw secondError;
      });

      emit({ detail: { type: 'VKWebAppUpdateConfig', data: lightConfig } });
      expect(firstReporter).toHaveBeenCalledExactlyOnceWith(firstError);
      expect(secondReporter).toHaveBeenCalledExactlyOnceWith(secondError);
      first.dispose();
      expect(subscriberCount()).toBe(1);
      emit({ detail: { type: 'VKWebAppUpdateConfig', data: lightConfig } });
      expect(firstReporter).toHaveBeenCalledOnce();
      expect(secondReporter).toHaveBeenCalledTimes(2);
      second.dispose();
      expect(subscriberCount()).toBe(0);
    });

    it('defers the original throw by default without producing an unhandled test error', () => {
      const tasks: Array<() => void> = [];

      vi.stubGlobal('queueMicrotask', (task: () => void) => {
        tasks.push(task);
      });

      const error = new Error('subscriber failed');
      const client = createClient();
      const next = vi.fn();

      client.on('VKWebAppUpdateConfig', () => {
        throw error;
      });

      client.on('VKWebAppUpdateConfig', next);
      emit({ detail: { type: 'VKWebAppUpdateConfig', data: lightConfig } });
      expect(next).toHaveBeenCalledOnce();
      expect(tasks).toHaveLength(1);
      let thrown: unknown;

      try {
        tasks[0]?.();
      } catch (caught) {
        thrown = caught;
      }

      expect(thrown).toBe(error);
    });

    it('defers a reporter error once without invoking the reporter recursively', () => {
      const tasks: Array<() => void> = [];

      vi.stubGlobal('queueMicrotask', (task: () => void) => {
        tasks.push(task);
      });

      const subscriberError: unknown = { failure: 'subscriber' };
      const reporterError: unknown = { failure: 'reporter' };

      const reporter = vi.fn(() => {
        throw reporterError;
      });

      const client = createClient({ onListenerError: reporter });
      const next = vi.fn();

      client.on('VKWebAppUpdateConfig', () => {
        throw subscriberError;
      });

      client.on('VKWebAppUpdateConfig', next);
      emit({ detail: { type: 'VKWebAppUpdateConfig', data: lightConfig } });
      expect(reporter).toHaveBeenCalledExactlyOnceWith(subscriberError);
      expect(next).toHaveBeenCalledOnce();
      expect(tasks).toHaveLength(1);
      let thrown: unknown;

      try {
        tasks[0]?.();
      } catch (caught) {
        thrown = caught;
      }

      expect(thrown).toBe(reporterError);
      expect(reporter).toHaveBeenCalledOnce();
    });

    it('skips a subscription removed earlier during the same event', () => {
      const client = createClient();
      const second = vi.fn();
      let stopSecond: () => void = () => undefined;

      client.on('VKWebAppUpdateConfig', () => {
        stopSecond();
      });

      stopSecond = client.on('VKWebAppUpdateConfig', second);
      emit({ detail: { type: 'VKWebAppUpdateConfig', data: lightConfig } });
      expect(second).not.toHaveBeenCalled();
    });
  });
});
