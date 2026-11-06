# @protoapps/mini-vk-bridge

A lightweight, framework-agnostic TypeScript wrapper around [VK Bridge](https://github.com/VKCOM/vk-bridge).

Provides typed commands and events, launch parameters, configuration, storage, and VK API helpers.

## Installation

```bash
npm install @protoapps/mini-vk-bridge
```

The official VK Bridge SDK is included as a dependency.

## Usage

```ts
import { createMiniBridge } from '@protoapps/mini-vk-bridge';

const vk = createMiniBridge();

await vk.init();

const user = await vk.send('VKWebAppGetUserInfo');

const launch = await vk.launch.get();

const unsubscribe = vk.config.subscribe(config => {
  console.log(config.appearance);
});

await vk.config.get();

await vk.storage.set('score', '42');
const score = await vk.storage.get('score');

unsubscribe();
vk.dispose();
```

## VK API

`vk.api.call()` handles access tokens, scopes, authorization refresh, request scheduling, and timeouts.

Default settings:

```ts
const vk = createMiniBridge({
  api: {
    version: '5.199',
    minIntervalMs: 500,
    timeoutMs: 30_000,
  },
});
```

Other VK Bridge methods remain available through the typed `vk.send()` API.

## Development

```bash
npm install
npm run check:commit
npm run test:coverage
```

Runtime tests run in Vitest. Public TypeScript contracts in `tests/contracts.ts` are checked only by `npm run typecheck` (also included in `check:commit`), and are excluded from the production build and declarations.
