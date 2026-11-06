import type { ReceiveData, RequestProps } from '@vkontakte/vk-bridge';

export type ApiOptions = {
  /** Defaults to 5.199, the version used by the initial consumer. */
  version?: string;
  /** Minimum time between actual CallAPIMethod dispatches. Default: 500 ms. */
  minIntervalMs?: number;
  /** Per-attempt response wait, starting at dispatch. Default: 30,000 ms. */
  timeoutMs?: number;
};

export type ApiAuthorizationOptions = {
  /** Individual permission names; order and duplicates do not matter. */
  scopes?: ReadonlyArray<string>;
};

export type ApiCallOptions = ApiAuthorizationOptions & {
  timeoutMs?: number;
};

/** The high-level API owns access_token and v. */
export type ApiParams = Readonly<Record<string, RequestProps<'VKWebAppCallAPIMethod'>['params'][string]>> & {
  readonly access_token?: never;
  readonly v?: never;
};

export type ApiAuthorization = Readonly<ReceiveData<'VKWebAppGetAuthToken'>>;

export type MiniBridgeApi = {
  authorize: (options?: ApiAuthorizationOptions) => Promise<ApiAuthorization>;
  call: (method: string, params?: ApiParams, options?: ApiCallOptions) => Promise<unknown>;
};

export type ResolvedApiOptions = {
  version: string;
  minIntervalMs: number;
  timeoutMs: number;
};

export type TokenEntry = {
  readonly contextKey: string;
  readonly response: ApiAuthorization;
  readonly scopes: ReadonlySet<string>;
};
