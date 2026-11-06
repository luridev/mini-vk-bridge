import { afterEach, assert, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '../../../tests/deferred.support.js';
import { launchParams } from '../../../tests/fixtures.support.js';
import { onSend, reply, sdk } from '../../../tests/sdk.support.js';
import { ApiRetryError, ClientDisposedError, createMiniBridge } from '../../index.js';
import type { ApiParams, MiniBridge } from '../../index.js';

describe('VK API calls and token refresh', () => {
  let vk: MiniBridge;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    reply('VKWebAppGetLaunchParams', launchParams);
    reply('VKWebAppGetAuthToken', { access_token: 'token-a', scope: '' });
    reply('VKWebAppCallAPIMethod', { response: 'ok' });
    vk = createMiniBridge({ api: { minIntervalMs: 0 } });
  });

  afterEach(() => {
    vk.dispose();
  });

  it.each([
    { name: 'object', response: { count: 1, items: [{ id: 10 }] } },
    { name: 'array', response: [1, 2, 3] },
    { name: 'null', response: null },
    { name: 'boolean', response: false },
  ])('returns the original API response without interpreting its shape: $name', async ({ response }) => {
    reply('VKWebAppCallAPIMethod', { response });
    await expect(vk.api.call('users.get')).resolves.toBe(response);
  });

  it('captures caller parameters before authorization and sends the configured API version', async () => {
    vk.dispose();
    vk = createMiniBridge({ api: { version: '5.200', minIntervalMs: 0 } });
    const authorization = deferred<unknown>();
    reply('VKWebAppGetAuthToken', authorization.promise);
    const params = { user_ids: '1', count: 5 };
    const call = vk.api.call('users.get', params);
    params.user_ids = '2';
    params.count = 10;
    authorization.resolve({ access_token: 'token-a', scope: '' });
    await expect(call).resolves.toBe('ok');

    expect(sdk.send).toHaveBeenLastCalledWith('VKWebAppCallAPIMethod', {
      method: 'users.get', params: { user_ids: '1', count: 5, access_token: 'token-a', v: '5.200' },
    });
  });

  it('rechecks a queued token after launch changes and returns the ready request to the queue tail', async () => {
    vk.dispose();
    vk = createMiniBridge({ api: { minIntervalMs: 100 } });
    const firstRaw = { method: 'raw.first', params: { access_token: 'raw-token', v: '5.199' } };
    const nextRaw = { method: 'raw.next', params: { access_token: 'raw-token', v: '5.199' } };

    await vk.send('VKWebAppCallAPIMethod', firstRaw);
    const queued = vk.api.call('users.get', { user_ids: '1' });

    await vi.advanceTimersByTimeAsync(0);
    expect(sdk.send).toHaveBeenLastCalledWith('VKWebAppGetAuthToken', { app_id: 123, scope: '' });
    reply('VKWebAppGetLaunchParams', { ...launchParams, vk_app_id: 321, vk_user_id: 789 });
    await vk.launch.get({ refresh: true });
    reply('VKWebAppGetAuthToken', { access_token: 'new-context-token', scope: '' });
    const rawTail = vk.send('VKWebAppCallAPIMethod', nextRaw);

    await vi.advanceTimersByTimeAsync(100);
    await expect(rawTail).resolves.toEqual({ response: 'ok' });

    expect(sdk.send.mock.calls.filter(([method]) => method === 'VKWebAppCallAPIMethod')).toEqual([
      ['VKWebAppCallAPIMethod', firstRaw], ['VKWebAppCallAPIMethod', nextRaw],
    ]);

    expect(sdk.send.mock.calls.filter(([method]) => method === 'VKWebAppGetAuthToken')).toEqual([
      ['VKWebAppGetAuthToken', { app_id: 123, scope: '' }],
      ['VKWebAppGetAuthToken', { app_id: 321, scope: '' }],
    ]);

    await vi.advanceTimersByTimeAsync(99);
    expect(sdk.send.mock.calls.filter(([method]) => method === 'VKWebAppCallAPIMethod')).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    await expect(queued).resolves.toBe('ok');

    expect(sdk.send.mock.calls.filter(([method]) => method === 'VKWebAppCallAPIMethod')).toEqual([
      ['VKWebAppCallAPIMethod', firstRaw], ['VKWebAppCallAPIMethod', nextRaw],
      ['VKWebAppCallAPIMethod', {
        method: 'users.get', params: { user_ids: '1', access_token: 'new-context-token', v: '5.199' },
      }],
    ]);
  });

  it.each([
    { access_token: 'caller-token' },
    { v: '5.200' },
    { access_token: undefined },
    { v: undefined },
  ])('rejects caller-owned reserved API parameters at runtime: %j', async (params) => {
    await expect(vk.api.call('users.get', params as unknown as ApiParams)).rejects.toBeInstanceOf(TypeError);
    expect(sdk.send).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'undefined', error: undefined },
    { name: 'null', error: null },
    { name: 'primitive', error: 'connection failed' },
    { name: 'ordinary Error', error: new Error('connection failed') },
    { name: 'missing error type', error: { error_data: { error_code: 5 } } },
    { name: 'auth error', error: { error_type: 'auth_error', error_data: { error_code: 5 } } },
    { name: 'missing error data', error: { error_type: 'api_error' } },
    { name: 'null error data', error: { error_type: 'api_error', error_data: null } },
    { name: 'primitive error data', error: { error_type: 'api_error', error_data: 5 } },
    { name: 'missing error code', error: { error_type: 'api_error', error_data: {} } },
    { name: 'string error code', error: { error_type: 'api_error', error_data: { error_code: '5' } } },
    { name: 'rate limit', error: { error_type: 'api_error', error_data: { error_code: 6 } } },
    { name: 'insufficient permissions', error: { error_type: 'api_error', error_data: { error_code: 7 } } },
  ])('preserves the original rejection without refresh for $name', async ({ error }) => {
    onSend('VKWebAppCallAPIMethod', vi.fn().mockRejectedValue(error));
    await expect(vk.api.call('users.get')).rejects.toBe(error);

    expect(sdk.send.mock.calls.map(([method]) => method)).toEqual([
      'VKWebAppGetLaunchParams', 'VKWebAppGetAuthToken', 'VKWebAppCallAPIMethod',
    ]);
  });

  it('never treats an invalid-token rejection from GetAuthToken as an API refresh trigger', async () => {
    const authError = { error_type: 'api_error', error_data: { error_code: 5 } };
    onSend('VKWebAppGetAuthToken', vi.fn().mockRejectedValue(authError));
    await expect(vk.api.call('users.get')).rejects.toBe(authError);

    expect(sdk.send.mock.calls.map(([method]) => method)).toEqual([
      'VKWebAppGetLaunchParams', 'VKWebAppGetAuthToken',
    ]);
  });

  it('refreshes once for numeric API error 5, retries the original request, and caches the new token', async () => {
    const initialError = { error_type: 'api_error', error_data: { error_code: 5 } };
    let authorizations = 0;

    onSend('VKWebAppGetAuthToken', () => {
      authorizations += 1;

      return { access_token: authorizations === 1 ? 'token-a' : 'token-b', scope: 'wall' };
    });

    const callApi = vi.fn()
      .mockRejectedValueOnce(initialError)
      .mockResolvedValue({ response: { post_id: 42 } });

    onSend('VKWebAppCallAPIMethod', callApi);
    const params = { owner_id: 1, message: 'message' };
    await expect(vk.api.call('wall.post', params, { scopes: ['wall'] })).resolves.toEqual({ post_id: 42 });

    expect(sdk.send.mock.calls).toEqual([
      ['VKWebAppGetLaunchParams', undefined],
      ['VKWebAppGetAuthToken', { app_id: 123, scope: 'wall' }],
      ['VKWebAppCallAPIMethod', {
        method: 'wall.post', params: { ...params, access_token: 'token-a', v: '5.199' },
      }],
      ['VKWebAppGetAuthToken', { app_id: 123, scope: 'wall' }],
      ['VKWebAppCallAPIMethod', {
        method: 'wall.post', params: { ...params, access_token: 'token-b', v: '5.199' },
      }],
    ]);

    await vk.api.call('wall.get', {}, { scopes: ['wall'] });
    expect(authorizations).toBe(2);
    expect(callApi).toHaveBeenCalledTimes(3);

    expect(sdk.send).toHaveBeenLastCalledWith('VKWebAppCallAPIMethod', {
      method: 'wall.get', params: { access_token: 'token-b', v: '5.199' },
    });
  });

  it('does not make a third API attempt and invalidates the token rejected by the retry', async () => {
    const initialError = { error_type: 'api_error', error_data: { error_code: 5, description: 'first' } };
    const retryError = { error_type: 'api_error', error_data: { error_code: 5, description: 'second' } };
    let authorizations = 0;

    onSend('VKWebAppGetAuthToken', () => {
      authorizations += 1;

      return { access_token: `token-${authorizations}`, scope: '' };
    });

    const callApi = vi.fn().mockRejectedValueOnce(initialError).mockRejectedValue(retryError);
    onSend('VKWebAppCallAPIMethod', callApi);
    const call = vk.api.call('users.get');
    await expect(call).rejects.toBeInstanceOf(ApiRetryError);
    await expect(call).rejects.toMatchObject({ initialError, cause: retryError });
    const error: unknown = await call.catch((reason: unknown) => reason);
    assert.instanceOf(error, ApiRetryError);
    expect(error.initialError).toBe(initialError);
    expect(error.cause).toBe(retryError);
    expect(authorizations).toBe(2);
    expect(callApi).toHaveBeenCalledTimes(2);

    await expect(vk.api.authorize()).resolves.toMatchObject({ access_token: 'token-3' });
    expect(callApi).toHaveBeenCalledTimes(2);
  });

  it('preserves initialError and the original cause when refresh is refused', async () => {
    const initialError = { error_type: 'api_error', error_data: { error_code: 5 } };
    const refusal = { error_type: 'auth_error', error_data: { error_code: 4 } };

    const authorize = vi.fn()
      .mockResolvedValueOnce({ access_token: 'token-a', scope: '' })
      .mockRejectedValue(refusal);

    onSend('VKWebAppGetAuthToken', authorize);
    onSend('VKWebAppCallAPIMethod', vi.fn().mockRejectedValue(initialError));
    const error: unknown = await vk.api.call('users.get').catch((reason: unknown) => reason);
    assert.instanceOf(error, ApiRetryError);
    expect(error.initialError).toBe(initialError);
    expect(error.cause).toBe(refusal);

    expect(sdk.send.mock.calls.map(([method]) => method)).toEqual([
      'VKWebAppGetLaunchParams', 'VKWebAppGetAuthToken', 'VKWebAppCallAPIMethod', 'VKWebAppGetAuthToken',
    ]);
  });

  it('preserves both original errors when the retry fails for another reason', async () => {
    const initialError = { error_type: 'api_error', error_data: { error_code: 5 } };
    const networkError = new Error('transport disconnected');
    const callApi = vi.fn().mockRejectedValueOnce(initialError).mockRejectedValue(networkError);
    onSend('VKWebAppCallAPIMethod', callApi);
    const error: unknown = await vk.api.call('users.get').catch((reason: unknown) => reason);
    assert.instanceOf(error, ApiRetryError);
    expect(error.initialError).toBe(initialError);
    expect(error.cause).toBe(networkError);
    expect(callApi).toHaveBeenCalledTimes(2);
    await vk.api.authorize();
    expect(sdk.send.mock.calls.filter(([method]) => method === 'VKWebAppGetAuthToken')).toHaveLength(2);
  });

  it('shares a refresh across concurrent failures and reuses it for a later old-token rejection', async () => {
    const firstRequest = deferred<unknown>();
    const secondRequest = deferred<unknown>();
    const thirdRequest = deferred<unknown>();
    const refresh = deferred<unknown>();
    const initialError = { error_type: 'api_error', error_data: { error_code: 5 } };
    let authorizations = 0;
    let attempts = 0;

    onSend('VKWebAppGetAuthToken', () => {
      authorizations += 1;

      return authorizations === 1 ? { access_token: 'token-a', scope: '' } : refresh.promise;
    });

    onSend('VKWebAppCallAPIMethod', () => {
      attempts += 1;

      if (attempts === 1) {
        return firstRequest.promise;
      }

      if (attempts === 2) {
        return secondRequest.promise;
      }

      if (attempts === 3) {
        return thirdRequest.promise;
      }

      return { response: 'retried' };
    });

    const first = vk.api.call('users.get', { user_ids: '1' });
    const second = vk.api.call('users.get', { user_ids: '2' });
    const third = vk.api.call('users.get', { user_ids: '3' });
    await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toBe(3);
    firstRequest.reject(initialError);
    await vi.advanceTimersByTimeAsync(0);
    expect(authorizations).toBe(2);
    secondRequest.reject(initialError);
    await vi.advanceTimersByTimeAsync(0);
    expect(authorizations).toBe(2);

    refresh.resolve({ access_token: 'token-b', scope: '' });
    await expect(Promise.all([first, second])).resolves.toEqual(['retried', 'retried']);
    thirdRequest.reject(initialError);
    await expect(third).resolves.toBe('retried');
    expect(authorizations).toBe(2);
    expect(attempts).toBe(6);

    expect(sdk.send.mock.calls.filter(([method]) => method === 'VKWebAppCallAPIMethod').slice(3)).toEqual([
      ['VKWebAppCallAPIMethod', {
        method: 'users.get', params: { user_ids: '1', access_token: 'token-b', v: '5.199' },
      }],
      ['VKWebAppCallAPIMethod', {
        method: 'users.get', params: { user_ids: '2', access_token: 'token-b', v: '5.199' },
      }],
      ['VKWebAppCallAPIMethod', {
        method: 'users.get', params: { user_ids: '3', access_token: 'token-b', v: '5.199' },
      }],
    ]);
  });

  it('preserves ClientDisposedError during refresh and never dispatches the retry after a late token', async () => {
    const refresh = deferred<unknown>();
    let authorizations = 0;

    onSend('VKWebAppGetAuthToken', () => {
      authorizations += 1;

      return authorizations === 1 ? { access_token: 'token-a', scope: '' } : refresh.promise;
    });

    onSend('VKWebAppCallAPIMethod', vi.fn().mockRejectedValue({ error_type: 'api_error', error_data: { error_code: 5 } }));
    const call = vk.api.call('users.get');
    const rejected = expect(call).rejects.toBeInstanceOf(ClientDisposedError);
    await vi.advanceTimersByTimeAsync(0);
    expect(authorizations).toBe(2);
    vk.dispose();
    await rejected;
    refresh.resolve({ access_token: 'token-b', scope: '' });
    await vi.advanceTimersByTimeAsync(0);
    expect(sdk.send.mock.calls.filter(([method]) => method === 'VKWebAppCallAPIMethod')).toHaveLength(1);
  });
});
