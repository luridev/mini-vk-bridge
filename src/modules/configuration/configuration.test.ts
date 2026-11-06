import { afterEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '../../../tests/deferred.support.js';
import { darkConfig, lightConfig } from '../../../tests/fixtures.support.js';
import { emit, onSend, reply, sdk } from '../../../tests/sdk.support.js';
import { ClientDisposedError, createMiniBridge } from '../../index.js';
import type { MiniBridge, MiniBridgeOptions } from '../../client/types.js';

const clients: Array<MiniBridge> = [];

function createClient(options?: MiniBridgeOptions): MiniBridge {
  const client = createMiniBridge(options);
  clients.push(client);

  return client;
}

afterEach(() => {
  for (const client of clients.splice(0)) {
    client.dispose();
  }
});

describe('configuration', () => {
  it('starts without a snapshot and notifies subscribers when the initial query resolves', async () => {
    reply('VKWebAppGetConfig', lightConfig);
    const client = createClient();
    const listener = vi.fn();
    expect(client.config.snapshot()).toBeUndefined();
    client.config.subscribe(listener);
    expect(listener).not.toHaveBeenCalled();
    const snapshot = await client.config.get();
    expect(snapshot).toEqual(lightConfig);
    expect(client.config.snapshot()).toBe(snapshot);
    expect(listener).toHaveBeenCalledExactlyOnceWith(snapshot);
    expect(sdk.send).toHaveBeenCalledExactlyOnceWith('VKWebAppGetConfig', undefined);
  });

  it('honors immediate true and false for a known snapshot', () => {
    const client = createClient();
    emit({ detail: { type: 'VKWebAppUpdateConfig', data: lightConfig } });
    const immediate = vi.fn();
    const changesOnly = vi.fn();
    client.config.subscribe(immediate, { immediate: true });
    client.config.subscribe(changesOnly, { immediate: false });
    expect(immediate).toHaveBeenCalledExactlyOnceWith(lightConfig);
    expect(changesOnly).not.toHaveBeenCalled();
    emit({ detail: { type: 'VKWebAppUpdateConfig', data: darkConfig } });
    expect(immediate).toHaveBeenLastCalledWith(darkConfig);
    expect(changesOnly).toHaveBeenCalledExactlyOnceWith(darkConfig);
    expect(client.config.snapshot()).toEqual(darkConfig);
  });

  it('coalesces concurrent reads and permits a new explicit query after settlement', async () => {
    const request = deferred<unknown>();
    onSend('VKWebAppGetConfig', () => request.promise);
    const client = createClient();
    const first = client.config.get();
    const second = client.config.get();
    expect(sdk.send).toHaveBeenCalledTimes(1);
    request.resolve(lightConfig);
    const [initial, concurrent] = await Promise.all([first, second]);
    expect(concurrent).toBe(initial);
    reply('VKWebAppGetConfig', darkConfig);
    await expect(client.config.get()).resolves.toEqual(darkConfig);
    expect(sdk.send).toHaveBeenCalledTimes(2);
  });

  it('does not overwrite an UpdateConfig event with a late GetConfig response', async () => {
    const request = deferred<unknown>();
    onSend('VKWebAppGetConfig', () => request.promise);
    const client = createClient();
    const listener = vi.fn();
    client.config.subscribe(listener);
    const initial = client.config.get();
    emit({ detail: { type: 'VKWebAppUpdateConfig', data: darkConfig } });
    request.resolve(lightConfig);
    await expect(initial).resolves.toEqual(darkConfig);
    expect(client.config.snapshot()).toEqual(darkConfig);
    expect(listener).toHaveBeenCalledExactlyOnceWith(darkConfig);
  });

  it('keeps a newer event snapshot on query failure and permits a later retry', async () => {
    const request = deferred<unknown>();
    onSend('VKWebAppGetConfig', () => request.promise);
    const client = createClient();
    const error = { failure: 'GetConfig' };
    const failed = expect(client.config.get()).rejects.toBe(error);
    emit({ detail: { type: 'VKWebAppUpdateConfig', data: darkConfig } });
    request.reject(error);
    await failed;
    expect(client.config.snapshot()).toEqual(darkConfig);
    reply('VKWebAppGetConfig', lightConfig);
    await expect(client.config.get()).resolves.toEqual(lightConfig);
    expect(client.config.snapshot()).toEqual(lightConfig);
  });

  it('does not cache failure of the first query', async () => {
    const request = deferred<unknown>();
    onSend('VKWebAppGetConfig', () => request.promise);
    const client = createClient();
    const failed = expect(client.config.get()).rejects.toBe('unavailable');
    request.reject('unavailable');
    await failed;
    expect(client.config.snapshot()).toBeUndefined();
    reply('VKWebAppGetConfig', lightConfig);
    await expect(client.config.get()).resolves.toEqual(lightConfig);
  });

  it('uses independent subscriptions and idempotent unsubscribe for identical callbacks', () => {
    const client = createClient();
    const listener = vi.fn();
    const stopFirst = client.config.subscribe(listener);
    const stopSecond = client.config.subscribe(listener);
    stopFirst();
    stopFirst();
    emit({ detail: { type: 'VKWebAppUpdateConfig', data: lightConfig } });
    expect(listener).toHaveBeenCalledTimes(1);
    stopSecond();
    emit({ detail: { type: 'VKWebAppUpdateConfig', data: darkConfig } });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('skips a subscription removed earlier during the same config delivery', () => {
    const client = createClient();
    const second = vi.fn();
    let stopSecond: () => void = () => undefined;

    client.config.subscribe(() => {
      stopSecond();
    });

    stopSecond = client.config.subscribe(second);
    emit({ detail: { type: 'VKWebAppUpdateConfig', data: lightConfig } });
    expect(second).not.toHaveBeenCalled();
  });

  it('stops delivery to later config subscribers when a subscriber disposes the client', () => {
    const client = createClient();
    const second = vi.fn();

    client.config.subscribe(() => {
      client.dispose();
    });

    client.config.subscribe(second);
    emit({ detail: { type: 'VKWebAppUpdateConfig', data: lightConfig } });
    expect(second).not.toHaveBeenCalled();
  });

  it('reports config listener errors once for immediate, event and query delivery', async () => {
    const error: unknown = { failure: 'configuration subscriber' };
    const reporter = vi.fn();
    const client = createClient({ onListenerError: reporter });
    emit({ detail: { type: 'VKWebAppUpdateConfig', data: lightConfig } });

    const throwing = vi.fn(() => {
      throw error;
    });

    const next = vi.fn();
    client.config.subscribe(throwing);
    client.config.subscribe(next, { immediate: false });
    expect(reporter).toHaveBeenCalledExactlyOnceWith(error);
    emit({ detail: { type: 'VKWebAppUpdateConfig', data: darkConfig } });
    expect(reporter).toHaveBeenCalledTimes(2);
    expect(next).toHaveBeenCalledExactlyOnceWith(darkConfig);
    reply('VKWebAppGetConfig', lightConfig);
    await expect(client.config.get()).resolves.toEqual(lightConfig);
    expect(reporter).toHaveBeenCalledTimes(3);
    expect(throwing).toHaveBeenCalledTimes(3);
    expect(next).toHaveBeenLastCalledWith(lightConfig);
  });

  it('does not double-report a nested config reporter failure through transport', () => {
    const tasks: Array<() => void> = [];

    vi.stubGlobal('queueMicrotask', (task: () => void) => {
      tasks.push(task);
    });

    const initialError: unknown = { failure: 'subscriber' };
    const reporterError = new Error('reporter failed');

    const reporter = vi.fn(() => {
      throw reporterError;
    });

    const client = createClient({ onListenerError: reporter });
    const configNext = vi.fn();
    const eventNext = vi.fn();

    client.config.subscribe(() => {
      throw initialError;
    });

    client.config.subscribe(configNext);
    client.on('VKWebAppUpdateConfig', eventNext);
    emit({ detail: { type: 'VKWebAppUpdateConfig', data: lightConfig } });
    expect(reporter).toHaveBeenCalledExactlyOnceWith(initialError);
    expect(configNext).toHaveBeenCalledExactlyOnceWith(lightConfig);
    expect(eventNext).toHaveBeenCalledExactlyOnceWith(lightConfig);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toThrow(reporterError);
  });

  it('stops subscriptions and pending config waits on dispose without accepting late responses', async () => {
    const request = deferred<unknown>();
    onSend('VKWebAppGetConfig', () => request.promise);
    const client = createClient();
    const listener = vi.fn();
    const stop = client.config.subscribe(listener);
    const failed = expect(client.config.get()).rejects.toBeInstanceOf(ClientDisposedError);
    client.dispose();
    await failed;
    emit({ detail: { type: 'VKWebAppUpdateConfig', data: darkConfig } });
    request.resolve(lightConfig);
    await request.promise;
    expect(listener).not.toHaveBeenCalled();
    expect(() => client.config.snapshot()).toThrow(ClientDisposedError);
    expect(() => client.config.subscribe(listener)).toThrow(ClientDisposedError);
    await expect(client.config.get()).rejects.toBeInstanceOf(ClientDisposedError);
    expect(stop).not.toThrow();
  });
});
