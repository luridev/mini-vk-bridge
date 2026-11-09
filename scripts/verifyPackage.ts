import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import spawn from 'cross-spawn';
import type { SpawnSyncReturns } from 'node:child_process';
import type { NpmPackResult, PackageLock, PackageManifest } from './types.js';

const root = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const require = createRequire(import.meta.url);

function run(command: string, args: Array<string>, cwd = root, capture = false): string {
  const label = `${command} ${args.join(' ')}`;
  const env = { ...process.env };
  delete env.NODE_PATH;
  delete env.NODE_OPTIONS;
  process.stdout.write(`[package] ${label}\n`);

  const result: SpawnSyncReturns<string | null> = spawn.sync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['inherit', capture ? 'pipe' : 'inherit', 'inherit'],
  });

  if (result.error != null || result.status !== 0 || result.signal != null) {
    if (result.stdout !== null && result.stdout !== '') {
      process.stderr.write(result.stdout);
    }

    throw new Error(`${label} failed (exit ${String(result.status)}, signal ${String(result.signal)}).`, { cause: result.error });
  }

  return result.stdout ?? '';
}

const temporaryDirectory = realpathSync(tmpdir());
const temporaryRoot = realpathSync(mkdtempSync(join(temporaryDirectory, 'protoapps-mini-vk-bridge-')));

try {
  assert.equal(dirname(temporaryRoot), temporaryDirectory);
  assert.ok(!temporaryRoot.startsWith(`${root}${sep}`), 'The consumer must be outside the repository.');
  process.stdout.write(`[package] Temporary root: ${temporaryRoot}\n`);

  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as PackageManifest;
  const packed = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temporaryRoot], root, true)) as Array<NpmPackResult>;
  const [tarball] = packed;

  assert.equal(packed.length, 1, 'npm pack must produce one archive.');
  assert.ok(tarball !== undefined);
  assert.equal(tarball.name, manifest.name);
  assert.equal(tarball.version, manifest.version);
  assert.equal(basename(tarball.filename), tarball.filename);
  process.stdout.write(`${JSON.stringify(tarball, null, 2)}\n`);

  const archive = join(temporaryRoot, tarball.filename);
  const consumer = join(temporaryRoot, 'consumer');

  cpSync(join(root, 'tests/fixtures/package-consumer'), consumer, { recursive: true });
  writeFileSync(join(consumer, 'package.json'), `${JSON.stringify({ private: true, type: 'module' }, null, 2)}\n`);
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', archive], consumer);

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

  for (const name of Object.keys(manifest.devDependencies)) {
    assert.ok(!Object.keys(lock.packages).some((path) => path.endsWith(`node_modules/${name}`)),
      `Unexpected runtime dependency: ${name}`);
  }

  run('npm', ['ls', '--all'], consumer);
  run(process.execPath, [join(consumer, 'runtime.mjs')], consumer);

  const typescriptVersion = (JSON.parse(readFileSync(require.resolve('typescript/package.json'), 'utf8')) as PackageManifest).version;

  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--save-dev', '--include=dev', `typescript@${typescriptVersion}`], consumer);

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

  run(process.execPath, [join(consumer, 'node_modules/typescript/bin/tsc'), '--noEmit'], consumer);
  run('npm', ['exec', '--offline', '--no', '--', 'publint', archive, '--strict']);
  process.stdout.write('Package verified successfully.\n');
} finally {
  assert.equal(dirname(realpathSync(temporaryRoot)), temporaryDirectory);
  rmSync(temporaryRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
