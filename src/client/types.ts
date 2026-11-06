import type { AnyRequestMethodName, ReceiveData, VKBridgeSend } from '@vkontakte/vk-bridge';
import type { ApiOptions, MiniBridgeApi } from '../modules/api/types.js';
import type { MiniBridgeConfig } from '../modules/configuration/types.js';
import type { MiniBridgeLaunch } from '../modules/launch/types.js';
import type { MiniBridgeStorage } from '../modules/storage/types.js';
import type { BridgeEventData, BridgeEventName, Unsubscribe } from '../shared/types.js';

export type MiniBridgeOptions = {
  api?: ApiOptions;
  /** Receives synchronously thrown subscriber errors for this client. */
  onListenerError?: (error: unknown) => void;
};

export type MiniBridge = {
  init: () => Promise<ReceiveData<'VKWebAppInit'>>;
  send: VKBridgeSend;
  on: <Name extends BridgeEventName>(
    name: Name,
    listener: (data: BridgeEventData<Name>) => void,
  ) => Unsubscribe;
  supports: (method: AnyRequestMethodName) => Promise<boolean>;
  dispose: () => void;
  readonly launch: MiniBridgeLaunch;
  readonly config: MiniBridgeConfig;
  readonly storage: MiniBridgeStorage;
  readonly api: MiniBridgeApi;
};
