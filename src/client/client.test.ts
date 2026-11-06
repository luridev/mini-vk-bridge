import { afterEach, describe, expect, it } from 'vitest';
import { deferred } from '../../tests/deferred.support.js';
import { onSend, reply, sdk, subscriberCount } from '../../tests/sdk.support.js';
import { BridgeResponseError, ClientDisposedError, createMiniBridge } from '../index.js';
import type { MiniBridge } from './types.js';

const clients: Array<MiniBridge> = [];

function createClient(): MiniBridge {
  const client = createMiniBridge();
  clients.push(client);

  return client;
}

afterEach(() => {
  for (const client of clients.splice(0)) {
    client.dispose();
  }
});

describe('client lifecycle', () => {
  it('creates a client without sending SDK commands', () => {
    const client = createClient();
    expect(client.config.snapshot()).toBeUndefined();
    expect(sdk.send).not.toHaveBeenCalled();
    expect(subscriberCount()).toBe(1);
  });

  it('requires a browser environment', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Reflect.deleteProperty(globalThis, 'window');

    try {
      expect(() => createMiniBridge()).toThrow(Error);
      expect(sdk.subscribe).not.toHaveBeenCalled();
    } finally {
      if (descriptor !== undefined) {
        Object.defineProperty(globalThis, 'window', descriptor);
      }
    }
  });

  it('coalesces concurrent init calls and caches their successful SDK response', async () => {
    const response = { result: true };
    const request = deferred<unknown>();
    onSend('VKWebAppInit', () => request.promise);
    const client = createClient();
    const first = client.init();
    const second = client.init();
    expect(second).toBe(first);
    expect(sdk.send).toHaveBeenCalledExactlyOnceWith('VKWebAppInit', undefined);
    request.resolve(response);
    await expect(first).resolves.toBe(response);
    await expect(second).resolves.toBe(response);
    await expect(client.init()).resolves.toBe(response);
    expect(sdk.send).toHaveBeenCalledTimes(1);
  });

  it('preserves initialization rejection and permits a later explicit retry', async () => {
    const error = { error_type: 'client_error', error_data: { error_code: 1 } };
    const request = deferred<unknown>();
    onSend('VKWebAppInit', () => request.promise);
    const client = createClient();
    const first = client.init();
    const second = client.init();
    const failed = Promise.all([expect(first).rejects.toBe(error), expect(second).rejects.toBe(error)]);
    request.reject(error);
    await failed;
    reply('VKWebAppInit', { result: true });
    await expect(client.init()).resolves.toEqual({ result: true });
    expect(sdk.send).toHaveBeenCalledTimes(2);
  });

  it.each([null, false, {}, { result: false }, { result: 'true' }])(
    'rejects malformed fulfilled init response %j without caching it', async (response) => {
      reply('VKWebAppInit', response);
      const client = createClient();
      const failure = client.init();
      await expect(failure).rejects.toBeInstanceOf(BridgeResponseError);
      await expect(failure).rejects.toMatchObject({ method: 'VKWebAppInit', response, cause: response });
      reply('VKWebAppInit', { result: true });
      await expect(client.init()).resolves.toEqual({ result: true });
    },
  );

  it('keeps initialization state and SDK subscriptions independent between clients', async () => {
    reply('VKWebAppInit', { result: true });
    const first = createClient();
    const second = createClient();
    await Promise.all([first.init(), second.init()]);
    expect(sdk.send).toHaveBeenCalledTimes(2);
    first.dispose();
    first.dispose();
    expect(subscriberCount()).toBe(1);
    await expect(first.init()).rejects.toBeInstanceOf(ClientDisposedError);
    await expect(second.init()).resolves.toEqual({ result: true });
    expect(sdk.send).toHaveBeenCalledTimes(2);
  });

  it('ends a pending init wait on dispose and does not revive on a late response', async () => {
    const request = deferred<unknown>();
    onSend('VKWebAppInit', () => request.promise);
    const client = createClient();
    const failed = expect(client.init()).rejects.toBeInstanceOf(ClientDisposedError);
    client.dispose();
    await failed;
    request.resolve({ result: true });
    await request.promise;
    await expect(client.init()).rejects.toBeInstanceOf(ClientDisposedError);
    expect(sdk.send).toHaveBeenCalledTimes(1);
    expect(subscriberCount()).toBe(0);
  });

  it('rejects new async operations and synchronous reads after dispose', async () => {
    const client = createClient();
    client.dispose();
    await expect(client.send('VKWebAppCopyText', { text: 'hello' })).rejects.toBeInstanceOf(ClientDisposedError);
    await expect(client.supports('VKWebAppDownloadFile')).rejects.toBeInstanceOf(ClientDisposedError);
    await expect(client.launch.get()).rejects.toBeInstanceOf(ClientDisposedError);
    await expect(client.config.get()).rejects.toBeInstanceOf(ClientDisposedError);
    await expect(client.storage.getMany([])).rejects.toBeInstanceOf(ClientDisposedError);
    await expect(client.storage.set('key', 'value')).rejects.toBeInstanceOf(ClientDisposedError);
    await expect(client.api.authorize()).rejects.toBeInstanceOf(ClientDisposedError);
    await expect(client.api.call('users.get')).rejects.toBeInstanceOf(ClientDisposedError);
    expect(() => client.launch.query()).toThrow(ClientDisposedError);
    expect(() => client.config.snapshot()).toThrow(ClientDisposedError);
    expect(() => client.config.subscribe(() => undefined)).toThrow(ClientDisposedError);
    expect(() => client.on('VKWebAppUpdateConfig', () => undefined)).toThrow(ClientDisposedError);
    expect(sdk.send).not.toHaveBeenCalled();
    expect(sdk.supportsAsync).not.toHaveBeenCalled();
  });
});
