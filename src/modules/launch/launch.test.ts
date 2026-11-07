import { afterEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '../../../tests/deferred.support.js';
import { launchParams } from '../../../tests/fixtures.support.js';
import { onSend, reply, sdk } from '../../../tests/sdk.support.js';
import { ClientDisposedError, createMiniBridge } from '../../index.js';
import type { MiniBridge } from '../../client/types.js';

const clients: Array<MiniBridge> = [];

function createClient(): MiniBridge {
  const client = createMiniBridge();
  clients.push(client);

  return client;
}

describe('launch parameters', () => {
  afterEach(() => {
    for (const client of clients.splice(0)) {
      client.dispose();
    }
  });

  it('keeps the original query bytes and returns independent decoded views', () => {
    const query = '?custom=%2B&custom=second&vk_app_id=00123&space=a+b';
    vi.stubGlobal('window', { location: { search: query } });
    const client = createClient();
    const first = client.launch.query();
    first.set('custom', 'changed');
    vi.stubGlobal('window', { location: { search: '?different=query' } });
    expect(client.launch.rawQuery).toBe(query);
    expect(client.launch.query().getAll('custom')).toStrictEqual(['+', 'second']);
    expect(client.launch.query().get('vk_app_id')).toBe('00123');
    expect(client.launch.query().get('space')).toBe('a b');
    expect(sdk.send).not.toHaveBeenCalled();
  });

  it('coalesces concurrent reads and caches the successful structured snapshot', async () => {
    const request = deferred<unknown>();
    onSend('VKWebAppGetLaunchParams', () => request.promise);
    const client = createClient();
    const first = client.launch.get();
    const second = client.launch.get();
    expect(sdk.send).toHaveBeenCalledExactlyOnceWith('VKWebAppGetLaunchParams', undefined);
    request.resolve(launchParams);
    const [initial, concurrent] = await Promise.all([first, second]);
    expect(initial).toStrictEqual(launchParams);
    expect(concurrent).toBe(initial);
    await expect(client.launch.get()).resolves.toBe(initial);
    expect(sdk.send).toHaveBeenCalledOnce();
  });

  it('refreshes a cached snapshot and lets ordinary reads join the refresh', async () => {
    reply('VKWebAppGetLaunchParams', launchParams);
    const client = createClient();
    await client.launch.get();
    const request = deferred<unknown>();
    onSend('VKWebAppGetLaunchParams', () => request.promise);
    const refresh = client.launch.get({ refresh: true });
    const concurrent = client.launch.get();
    const next = { ...launchParams, vk_user_id: 789 };
    request.resolve(next);
    await expect(refresh).resolves.toStrictEqual(next);
    await expect(concurrent).resolves.toStrictEqual(next);
    await expect(client.launch.get()).resolves.toStrictEqual(next);
    expect(sdk.send).toHaveBeenCalledTimes(2);
  });

  it('preserves SDK rejection and retries an unsuccessful initial read', async () => {
    const error = { error_type: 'client_error', error_data: { error_code: 7 } };
    const request = deferred<unknown>();
    onSend('VKWebAppGetLaunchParams', () => request.promise);
    const client = createClient();
    const failed = client.launch.get();
    request.reject(error);
    await expect(failed).rejects.toBe(error);
    reply('VKWebAppGetLaunchParams', launchParams);
    await expect(client.launch.get()).resolves.toStrictEqual(launchParams);
    expect(sdk.send).toHaveBeenCalledTimes(2);
  });

  it('retains the previous snapshot after a failed refresh', async () => {
    reply('VKWebAppGetLaunchParams', launchParams);
    const client = createClient();
    const initial = await client.launch.get();
    const request = deferred<unknown>();
    onSend('VKWebAppGetLaunchParams', () => request.promise);
    const failed = client.launch.get({ refresh: true });
    request.reject('refresh failed');
    await expect(failed).rejects.toBe('refresh failed');
    await expect(client.launch.get()).resolves.toBe(initial);
    expect(sdk.send).toHaveBeenCalledTimes(2);
  });

  it('ends pending reads on disposal and ignores their late SDK result', async () => {
    const request = deferred<unknown>();
    onSend('VKWebAppGetLaunchParams', () => request.promise);
    const client = createClient();
    const failed = client.launch.get();
    client.dispose();
    await expect(failed).rejects.toBeInstanceOf(ClientDisposedError);
    request.resolve(launchParams);
    await request.promise;
    await expect(client.launch.get()).rejects.toBeInstanceOf(ClientDisposedError);
    expect(() => client.launch.query()).toThrow(ClientDisposedError);
    expect(sdk.send).toHaveBeenCalledOnce();
  });
});
