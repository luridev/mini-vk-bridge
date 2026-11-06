import { afterEach, beforeEach, vi } from 'vitest';
import { resetSdk } from './sdk.support.js';

vi.mock('@vkontakte/vk-bridge', async () => {
  const { sdk } = await import('./sdk.support.js');

  return { default: sdk };
});

beforeEach(() => {
  resetSdk();
  vi.stubGlobal('window', { location: { search: '?vk_app_id=123&vk_user_id=456' } });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
