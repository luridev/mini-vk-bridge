export type PackageManifest = {
  name: string;
  version: string;
  type: string;
  exports: Record<string, { types: string; import: string; default: string }>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

export type PackageLock = {
  packages: Record<string, unknown>;
};
