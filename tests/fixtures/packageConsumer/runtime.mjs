import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import * as bridge from '@protoapps/mini-vk-bridge';

assert.deepEqual(Object.keys(bridge).sort(), [
  'ApiRetryError', 'ApiTimeoutError', 'BridgeResponseError', 'ClientDisposedError', 'createMiniBridge',
].sort());

const require = createRequire(import.meta.resolve('@protoapps/mini-vk-bridge'));
const { default: sdk } = await import(pathToFileURL(require.resolve('@vkontakte/vk-bridge')).href);

for (const method of ['send', 'supportsAsync', 'subscribe', 'unsubscribe']) {
  assert.equal(typeof sdk[method], 'function');
}

assert.equal(typeof globalThis.window, 'undefined');
assert.throws(() => bridge.createMiniBridge(), /requires a browser environment/u);

const disposed = new bridge.ClientDisposedError();
assert.ok(disposed instanceof Error);
assert.equal(disposed.name, 'ClientDisposedError');

const response = { error_type: 'client_error', error_data: { error_code: 1, error_reason: 'smoke' } };
const bridgeError = new bridge.BridgeResponseError('VKWebAppInit', response, 'smoke');
assert.ok(bridgeError instanceof Error);
assert.equal(bridgeError.method, 'VKWebAppInit');
assert.equal(bridgeError.response, response);
assert.equal(bridgeError.cause, response);

const settled = Promise.resolve();
const timeout = new bridge.ApiTimeoutError('users.get', 100, settled, bridgeError);
assert.ok(timeout instanceof Error);
assert.equal(timeout.method, 'users.get');
assert.equal(timeout.timeoutMs, 100);
assert.equal(timeout.requestSettled, settled);
assert.equal(timeout.initialError, bridgeError);

const retry = new bridge.ApiRetryError(bridgeError, timeout);
assert.ok(retry instanceof Error);
assert.equal(retry.initialError, bridgeError);
assert.equal(retry.cause, timeout);
