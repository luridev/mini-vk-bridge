import type { AnyReceiveMethodName, VKBridgeEvent } from '@vkontakte/vk-bridge';

type PayloadForName<Detail, Name> = Detail extends { type: infer Type; data: infer Data }
  ? Name extends Type ? Data : never
  : never;

export type Unsubscribe = () => void;
export type BridgeEventName = VKBridgeEvent<AnyReceiveMethodName>['detail']['type'];

/** Includes receive-only, result and failed events from the installed SDK. */
export type BridgeEventData<Name extends BridgeEventName> = PayloadForName<
  VKBridgeEvent<AnyReceiveMethodName>['detail'],
  Name
>;
