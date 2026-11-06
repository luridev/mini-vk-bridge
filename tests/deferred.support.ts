import type { Deferred } from './types.js';

export function deferred<Value>(): Deferred<Value> {
  let resolve!: Deferred<Value>['resolve'];
  let reject!: Deferred<Value>['reject'];

  const promise = new Promise<Value>((yes, no) => {
    resolve = yes;
    reject = no;
  });

  return { promise, resolve, reject };
}
