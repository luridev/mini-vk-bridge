import { fileURLToPath } from 'node:url';
import { getBrowserTargets } from '@protoapps/browser-targets';
import { defineConfig } from 'vite';
import { widelyAvailableOnDate } from './config/browserPolicy/config.js';

export default defineConfig({
  build: {
    target: getBrowserTargets({ widelyAvailableOnDate }),
    sourcemap: true,
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      formats: ['es'],
      fileName: 'index',
    },
    rolldownOptions: {
      external: ['@vkontakte/vk-bridge'],
    },
  },
});
