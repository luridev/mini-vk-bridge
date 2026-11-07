import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '../../../tests/deferred.support.js';
import { launchParams } from '../../../tests/fixtures.support.js';
import { onSend, reply, sdk } from '../../../tests/sdk.support.js';
import { createMiniBridge } from '../../client/client.js';
import { ClientDisposedError } from '../../errors/errors.js';
import { createScheduler } from './scheduler.js';
import type { MiniBridge } from '../../client/types.js';

describe('API dispatch scheduler', () => {
  let lifetime: AbortController;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    lifetime = new AbortController();
  });

  afterEach(() => {
    lifetime.abort();
  });

  it('dispatches an isolated request immediately and preserves its result', async () => {
    const scheduler = createScheduler(500, lifetime.signal);
    const result = { response: 'first' };
    const dispatch = vi.fn(() => Promise.resolve(result));
    const request = scheduler.enqueue(dispatch);

    expect(dispatch).toHaveBeenCalledOnce();
    expect(performance.now()).toBe(0);
    await expect(request).resolves.toBe(result);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('dispatches ready requests FIFO at actual intervals even while the first hangs', async () => {
    const scheduler = createScheduler(500, lifetime.signal);
    const firstReply = deferred<string>();
    const secondReply = deferred<string>();
    const thirdReply = deferred<string>();
    const starts: Array<[string, number]> = [];

    const first = scheduler.enqueue(() => {
      starts.push(['first', performance.now()]);

      return firstReply.promise;
    });

    const second = scheduler.enqueue(() => {
      starts.push(['second', performance.now()]);

      return secondReply.promise;
    });

    const third = scheduler.enqueue(() => {
      starts.push(['third', performance.now()]);

      return thirdReply.promise;
    });

    expect(starts).toStrictEqual([['first', 0]]);
    await vi.advanceTimersByTimeAsync(499);
    expect(starts).toStrictEqual([['first', 0]]);
    await vi.advanceTimersByTimeAsync(1);
    expect(starts).toStrictEqual([['first', 0], ['second', 500]]);
    await vi.advanceTimersByTimeAsync(500);
    expect(starts).toStrictEqual([['first', 0], ['second', 500], ['third', 1000]]);

    thirdReply.resolve('third');
    await expect(third).resolves.toBe('third');
    secondReply.resolve('second');
    await expect(second).resolves.toBe('second');
    firstReply.resolve('first');
    await expect(first).resolves.toBe('first');
  });

  it('allows every ready operation to dispatch immediately with interval zero', async () => {
    const scheduler = createScheduler(0, lifetime.signal);
    const starts: Array<number> = [];

    const requests = Array.from({ length: 3 }, (_, index) => scheduler.enqueue(() => {
      starts.push(performance.now());

      return Promise.resolve(index);
    }));

    expect(starts).toStrictEqual([0, 0, 0]);
    expect(vi.getTimerCount()).toBe(0);
    await expect(Promise.all(requests)).resolves.toStrictEqual([0, 1, 2]);
  });

  it('spaces overdue work from the actual resume time without a catch-up burst', async () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const scheduler = createScheduler(500, lifetime.signal);
    const starts: Array<number> = [];

    const requests = Array.from({ length: 4 }, () => scheduler.enqueue(() => {
      starts.push(performance.now());

      return Promise.resolve();
    }));

    now = 5000;
    await vi.advanceTimersByTimeAsync(500);
    expect(starts).toStrictEqual([0, 5000]);

    now = 5499;
    await vi.advanceTimersByTimeAsync(499);
    expect(starts).toStrictEqual([0, 5000]);
    now = 5500;
    await vi.advanceTimersByTimeAsync(1);
    expect(starts).toStrictEqual([0, 5000, 5500]);
    now = 6000;
    await vi.advanceTimersByTimeAsync(500);
    expect(starts).toStrictEqual([0, 5000, 5500, 6000]);
    await Promise.all(requests);
  });

  it('skips a failed preparation without consuming a dispatch slot or blocking the queue', async () => {
    const scheduler = createScheduler(500, lifetime.signal);
    const error = new Error('stale prepared request');
    const skippedDispatch = vi.fn(() => Promise.resolve('skipped'));
    const starts: Array<number> = [];
    await scheduler.enqueue(() => Promise.resolve('first'));

    const skipped = scheduler.enqueue(skippedDispatch, () => {
      throw error;
    });

    const next = scheduler.enqueue(() => {
      starts.push(performance.now());

      return Promise.resolve('next');
    });

    await Promise.all([
      expect(skipped).rejects.toBe(error),
      vi.advanceTimersByTimeAsync(500),
    ]);

    expect(skippedDispatch).not.toHaveBeenCalled();
    expect(starts).toStrictEqual([500]);
    await expect(next).resolves.toBe('next');
  });

  it('preserves synchronous dispatch errors and keeps the next dispatch interval', async () => {
    const scheduler = createScheduler(500, lifetime.signal);
    const error = new Error('synchronous SDK failure');

    const failed = scheduler.enqueue(() => {
      throw error;
    });

    const dispatch = vi.fn(() => Promise.resolve(performance.now()));
    const next = scheduler.enqueue(dispatch);

    await expect(failed).rejects.toBe(error);
    await vi.advanceTimersByTimeAsync(499);
    expect(dispatch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(next).resolves.toBe(500);
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it('rejects queued and future work on disposal while leaving the dispatched SDK promise alive', async () => {
    const scheduler = createScheduler(500, lifetime.signal);
    const sdkReply = deferred<string>();
    const active = scheduler.enqueue(() => sdkReply.promise);
    const dispatch = vi.fn(() => Promise.resolve('queued'));
    const second = scheduler.enqueue(dispatch);
    const third = scheduler.enqueue(dispatch);
    lifetime.abort();

    await Promise.all([
      expect(second).rejects.toBeInstanceOf(ClientDisposedError),
      expect(third).rejects.toBeInstanceOf(ClientDisposedError),
    ]);

    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(2000);
    expect(dispatch).not.toHaveBeenCalled();
    await expect(scheduler.enqueue(dispatch)).rejects.toBeInstanceOf(ClientDisposedError);
    sdkReply.resolve('completed after disposal');
    await expect(active).resolves.toBe('completed after disposal');
  });
});

describe('client API queue integration', () => {
  let client: MiniBridge | undefined;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    reply('VKWebAppGetLaunchParams', launchParams);
    reply('VKWebAppGetAuthToken', { access_token: 'managed-token', scope: '' });
  });

  afterEach(() => {
    client?.dispose();
    client = undefined;
  });

  it('shares one FIFO queue between high-level and raw API calls while ordinary commands bypass it', async () => {
    client = createMiniBridge({ api: { minIntervalMs: 100 } });
    const starts: Array<[string | undefined, number]> = [];

    onSend('VKWebAppCallAPIMethod', (props) => {
      starts.push([props?.method, performance.now()]);

      return { response: props?.method };
    });

    reply('VKWebAppStorageSet', { result: true });
    await client.api.authorize();

    const first = client.send('VKWebAppCallAPIMethod', {
      method: 'raw.first', params: { access_token: 'raw-token', v: '5.199' },
    });

    const second = client.api.call('managed.second');
    await vi.advanceTimersByTimeAsync(0);

    const third = client.send('VKWebAppCallAPIMethod', {
      method: 'raw.third', params: { access_token: 'raw-token', v: '5.199' },
    });

    await expect(client.send('VKWebAppStorageSet', { key: 'key', value: 'value' })).resolves.toStrictEqual({ result: true });

    expect(performance.now()).toBe(0);
    expect(starts).toStrictEqual([['raw.first', 0]]);
    expect(sdk.send).toHaveBeenCalledWith('VKWebAppStorageSet', { key: 'key', value: 'value' });
    await vi.advanceTimersByTimeAsync(100);
    expect(starts).toStrictEqual([['raw.first', 0], ['managed.second', 100]]);
    await vi.advanceTimersByTimeAsync(100);
    expect(starts).toStrictEqual([['raw.first', 0], ['managed.second', 100], ['raw.third', 200]]);

    await expect(Promise.all([first, second, third])).resolves.toStrictEqual([
      { response: 'raw.first' }, 'managed.second', { response: 'raw.third' },
    ]);

    expect(sdk.send.mock.calls.filter(([method]) => method === 'VKWebAppCallAPIMethod')).toHaveLength(3);
    expect(vi.getTimerCount()).toBe(0);
  });
});
