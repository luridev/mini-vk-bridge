import type { ReceiveData } from '@vkontakte/vk-bridge';

export type MiniBridgeStorage = {
  get: (key: string) => Promise<string>;
  getMany: (keys: ReadonlyArray<string>) => Promise<Record<string, string>>;
  set: (key: string, value: string) => Promise<ReceiveData<'VKWebAppStorageSet'>>;
  /** Writes an empty string; VK Storage has no separate key deletion command. */
  remove: (key: string) => Promise<ReceiveData<'VKWebAppStorageSet'>>;
};
