import { ClientDisposedError } from '../../errors/errors.js';
import { assertActive } from '../lifecycle/lifecycle.js';
import type { QueueEntry } from './types.js';

export function createScheduler(minIntervalMs: number, signal: AbortSignal) {
  const queue: Array<QueueEntry> = [];
  let lastDispatchAt = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pumping = false;

  function pump(): void {
    if (pumping || timer !== undefined || signal.aborted) {
      return;
    }

    pumping = true;

    try {
      while (queue.length > 0) {
        const remaining = lastDispatchAt + minIntervalMs - performance.now();

        if (remaining > 0) {
          timer = setTimeout(() => {
            timer = undefined;
            pump();
          }, remaining);

          return;
        }

        const entry = queue.shift();

        if (entry === undefined) {
          return;
        }

        try {
          entry.prepare();
        } catch (error) {
          entry.reject(error);
          continue;
        }

        entry.dispatch();
        lastDispatchAt = performance.now();
      }
    } finally {
      pumping = false;
    }
  }

  signal.addEventListener('abort', () => {
    clearTimeout(timer);
    timer = undefined;

    for (const entry of queue.splice(0)) {
      entry.reject(new ClientDisposedError());
    }
  }, { once: true });

  return {
    enqueue<Result>(dispatch: () => Promise<Result>, prepare: () => void = () => undefined): Promise<Result> {
      return new Promise((resolve, reject) => {
        assertActive(signal);

        queue.push({
          prepare,
          reject,
          dispatch() {
            try {
              void dispatch().then(resolve, reject);
            } catch (error) {
              // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- Preserve SDK errors.
              reject(error);
            }
          },
        });

        pump();
      });
    },
  };
}
