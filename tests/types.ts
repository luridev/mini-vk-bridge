import type { AnyReceiveMethodName, AnyRequestMethodName, ReceiveData, RequestIdProp, RequestProps } from '@vkontakte/vk-bridge';

/* eslint-disable @typescript-eslint/no-unnecessary-type-parameters -- Required for exact type equality. */
export type TypeEqual<Actual, Expected> = (<Value>() => Value extends Actual ? 1 : 2) extends
(<Value>() => Value extends Expected ? 1 : 2) ? true : false;
/* eslint-enable @typescript-eslint/no-unnecessary-type-parameters */

export type Deferred<Value> = {
  promise: Promise<Value>;
  resolve: (value: Value | PromiseLike<Value>) => void;
  reject: (reason: unknown) => void;
};

export type SdkResponse<Method extends AnyRequestMethodName> = Method extends AnyReceiveMethodName
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- Mirrors the SDK's conditional send result.
  ? ReceiveData<Method> : void;

export type SdkHandler<Method extends AnyRequestMethodName> = (
  props: (RequestProps<Method> & RequestIdProp) | undefined,
) => unknown;
