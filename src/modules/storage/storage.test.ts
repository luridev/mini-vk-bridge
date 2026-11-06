import { afterEach, describe, expect, it } from 'vitest';
import { deferred } from '../../../tests/deferred.support.js';
import { onSend, reply, sdk } from '../../../tests/sdk.support.js';
import { createMiniBridge } from '../../index.js';
import type { MiniBridge } from '../../client/types.js';

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

describe('string storage', () => {
  it('reads one value with the exact requested key', async () => {
    reply('VKWebAppStorageGet', { keys: [{ key: 'score', value: '42' }] });
    const client = createClient();
    await expect(client.storage.get('score')).resolves.toBe('42');
    expect(sdk.send).toHaveBeenCalledExactlyOnceWith('VKWebAppStorageGet', { keys: ['score'] });
  });

  it('reads multiple unique keys and fills missing values with empty strings', async () => {
    reply('VKWebAppStorageGet', { keys: [
      { key: 'score', value: '42' },
      { key: 'empty', value: '' },
      { key: 'unrequested', value: 'ignore' },
    ] });

    const client = createClient();

    await expect(client.storage.getMany(['score', 'empty', 'missing', 'score'])).resolves.toEqual({
      score: '42', empty: '', missing: '',
    });

    expect(sdk.send).toHaveBeenCalledExactlyOnceWith('VKWebAppStorageGet', {
      keys: ['score', 'empty', 'missing'],
    });
  });

  it('returns an empty string for a missing single key', async () => {
    reply('VKWebAppStorageGet', { keys: [] });
    await expect(createClient().storage.get('absent')).resolves.toBe('');
  });

  it('does not send a command for an empty key list', async () => {
    await expect(createClient().storage.getMany([])).resolves.toEqual({});
    expect(sdk.send).not.toHaveBeenCalled();
  });

  it('writes the supplied string and returns the unmodified SDK response', async () => {
    const response = { result: true };
    reply('VKWebAppStorageSet', response);
    await expect(createClient().storage.set('settings', '{"sound":true}')).resolves.toBe(response);

    expect(sdk.send).toHaveBeenCalledExactlyOnceWith('VKWebAppStorageSet', {
      key: 'settings', value: '{"sound":true}',
    });
  });

  it('implements remove as setting an empty string', async () => {
    const response = { result: true };
    reply('VKWebAppStorageSet', response);
    await expect(createClient().storage.remove('score')).resolves.toBe(response);
    expect(sdk.send).toHaveBeenCalledExactlyOnceWith('VKWebAppStorageSet', { key: 'score', value: '' });
  });

  it('preserves SDK failures for reads and writes', async () => {
    const read = deferred<unknown>();
    const write = deferred<unknown>();
    const error = { error_type: 'client_error', error_data: { error_code: 10 } };
    onSend('VKWebAppStorageGet', () => read.promise);
    onSend('VKWebAppStorageSet', () => write.promise);
    const client = createClient();

    const failed = Promise.all([
      expect(client.storage.get('score')).rejects.toBe(error),
      expect(client.storage.set('score', '42')).rejects.toBe(error),
    ]);

    read.reject(error);
    write.reject(error);
    await failed;
  });

  it('lets an already sent read settle after disposal without sending more requests', async () => {
    const request = deferred<unknown>();
    onSend('VKWebAppStorageGet', () => request.promise);
    const client = createClient();
    const result = client.storage.get('score');
    client.dispose();
    request.resolve({ keys: [{ key: 'score', value: '42' }] });
    await expect(result).resolves.toBe('42');
    expect(sdk.send).toHaveBeenCalledTimes(1);
  });
});
