import { describe, expect, it, vi } from 'vitest';
import { deferred } from '../../../tests/deferred.support.js';
import { ClientDisposedError } from '../../errors/errors.js';
import { waitForRequest } from './lifecycle.js';

describe('request lifecycle', () => {
  it('observes a rejected SDK promise even when its signal was aborted before waiting', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const lifetime = new AbortController();
    const sdkReply = deferred<unknown>();
    const unhandled = vi.fn();
    lifetime.abort();
    process.on('unhandledRejection', unhandled);

    try {
      const request = waitForRequest(sdkReply.promise, lifetime.signal, { method: 'users.get', timeoutMs: 50 });
      await expect(request).rejects.toBeInstanceOf(ClientDisposedError);
      expect(vi.getTimerCount()).toBe(0);

      sdkReply.reject(new Error('late SDK rejection after early disposal'));
      await vi.advanceTimersByTimeAsync(0);

      expect(unhandled).not.toHaveBeenCalled();
      await expect(request).rejects.toBeInstanceOf(ClientDisposedError);
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});
