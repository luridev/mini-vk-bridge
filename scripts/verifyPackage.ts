import assert from 'node:assert/strict';
import { cpSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRunner, lintPackage, packPackage, withTemporaryDirectory } from '@protoapps/package-verifier';
import type { PackageLock, PackageManifest } from './types.js';

const root = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const require = createRequire(import.meta.url);

const runner = createRunner({ cwd: root, output: 'inherit', timeout: 600_000 });

await withTemporaryDirectory(async (temporaryRoot) => {
  assert.ok(!temporaryRoot.startsWith(`${root}${sep}`), 'The consumer must be outside the repository.');
  process.stdout.write(`[package] Temporary root: ${temporaryRoot}\n`);

  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as PackageManifest;
  const { path: archive } = await packPackage({ cwd: root, destination: temporaryRoot, runner });
  const consumer = join(temporaryRoot, 'consumer');

  cpSync(join(root, 'tests/fixtures/packageConsumer'), consumer, { recursive: true });
  writeFileSync(join(consumer, 'package.json'), `${JSON.stringify({ private: true, type: 'module' }, null, 2)}\n`);
  runner.npm(['install', '--ignore-scripts', '--no-audit', '--no-fund', archive], { cwd: consumer });

  const installedPackage = realpathSync(join(consumer, 'node_modules', manifest.name));

  assert.ok(installedPackage.startsWith(`${consumer}${sep}`));
  const installedManifest = JSON.parse(readFileSync(join(installedPackage, 'package.json'), 'utf8')) as PackageManifest;

  assert.equal(installedManifest.name, manifest.name);
  assert.equal(installedManifest.version, manifest.version);
  assert.equal(installedManifest.type, 'module');

  assert.deepEqual(installedManifest.exports, {
    '.': { types: './dist/types/index.d.ts', import: './dist/index.js', default: './dist/index.js' },
  });

  assert.deepEqual(Object.keys(installedManifest.dependencies), ['@vkontakte/vk-bridge']);
  assert.deepEqual(installedManifest.dependencies, manifest.dependencies);
  assert.deepEqual(installedManifest.peerDependencies ?? {}, {});
  assert.deepEqual(installedManifest.optionalDependencies ?? {}, {});

  const installedRequire = createRequire(join(installedPackage, 'package.json'));
  const sdk = realpathSync(installedRequire.resolve('@vkontakte/vk-bridge'));

  assert.ok(sdk.startsWith(`${consumer}${sep}`), 'The SDK must resolve from the consumer installation.');
  const lock = JSON.parse(readFileSync(join(consumer, 'package-lock.json'), 'utf8')) as PackageLock;

  for (const name of [...Object.keys(manifest.devDependencies), 'cross-spawn', '@types/cross-spawn', 'publint']) {
    assert.ok(!Object.keys(lock.packages).some((path) => path.endsWith(`node_modules/${name}`)),
      `Unexpected runtime dependency: ${name}`);
  }

  runner.npm(['ls', '--all'], { cwd: consumer });
  runner.node([join(consumer, 'runtime.mjs')], { cwd: consumer });

  const typescriptVersion = (JSON.parse(readFileSync(require.resolve('typescript/package.json'), 'utf8')) as PackageManifest).version;

  runner.npm(['install', '--ignore-scripts', '--no-audit', '--no-fund', '--save-dev', '--include=dev', `typescript@${typescriptVersion}`], { cwd: consumer });

  const contracts = readFileSync(join(root, 'tests/contracts.ts'), 'utf8');

  assert.ok(contracts.includes('\'../src/index.js\''));
  writeFileSync(join(consumer, 'contracts.ts'), contracts.replaceAll('\'../src/index.js\'', `'${manifest.name}'`));
  cpSync(join(root, 'tests/types.ts'), join(consumer, 'types.ts'));

  writeFileSync(join(consumer, 'factory.ts'), `import { createMiniBridge } from '${manifest.name}';
import type { MiniBridge, MiniBridgeOptions } from '${manifest.name}';

const options: MiniBridgeOptions = { api: { minIntervalMs: 0 } };
export const client: MiniBridge = createMiniBridge();
export const configuredClient: MiniBridge = createMiniBridge(options);
// @ts-expect-error: the SDK is an internal runtime dependency, not an injected option.
createMiniBridge({ bridge: {} });
// @ts-expect-error: the factory does not take an SDK instance as a second argument.
createMiniBridge({}, {});
`);

  writeFileSync(join(consumer, 'tsconfig.json'), `${JSON.stringify({
    compilerOptions: {
      target: 'ES2023',
      lib: ['ES2023', 'DOM', 'DOM.Iterable'],
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      noUncheckedIndexedAccess: true,
      exactOptionalPropertyTypes: true,
      verbatimModuleSyntax: true,
      noEmit: true,
      skipLibCheck: false,
      types: [],
    },
    include: ['*.ts'],
  }, null, 2)}\n`);

  runner.node([join(consumer, 'node_modules/typescript/bin/tsc'), '--noEmit'], { cwd: consumer });
  await lintPackage(archive);
  process.stdout.write('Package verified successfully.\n');
}, { prefix: 'protoapps-mini-vk-bridge-' });
