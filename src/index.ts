export { createMiniBridge } from './client/client.js';
export { ApiRetryError, ApiTimeoutError, BridgeResponseError, ClientDisposedError } from './errors/errors.js';
export type { MiniBridge, MiniBridgeOptions } from './client/types.js';

export type {
  ApiAuthorization,
  ApiAuthorizationOptions,
  ApiCallOptions,
  ApiOptions,
  ApiParams,
  MiniBridgeApi,
} from './modules/api/types.js';

export type { BridgeConfig, MiniBridgeConfig } from './modules/configuration/types.js';
export type { LaunchParams, MiniBridgeLaunch } from './modules/launch/types.js';
export type { MiniBridgeStorage } from './modules/storage/types.js';
export type { BridgeEventData, BridgeEventName, Unsubscribe } from './shared/types.js';

export type {
  AnyReceiveMethodName,
  AnyRequestMethodName,
  ErrorData,
  ReceiveData,
  RequestIdProp,
  RequestProps,
  VKBridgeEvent,
  VKBridgeSend,
} from '@vkontakte/vk-bridge';
