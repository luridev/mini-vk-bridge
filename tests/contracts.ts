// Compile-only public API checks: npm run typecheck. This file must not be executed.
import type {
  AnyReceiveMethodName as SdkReceiveMethodName,
  ErrorData as SdkErrorData,
  ReceiveData as SdkReceiveData,
  RequestIdProp as SdkRequestIdProp,
  RequestProps as SdkRequestProps,
  VKBridgeEvent as SdkEvent,
  VKBridgeSend as SdkSend,
} from '@vkontakte/vk-bridge';
import type {
  ApiParams,
  BridgeEventData,
  BridgeEventName,
  createMiniBridge,
  MiniBridge,
  ReceiveData,
  RequestIdProp,
  RequestProps,
  VKBridgeSend,
} from '../src/index.js';
import type { TypeEqual } from './types.js';

declare function assertType<Actual, Expected>(equal: TypeEqual<Actual, Expected>): void;
declare const vk: ReturnType<typeof createMiniBridge>;

assertType<typeof vk, MiniBridge>(true);
assertType<typeof vk.send, SdkSend>(true);
assertType<VKBridgeSend, SdkSend>(true);

const request: RequestProps<'VKWebAppStorageGet'> & RequestIdProp = { keys: ['theme'], request_id: 'read-theme' };
assertType<typeof request, SdkRequestProps<'VKWebAppStorageGet'> & SdkRequestIdProp>(true);

const _storageResponse = vk.send('VKWebAppStorageGet', request);
const _launchResponse = vk.send('VKWebAppGetLaunchParams');
assertType<typeof _storageResponse, Promise<SdkReceiveData<'VKWebAppStorageGet'>>>(true);
assertType<typeof _launchResponse, Promise<SdkReceiveData<'VKWebAppGetLaunchParams'>>>(true);
assertType<ReceiveData<'VKWebAppStorageGet'>, SdkReceiveData<'VKWebAppStorageGet'>>(true);

// @ts-expect-error: a valid StorageGet payload cannot be used for StorageSet.
void vk.send('VKWebAppStorageSet', request);
// @ts-expect-error: commands are restricted to the SDK's request names.
void vk.send('VKWebAppImaginary');

assertType<BridgeEventName, SdkEvent<SdkReceiveMethodName>['detail']['type']>(true);
assertType<BridgeEventData<'VKWebAppUpdateConfig' | 'VKWebAppInitFailed'>, SdkReceiveData<'VKWebAppUpdateConfig'> | SdkErrorData>(true);

vk.on('VKWebAppUpdateConfig', (_config) => {
  assertType<typeof _config, SdkReceiveData<'VKWebAppUpdateConfig'>>(true);
});

vk.on('VKWebAppInitResult', (_result) => {
  assertType<typeof _result, SdkReceiveData<'VKWebAppInit'> & SdkRequestIdProp>(true);
});

vk.on('VKWebAppInitFailed', (_error) => {
  assertType<typeof _error, SdkErrorData>(true);
});

// @ts-expect-error: subscriptions accept only known SDK event names.
vk.on('VKWebAppImaginary', () => undefined);

const config = await vk.config.get();
// @ts-expect-error: SDK configuration is exposed as a readonly snapshot.
config.appearance = 'dark';

const params: ApiParams = { user_ids: '1', count: 2 };
const _apiResponse = vk.api.call('users.get', params);
assertType<typeof _apiResponse, Promise<unknown>>(true);

const paramsWithToken = { ...params, access_token: 'token' };
const paramsWithVersion = { ...params, v: '5.199' };
// @ts-expect-error: high-level API owns access_token.
void vk.api.call('users.get', paramsWithToken);
// @ts-expect-error: high-level API owns the version.
void vk.api.call('users.get', paramsWithVersion);
