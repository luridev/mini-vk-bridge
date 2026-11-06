import type { AnyRequestMethodName } from '@vkontakte/vk-bridge';

export class ClientDisposedError extends Error {
  constructor() {
    super('This MiniBridge client has been disposed.');
    this.name = 'ClientDisposedError';
  }
}

export class BridgeResponseError extends Error {
  readonly method: AnyRequestMethodName;
  readonly response: unknown;

  constructor(method: AnyRequestMethodName, response: unknown, message: string) {
    super(message, { cause: response });
    this.name = 'BridgeResponseError';
    this.method = method;
    this.response = response;
  }
}

export class ApiTimeoutError extends Error {
  readonly method: string;
  readonly timeoutMs: number;
  readonly requestSettled: Promise<void>;
  readonly initialError: unknown;

  constructor(method: string, timeoutMs: number, requestSettled: Promise<void>, initialError?: unknown) {
    super(`VK API ${method} did not respond within ${timeoutMs} ms.`);
    this.name = 'ApiTimeoutError';
    this.method = method;
    this.timeoutMs = timeoutMs;
    this.requestSettled = requestSettled;
    this.initialError = initialError;
  }
}

export class ApiRetryError extends Error {
  readonly initialError: unknown;

  constructor(initialError: unknown, cause: unknown) {
    super('VK API token refresh or the retry failed.', { cause });
    this.name = 'ApiRetryError';
    this.initialError = initialError;
  }
}
