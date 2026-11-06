import { ApiTimeoutError, ClientDisposedError } from '../../errors/errors.js';
import type { MiniBridgeOptions } from '../../client/types.js';
import type { ApiWaitOptions } from './types.js';

export function assertActive(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new ClientDisposedError();
  }
}

export function waitForRequest<Result>(
  request: Promise<Result>,
  signal: AbortSignal,
  wait?: ApiWaitOptions,
  startedAt = performance.now(),
): Promise<Result> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    function cleanup(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }

    function abort(): void {
      cleanup();
      reject(new ClientDisposedError());
    }

    void request.then(
      (result) => {
        cleanup();
        resolve(result);
      },
      (error: unknown) => {
        cleanup();
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- SDK rejects with ErrorData.
        reject(error);
      },
    );

    if (signal.aborted) {
      abort();

      return;
    }

    signal.addEventListener('abort', abort, { once: true });

    if (wait !== undefined) {
      timer = setTimeout(() => {
        cleanup();
        const requestSettled = request.then(() => undefined, () => undefined);
        reject(new ApiTimeoutError(wait.method, wait.timeoutMs, requestSettled, wait.initialError));
      }, Math.max(0, wait.timeoutMs - (performance.now() - startedAt)));
    }
  });
}

export function notify<Value>(
  listener: (value: Value) => void,
  value: Value,
  onListenerError?: MiniBridgeOptions['onListenerError'],
): void {
  try {
    listener(value);
  } catch (error) {
    let unhandledError: unknown = error;

    if (onListenerError !== undefined) {
      try {
        onListenerError(error);

        return;
      } catch (reportingError) {
        unhandledError = reportingError;
      }
    }

    queueMicrotask(() => {
      throw unhandledError;
    });
  }
}
