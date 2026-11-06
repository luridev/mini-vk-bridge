import type { ReceiveData } from '@vkontakte/vk-bridge';
import type { Unsubscribe } from '../../shared/types.js';

export type BridgeConfig = Readonly<ReceiveData<'VKWebAppGetConfig'>>;

export type MiniBridgeConfig = {
  get: () => Promise<BridgeConfig>;
  snapshot: () => BridgeConfig | undefined;
  subscribe: (
    listener: (config: BridgeConfig) => void,
    options?: { immediate?: boolean },
  ) => Unsubscribe;
};
