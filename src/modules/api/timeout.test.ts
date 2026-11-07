import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '../../../tests/deferred.support.js';
import { launchParams } from '../../../tests/fixtures.support.js';
import { onSend, reply, sdk } from '../../../tests/sdk.support.js';
import { createMiniBridge } from '../../client/client.js';
import { ApiTimeoutError, ClientDisposedError } from '../../errors/errors.js';
import type { MiniBridge } from '../../client/types.js';

describe('API request timeout and late SDK replies', () => {
  let client: MiniBridge | undefined;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    reply('VKWebAppGetLaunchParams', launchParams);
    reply('VKWebAppGetAuthToken', { access_token: 'token', scope: '' });
  });

  afterEach(() => {
    client?.dispose();
    client = undefined;
  });

  it('starts the timeout when the request dispatches, after its queue wait', async () => {
    client = createMiniBridge({ api: { minIntervalMs: 100, timeoutMs: 50 } });
    const sdkReply = deferred<unknown>();
    const starts: Array<[string | undefined, number]> = [];

    onSend('VKWebAppCallAPIMethod', (props) => {
      starts.push([props?.method, performance.now()]);

      return props?.method === 'raw.first' ? { response: 'first' } : sdkReply.promise;
    });

    await client.api.authorize();

    await client.send('VKWebAppCallAPIMethod', {
      method: 'raw.first', params: { access_token: 'raw', v: '5.199' },
    });

    const settled = vi.fn();

    const result = client.api.call('users.get').catch((error: unknown) => {
      settled();

      return error;
    });

    await vi.advanceTimersByTimeAsync(99);
    expect(starts).toStrictEqual([['raw.first', 0]]);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(starts).toStrictEqual([['raw.first', 0], ['users.get', 100]]);
    await vi.advanceTimersByTimeAsync(49);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBeInstanceOf(ApiTimeoutError);
    expect(settled).toHaveBeenCalledOnce();
    sdkReply.resolve({ response: 'late' });
  });

  it('uses the global timeout unless a call supplies its own value', async () => {
    client = createMiniBridge({ api: { minIntervalMs: 0, timeoutMs: 200 } });
    const sdkReply = deferred<unknown>();
    reply('VKWebAppCallAPIMethod', sdkReply.promise);
    const globalSettled = vi.fn();

    const global = client.api.call('global.method').catch((error: unknown) => {
      globalSettled();

      return error;
    });

    const local = client.api.call('local.method', {}, { timeoutMs: 50 }).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(50);
    const localError = await local;
    expect(localError).toBeInstanceOf(ApiTimeoutError);
    expect(localError).toMatchObject({ method: 'local.method', timeoutMs: 50, initialError: undefined });
    expect(globalSettled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(149);
    expect(globalSettled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    const globalError = await global;
    expect(globalError).toBeInstanceOf(ApiTimeoutError);
    expect(globalError).toMatchObject({ method: 'global.method', timeoutMs: 200 });
    sdkReply.resolve({ response: 'late' });
  });

  it('returns a successful reply before the deadline and removes its timer', async () => {
    client = createMiniBridge({ api: { minIntervalMs: 0, timeoutMs: 50 } });
    const sdkReply = deferred<unknown>();
    reply('VKWebAppCallAPIMethod', sdkReply.promise);
    const request = client.api.call('users.get');

    await vi.advanceTimersByTimeAsync(49);
    const response = { id: 123 };
    sdkReply.resolve({ response });

    await expect(request).resolves.toBe(response);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(100);
    expect(sdk.send.mock.calls.filter(([method]) => method === 'VKWebAppCallAPIMethod')).toHaveLength(1);
  });

  it.each(['resolve', 'reject'] as const)('observes late %s without changing the timeout, retrying or invalidating the token', async (outcome) => {
    client = createMiniBridge({ api: { minIntervalMs: 0, timeoutMs: 50 } });
    const sdkReply = deferred<unknown>();
    const unhandled = vi.fn();

    onSend('VKWebAppCallAPIMethod', (props) => (
      props?.method === 'slow.method' ? sdkReply.promise : { response: 'next request' }
    ));

    process.on('unhandledRejection', unhandled);

    try {
      const request = client.api.call('slow.method').catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(50);
      const error = await request;
      expect(error).toBeInstanceOf(ApiTimeoutError);

      if (!(error instanceof ApiTimeoutError)) {
        throw new Error('Expected the request to time out');
      }

      const sdkSettled = vi.fn();
      void error.requestSettled.then(sdkSettled);
      await vi.advanceTimersByTimeAsync(500);
      expect(sdkSettled).not.toHaveBeenCalled();
      expect(sdk.send.mock.calls.filter(([method]) => method === 'VKWebAppCallAPIMethod')).toHaveLength(1);

      if (outcome === 'resolve') {
        sdkReply.resolve({ response: 'too late' });
      } else {
        sdkReply.reject({ error_type: 'api_error', error_data: { error_code: 5 } });
      }

      await expect(error.requestSettled).resolves.toBeUndefined();
      await vi.advanceTimersByTimeAsync(0);
      expect(sdkSettled).toHaveBeenCalledOnce();
      await expect(request).resolves.toBe(error);
      await expect(client.api.call('next.method')).resolves.toBe('next request');
      expect(sdk.send.mock.calls.filter(([method]) => method === 'VKWebAppGetAuthToken')).toHaveLength(1);
      expect(sdk.send.mock.calls.filter(([method]) => method === 'VKWebAppCallAPIMethod')).toHaveLength(2);
      expect(unhandled).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('retains the first invalid-token error when the refreshed attempt times out', async () => {
    client = createMiniBridge({ api: { minIntervalMs: 0, timeoutMs: 50 } });
    const firstReply = deferred<unknown>();
    const secondReply = deferred<unknown>();
    let authorization = 0;
    let attempts = 0;

    onSend('VKWebAppGetAuthToken', () => {
      authorization += 1;

      return { access_token: `token-${authorization}`, scope: '' };
    });

    onSend('VKWebAppCallAPIMethod', () => {
      attempts += 1;

      return attempts === 1 ? firstReply.promise : secondReply.promise;
    });

    const request = client.api.call('users.get').catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    const initialError = { error_type: 'api_error', error_data: { error_code: 5, error_msg: 'expired' } };
    firstReply.reject(initialError);
    await vi.advanceTimersByTimeAsync(0);

    expect(authorization).toBe(2);
    expect(attempts).toBe(2);
    await vi.advanceTimersByTimeAsync(50);
    const error = await request;
    expect(error).toBeInstanceOf(ApiTimeoutError);

    if (!(error instanceof ApiTimeoutError)) {
      throw new Error('Expected the refreshed attempt to time out');
    }

    expect(error.initialError).toBe(initialError);
    expect(error.method).toBe('users.get');
    secondReply.reject(initialError);
    await expect(error.requestSettled).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(500);
    expect(attempts).toBe(2);
    expect(authorization).toBe(2);
  });

  it('cancels the library wait on disposal while the dispatched SDK request can still complete', async () => {
    client = createMiniBridge({ api: { minIntervalMs: 0, timeoutMs: 50 } });
    const sdkReply = deferred<unknown>();
    const sdkSettled = vi.fn();
    void sdkReply.promise.then(sdkSettled);
    reply('VKWebAppCallAPIMethod', sdkReply.promise);
    const request = client.api.call('users.get').catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);

    client.dispose();

    const error = await request;
    expect(error).toBeInstanceOf(ClientDisposedError);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(100);
    expect(sdkSettled).not.toHaveBeenCalled();
    const response = { response: 'completed in SDK' };
    sdkReply.resolve(response);
    await vi.advanceTimersByTimeAsync(0);
    expect(sdkSettled).toHaveBeenCalledWith(response);
    await expect(request).resolves.toBe(error);
    expect(sdk.send.mock.calls.filter(([method]) => method === 'VKWebAppCallAPIMethod')).toHaveLength(1);
  });

  it('counts synchronous SDK work as part of the timeout from dispatch', async () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    client = createMiniBridge({ api: { minIntervalMs: 0, timeoutMs: 100 } });
    const sdkReply = deferred<unknown>();

    onSend('VKWebAppCallAPIMethod', () => {
      now = 70;

      return sdkReply.promise;
    });

    const settled = vi.fn();

    const request = client.api.call('users.get').catch((error: unknown) => {
      settled();

      return error;
    });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(29);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(request).resolves.toBeInstanceOf(ApiTimeoutError);
    sdkReply.resolve({ response: 'late' });
  });
});
