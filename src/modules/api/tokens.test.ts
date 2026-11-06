import { afterEach, assert, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { deferred } from '../../../tests/deferred.support.js';
import { launchParams } from '../../../tests/fixtures.support.js';
import { onSend, reply, sdk } from '../../../tests/sdk.support.js';
import { BridgeResponseError, ClientDisposedError, createMiniBridge } from '../../index.js';
import type { MiniBridge } from '../../index.js';

describe('authorization and token cache', () => {
  let vk: MiniBridge;

  beforeEach(() => {
    vi.useFakeTimers();
    reply('VKWebAppGetLaunchParams', launchParams);
    reply('VKWebAppGetAuthToken', { access_token: 'token-a', scope: '' });
    reply('VKWebAppCallAPIMethod', { response: { ok: true } });
    vk = createMiniBridge({ api: { minIntervalMs: 0 } });
  });

  afterEach(() => {
    vk.dispose();
  });

  it('authorizes lazily and shares the cached token between authorize and API calls', async () => {
    expect(sdk.send).not.toHaveBeenCalled();
    await expect(vk.api.call('users.get', { user_ids: '1' })).resolves.toEqual({ ok: true });
    await vk.api.call('users.get', { user_ids: '2' });
    await expect(vk.api.authorize()).resolves.toEqual({ access_token: 'token-a', scope: '' });

    expect(sdk.send.mock.calls).toEqual([
      ['VKWebAppGetLaunchParams', undefined],
      ['VKWebAppGetAuthToken', { app_id: 123, scope: '' }],
      ['VKWebAppCallAPIMethod', {
        method: 'users.get', params: { user_ids: '1', access_token: 'token-a', v: '5.199' },
      }],
      ['VKWebAppCallAPIMethod', {
        method: 'users.get', params: { user_ids: '2', access_token: 'token-a', v: '5.199' },
      }],
    ]);
  });

  it('normalizes scopes and combines concurrent requests for the same permissions', async () => {
    const authorization = deferred<unknown>();
    reply('VKWebAppGetAuthToken', authorization.promise);
    const first = vk.api.authorize({ scopes: ['wall', ' friends ', 'wall'] });
    const second = vk.api.authorize({ scopes: ['friends', 'wall'] });
    const call = vk.api.call('wall.get', {}, { scopes: ['wall', 'friends'] });
    await vi.advanceTimersByTimeAsync(0);

    expect(sdk.send.mock.calls).toEqual([
      ['VKWebAppGetLaunchParams', undefined],
      ['VKWebAppGetAuthToken', { app_id: 123, scope: 'friends,wall' }],
    ]);

    const response = { access_token: 'token-a', scope: 'wall,friends', expires: 3600 };
    authorization.resolve(response);
    const authorized = await first;
    expect(authorized).toEqual(response);
    expect(Object.isFrozen(authorized)).toBe(true);
    await expect(second).resolves.toBe(authorized);
    await expect(call).resolves.toEqual({ ok: true });
    expect(sdk.send).toHaveBeenCalledTimes(3);
  });

  it('serializes different permission dialogs and never sends a call with insufficient scopes', async () => {
    const firstDialog = deferred<unknown>();
    const secondDialog = deferred<unknown>();

    const authorize = vi.fn()
      .mockReturnValueOnce(firstDialog.promise)
      .mockReturnValueOnce(secondDialog.promise);

    onSend('VKWebAppGetAuthToken', (props) => authorize(props));
    const first = vk.api.call('friends.get', {}, { scopes: ['friends'] });
    const second = vk.api.call('wall.get', {}, { scopes: ['wall'] });
    await vi.advanceTimersByTimeAsync(0);
    expect(authorize.mock.calls).toEqual([[{ app_id: 123, scope: 'friends' }]]);

    firstDialog.resolve({ access_token: 'friends-token', scope: 'friends' });
    await expect(first).resolves.toEqual({ ok: true });
    await vi.advanceTimersByTimeAsync(0);

    expect(authorize.mock.calls).toEqual([
      [{ app_id: 123, scope: 'friends' }], [{ app_id: 123, scope: 'wall' }],
    ]);

    expect(sdk.send.mock.calls.filter(([method]) => method === 'VKWebAppCallAPIMethod')).toEqual([
      ['VKWebAppCallAPIMethod', {
        method: 'friends.get', params: { access_token: 'friends-token', v: '5.199' },
      }],
    ]);

    secondDialog.resolve({ access_token: 'wall-token', scope: 'wall' });
    await expect(second).resolves.toEqual({ ok: true });

    expect(sdk.send).toHaveBeenLastCalledWith('VKWebAppCallAPIMethod', {
      method: 'wall.get', params: { access_token: 'wall-token', v: '5.199' },
    });
  });

  it('reuses actually granted superset permissions after a pending authorization', async () => {
    const authorization = deferred<unknown>();
    reply('VKWebAppGetAuthToken', authorization.promise);
    const first = vk.api.authorize({ scopes: ['friends'] });
    const second = vk.api.authorize({ scopes: ['wall'] });
    await vi.advanceTimersByTimeAsync(0);
    authorization.resolve({ access_token: 'token-a', scope: ' friends, wall,wall, ' });
    await expect(second).resolves.toBe(await first);
    await vk.api.call('wall.get', {}, { scopes: ['wall'] });
    expect(sdk.send.mock.calls.filter(([method]) => method === 'VKWebAppGetAuthToken')).toHaveLength(1);
  });

  it('rejects partially granted permissions with the original response and does not cache them', async () => {
    const response = { access_token: 'partial-token', scope: 'friends' };
    reply('VKWebAppGetAuthToken', response);
    const call = vk.api.call('wall.get', {}, { scopes: ['friends', 'wall'] });
    await expect(call).rejects.toBeInstanceOf(BridgeResponseError);

    await expect(call).rejects.toMatchObject({
      method: 'VKWebAppGetAuthToken', response, cause: response,
    });

    expect(sdk.send).toHaveBeenCalledTimes(2);

    reply('VKWebAppGetAuthToken', { access_token: 'complete-token', scope: 'friends,wall' });
    await vk.api.call('wall.get', {}, { scopes: ['wall'] });
    expect(sdk.send.mock.calls.filter(([method]) => method === 'VKWebAppGetAuthToken')).toHaveLength(2);
  });

  it('rejects all waiters after denied authorization and allows an explicit new attempt', async () => {
    const dialog = deferred<unknown>();
    const refusal = { error_type: 'auth_error', error_data: { error_code: 4 } };
    reply('VKWebAppGetAuthToken', dialog.promise);
    const first = vk.api.authorize({ scopes: ['friends'] });
    const second = vk.api.call('wall.get', {}, { scopes: ['wall'] });

    const rejected = Promise.all([
      expect(first).rejects.toBe(refusal), expect(second).rejects.toBe(refusal),
    ]);

    await vi.advanceTimersByTimeAsync(0);
    dialog.reject(refusal);
    await rejected;
    expect(sdk.send).toHaveBeenCalledTimes(2);

    reply('VKWebAppGetAuthToken', { access_token: 'allowed-token', scope: 'wall' });

    await expect(vk.api.authorize({ scopes: ['wall'] })).resolves.toEqual({
      access_token: 'allowed-token', scope: 'wall',
    });

    expect(sdk.send).toHaveBeenCalledTimes(3);
  });

  it.each([
    { name: 'undefined', response: undefined },
    { name: 'null', response: null },
    { name: 'primitive', response: 'token-a' },
    { name: 'missing token', response: { scope: '' } },
    { name: 'non-string token', response: { access_token: 123, scope: '' } },
    { name: 'empty token', response: { access_token: '', scope: '' } },
    { name: 'whitespace token', response: { access_token: ' \t ', scope: '' } },
    { name: 'missing scope', response: { access_token: 'token-a' } },
    { name: 'non-string scope', response: { access_token: 'token-a', scope: [] } },
    { name: 'inactive status', response: { access_token: 'token-a', scope: '', status: false } },
  ])('rejects a malformed authorization response: $name', async ({ response }) => {
    reply('VKWebAppGetAuthToken', response);
    const call = vk.api.call('users.get');
    await expect(call).rejects.toBeInstanceOf(BridgeResponseError);
    await expect(call).rejects.toMatchObject({ method: 'VKWebAppGetAuthToken' });
    const error: unknown = await call.catch((reason: unknown) => reason);
    assert.instanceOf(error, BridgeResponseError);
    expect(error.response).toBe(response);
    expect(error.cause).toBe(response);
    expect(sdk.send).toHaveBeenCalledTimes(2);
  });

  it.each(['', '  ', 'friends,wall', 'friends wall', 'friends\nwall'])('rejects invalid scope %j before SDK calls', async (scope) => {
    await expect(vk.api.authorize({ scopes: [scope] })).rejects.toBeInstanceOf(TypeError);
    await expect(vk.api.call('users.get', {}, { scopes: [scope] })).rejects.toBeInstanceOf(TypeError);
    expect(sdk.send).not.toHaveBeenCalled();
  });

  it.each([
    { vk_app_id: 0, vk_user_id: 456 },
    { vk_app_id: -1, vk_user_id: 456 },
    { vk_app_id: 1.5, vk_user_id: 456 },
    { vk_app_id: Number.NaN, vk_user_id: 456 },
    { vk_app_id: 123, vk_user_id: 0 },
    { vk_app_id: 123, vk_user_id: Number.MAX_SAFE_INTEGER + 1 },
  ])('rejects invalid authorization context $vk_app_id:$vk_user_id', async (context) => {
    reply('VKWebAppGetLaunchParams', { ...launchParams, ...context });

    await expect(vk.api.authorize()).rejects.toMatchObject({
      name: 'BridgeResponseError', method: 'VKWebAppGetLaunchParams',
    });

    expect(sdk.send.mock.calls).toEqual([['VKWebAppGetLaunchParams', undefined]]);
  });

  it.each([
    { vk_app_id: 123, vk_user_id: 789 },
    { vk_app_id: 321, vk_user_id: 456 },
  ])('acquires another token after launch context changes to $vk_app_id:$vk_user_id', async (context) => {
    await vk.api.authorize();
    reply('VKWebAppGetLaunchParams', { ...launchParams, ...context });
    await vk.launch.get({ refresh: true });
    reply('VKWebAppGetAuthToken', { access_token: 'new-context-token', scope: '' });
    await vk.api.call('users.get');

    expect(sdk.send.mock.calls.filter(([method]) => method === 'VKWebAppGetAuthToken')).toEqual([
      ['VKWebAppGetAuthToken', { app_id: 123, scope: '' }],
      ['VKWebAppGetAuthToken', { app_id: context.vk_app_id, scope: '' }],
    ]);

    expect(sdk.send).toHaveBeenLastCalledWith('VKWebAppCallAPIMethod', {
      method: 'users.get', params: { access_token: 'new-context-token', v: '5.199' },
    });
  });

  it('does not use an in-flight authorization after launch context changes', async () => {
    const dialog = deferred<unknown>();
    reply('VKWebAppGetAuthToken', dialog.promise);
    const call = vk.api.call('users.get');
    await vi.advanceTimersByTimeAsync(0);
    reply('VKWebAppGetLaunchParams', { ...launchParams, vk_app_id: 321, vk_user_id: 789 });
    await vk.launch.get({ refresh: true });
    reply('VKWebAppGetAuthToken', { access_token: 'new-context-token', scope: '' });
    dialog.resolve({ access_token: 'old-context-token', scope: '' });
    await expect(call).resolves.toEqual({ ok: true });

    expect(sdk.send.mock.calls.filter(([method]) => method === 'VKWebAppGetAuthToken')).toEqual([
      ['VKWebAppGetAuthToken', { app_id: 123, scope: '' }],
      ['VKWebAppGetAuthToken', { app_id: 321, scope: '' }],
    ]);

    expect(sdk.send.mock.calls.filter(([method]) => method === 'VKWebAppCallAPIMethod')).toEqual([
      ['VKWebAppCallAPIMethod', {
        method: 'users.get', params: { access_token: 'new-context-token', v: '5.199' },
      }],
    ]);
  });

  it('keeps authorization caches isolated between clients', async () => {
    const other = createMiniBridge({ api: { minIntervalMs: 0 } });

    onTestFinished(() => {
      other.dispose();
    });

    const firstToken = await vk.api.authorize();
    reply('VKWebAppGetAuthToken', { access_token: 'token-b', scope: '' });
    const secondToken = await other.api.authorize();
    expect(firstToken.access_token).toBe('token-a');
    expect(secondToken.access_token).toBe('token-b');
    await expect(vk.api.authorize()).resolves.toBe(firstToken);
    await expect(other.api.authorize()).resolves.toBe(secondToken);
    expect(sdk.send.mock.calls.filter(([method]) => method === 'VKWebAppGetAuthToken')).toHaveLength(2);
  });

  it('ends pending authorization on disposal and ignores late results without sending API requests', async () => {
    const dialog = deferred<unknown>();
    reply('VKWebAppGetAuthToken', dialog.promise);
    const authorization = vk.api.authorize();
    const call = vk.api.call('users.get');

    const rejected = Promise.all([
      expect(authorization).rejects.toBeInstanceOf(ClientDisposedError),
      expect(call).rejects.toBeInstanceOf(ClientDisposedError),
    ]);

    await vi.advanceTimersByTimeAsync(0);
    vk.dispose();
    await rejected;
    dialog.resolve({ access_token: 'late-token', scope: '' });
    await vi.advanceTimersByTimeAsync(0);
    await expect(vk.api.authorize()).rejects.toBeInstanceOf(ClientDisposedError);
    await expect(vk.api.call('users.get')).rejects.toBeInstanceOf(ClientDisposedError);
    expect(sdk.send).toHaveBeenCalledTimes(2);
  });

  it('does not open authorization if disposed while launch parameters are pending', async () => {
    const launch = deferred<unknown>();
    reply('VKWebAppGetLaunchParams', launch.promise);
    const call = vk.api.authorize();
    const rejected = expect(call).rejects.toBeInstanceOf(ClientDisposedError);
    vk.dispose();
    await rejected;
    launch.resolve(launchParams);
    await vi.advanceTimersByTimeAsync(0);
    expect(sdk.send.mock.calls).toEqual([['VKWebAppGetLaunchParams', undefined]]);
  });

  it('preserves a newer authorization when an old request fails and VK reused the token string', async () => {
    const oldRequest = deferred<unknown>();
    let apiCalls = 0;
    const authorize = vi.fn((scope: string) => ({ access_token: 'same-token', scope }));
    onSend('VKWebAppGetAuthToken', (props) => authorize(props?.scope ?? ''));

    onSend('VKWebAppCallAPIMethod', () => {
      apiCalls += 1;

      return apiCalls === 1 ? oldRequest.promise : { response: 'retried' };
    });

    const oldCall = vk.api.call('users.get', {}, { scopes: ['friends'] });
    await vi.advanceTimersByTimeAsync(0);
    expect(apiCalls).toBe(1);

    const newerAuthorization = await vk.api.authorize({ scopes: ['friends', 'wall'] });
    expect(authorize.mock.calls).toEqual([['friends'], ['friends,wall']]);
    oldRequest.reject({ error_type: 'api_error', error_data: { error_code: 5 } });

    await expect(oldCall).resolves.toBe('retried');
    await expect(vk.api.authorize({ scopes: ['wall'] })).resolves.toBe(newerAuthorization);
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(apiCalls).toBe(2);
  });

  it('invalidates older entries with the same token when the newer authorization fails', async () => {
    const invalidToken = { error_type: 'api_error', error_data: { error_code: 5 } };
    let authorizations = 0;

    onSend('VKWebAppGetAuthToken', (props) => {
      authorizations += 1;

      return authorizations <= 2
        ? { access_token: 'same-token', scope: props?.scope ?? '' }
        : { access_token: 'new-token', scope: 'friends,wall' };
    });

    const callApi = vi.fn()
      .mockRejectedValueOnce(invalidToken)
      .mockResolvedValue({ response: 'retried' });

    onSend('VKWebAppCallAPIMethod', callApi);
    await vk.api.authorize({ scopes: ['friends'] });
    await vk.api.authorize({ scopes: ['friends', 'wall'] });
    await expect(vk.api.call('wall.get', {}, { scopes: ['wall'] })).resolves.toBe('retried');
    await expect(vk.api.authorize({ scopes: ['friends'] })).resolves.toMatchObject({ access_token: 'new-token' });
    expect(authorizations).toBe(3);
    expect(callApi).toHaveBeenCalledTimes(2);
  });
});
