import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProtoConfig } from '@protoapps/eslint-config';
import { globalIgnores } from 'eslint/config';
import globals from 'globals';

export default createProtoConfig(
  {
    tsconfigRootDir: dirname(fileURLToPath(import.meta.url)),
    vitest: { files: ['src/**/*.test.ts'] },
  },
  globalIgnores(['dist/**', '.local/**', 'coverage/**']),
  {
    name: 'mini-vk-bridge/browser',
    files: ['src/**/*.ts'],
    languageOptions: { globals: globals.browser },
  },
  {
    name: 'mini-vk-bridge/tooling',
    files: ['*.config.ts', 'config/**/*.ts', 'scripts/**/*.ts', 'tests/**/*.{ts,mjs}', 'src/**/*.test.ts', 'src/**/*.support.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    name: 'mini-vk-bridge/portable-imports',
    files: ['**/*.ts'],
    rules: { '@typescript-eslint/no-restricted-imports': 'off' },
  },
);
