import { vi } from 'vitest';
import type {
  AnyReceiveMethodName,
  AnyRequestMethodName,
  RequestIdProp,
  RequestProps,
  VKBridgeEvent,
  VKBridgeSend,
  VKBridgeSubscribeHandler,
} from '@vkontakte/vk-bridge';
import type { SdkHandler, SdkResponse } from './types.js';

const handlers = new Map<AnyRequestMethodName, (props: unknown) => unknown>();
const subscribers = new Set<VKBridgeSubscribeHandler>();

const send: VKBridgeSend = (method, props) => {
  const handler = handlers.get(method);

  if (handler === undefined) {
    return Promise.reject(new Error(`Unexpected SDK request: ${method}`));
  }

  return Promise.resolve(handler(props)) as Promise<SdkResponse<typeof method>>;
};

export const sdk = {
  send: vi.fn(send),
  supportsAsync: vi.fn<(method: AnyRequestMethodName) => Promise<boolean>>(),
  subscribe: vi.fn((listener: VKBridgeSubscribeHandler) => { subscribers.add(listener); }),
  unsubscribe: vi.fn((listener: VKBridgeSubscribeHandler) => { subscribers.delete(listener); }),
};

export function onSend<Method extends AnyRequestMethodName>(method: Method, handler: SdkHandler<Method>): void {
  handlers.set(method, (props) => handler(props as (RequestProps<Method> & RequestIdProp) | undefined));
}

export function reply(method: AnyRequestMethodName, value: unknown): void {
  handlers.set(method, () => value);
}

export function emit(event: VKBridgeEvent<AnyReceiveMethodName>): void {
  for (const subscriber of [...subscribers]) {
    subscriber(event);
  }
}

export function subscriberCount(): number {
  return subscribers.size;
}

export function resetSdk(): void {
  handlers.clear();
  subscribers.clear();
  sdk.send.mockReset().mockImplementation(send);
  sdk.supportsAsync.mockReset().mockResolvedValue(false);
  sdk.subscribe.mockClear();
  sdk.unsubscribe.mockClear();
}
