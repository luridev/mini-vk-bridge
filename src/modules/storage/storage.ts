import { assertActive } from '../../internal/lifecycle/lifecycle.js';
import type { VKBridgeSend } from '@vkontakte/vk-bridge';
import type { MiniBridgeStorage } from './types.js';

export function createStorage(send: VKBridgeSend, signal: AbortSignal): MiniBridgeStorage {
  async function getMany(keys: ReadonlyArray<string>): Promise<Record<string, string>> {
    assertActive(signal);
    const uniqueKeys = [...new Set(keys)];

    if (uniqueKeys.length === 0) {
      return {};
    }

    const response = await send('VKWebAppStorageGet', { keys: uniqueKeys });
    const values = new Map(response.keys.map(({ key, value }) => [key, value]));

    return Object.fromEntries(uniqueKeys.map((key) => [key, values.get(key) ?? '']));
  }

  const set: MiniBridgeStorage['set'] = (key, value) => send('VKWebAppStorageSet', { key, value });

  return {
    async get(key) {
      return (await getMany([key]))[key] ?? '';
    },
    getMany,
    set,
    remove: (key) => set(key, ''),
  };
}
