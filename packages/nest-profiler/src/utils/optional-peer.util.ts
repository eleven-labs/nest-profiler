import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Anything with a `warn` — a NestJS `Logger`, or a stub in a test.
 */
export interface OptionalPeerLogger {
  warn(message: string): void;
}

/** The outcome of {@link resolveOptionalPeer}. */
export type OptionalPeer<T> =
  /** The package was found and evaluated. */
  | { status: 'loaded'; module: T }
  /** The package is not installed — the normal case for an optional peer, and not an error. */
  | { status: 'absent' }
  /**
   * The package *is* installed but could not be loaded: its own top-level code threw, one of its
   * dependencies is missing, or the file is corrupt. Worth reporting — this is a broken install,
   * not a deliberate omission.
   */
  | { status: 'broken'; error: Error };

/**
 * Loads an optional peer package, telling the three outcomes apart.
 *
 * Every optional peer in this workspace used to be loaded with a bare `require()` inside a
 * `try`/`catch` that swallowed everything, which reports "not installed" and "installed but
 * broken" the same way: as a silently missing panel that no one can diagnose from an empty UI.
 *
 * It also recovers a subpath an `exports` map refuses to publish. `@nestjs/core/package.json` is
 * the concrete case: Nest 11 exports it, Nest 12 does not, and reading the framework version has
 * no business breaking on a package-manifest export decision. When a subpath fails to load, the
 * package's own root is located on disk and the subpath is read from there — attempted on any
 * failure rather than on one error code, because resolvers disagree on how they report the refusal
 * (Node raises `ERR_PACKAGE_PATH_NOT_EXPORTED`, others a plain `MODULE_NOT_FOUND`).
 *
 * That fallback deliberately goes around the `exports` map, so it is for manifests and other files
 * a package publishes as data, not a way to reach into a package's internals.
 *
 * Specifiers are literals written in this repository, never host input, so joining a subpath onto
 * the resolved package root cannot be steered from outside.
 */
export function resolveOptionalPeer<T = unknown>(specifier: string): OptionalPeer<T> {
  try {
    return { status: 'loaded', module: requireModule<T>(specifier) };
  } catch (err) {
    return loadThroughPackageRoot<T>(specifier) ?? classify(err, specifier);
  }
}

/**
 * The exports of an optional peer, or `undefined` when it is not installed — warning through
 * `logger` when it *is* installed and failed to load. The ergonomic form of
 * {@link resolveOptionalPeer}: a caller that only needs "use it when it is there" still gets an
 * honest message on the one outcome that is worth a message.
 */
export function loadOptionalPeer<T = unknown>(
  specifier: string,
  logger?: OptionalPeerLogger,
): T | undefined {
  const result = resolveOptionalPeer<T>(specifier);
  if (result.status === 'loaded') return result.module;
  if (result.status === 'broken') {
    logger?.warn(
      `Optional peer '${specifier}' is installed but could not be loaded: ${result.error.message}. ` +
        'The feature that depends on it is disabled.',
    );
  }
  return undefined;
}

function requireModule<T>(specifier: string): T {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(specifier) as T;
}

/**
 * `code` and `message` are read structurally rather than through `instanceof Error`: a loader
 * error can come from another realm — a Jest sandbox, a `vm` context — where `instanceof` is false
 * even though the value is an error in every way that matters here.
 */
function errorCode(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' ? code : undefined;
}

function errorMessage(err: unknown): string {
  const message = (err as { message?: unknown } | undefined)?.message;
  return typeof message === 'string' ? message : String(err);
}

function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  const error: NodeJS.ErrnoException = new Error(errorMessage(err));
  error.code = errorCode(err);
  return error;
}

function classify<T>(err: unknown, specifier: string): OptionalPeer<T> {
  return isMissing(err, specifier)
    ? { status: 'absent' }
    : { status: 'broken', error: toError(err) };
}

/**
 * Whether the failure is "this package is not installed" rather than "something inside it is".
 *
 * The resolution error alone is not enough: a peer whose own dependency is missing raises the same
 * `MODULE_NOT_FOUND`. Node names the specifier it could not resolve, so the message naming the
 * requested one is what separates an absent peer from a broken install.
 */
function isMissing(err: unknown, specifier: string): boolean {
  const code = errorCode(err);
  if (code !== 'MODULE_NOT_FOUND' && code !== 'ERR_MODULE_NOT_FOUND') return false;
  const message = errorMessage(err);
  return message.includes(`'${specifier}'`) || message.includes(`"${specifier}"`);
}

/** Splits `@scope/pkg/deep/file.json` into its package name and the subpath below it. */
function splitSpecifier(specifier: string): { name: string; subpath: string } | undefined {
  const segments = specifier.split('/');
  const nameSegments = specifier.startsWith('@') ? 2 : 1;
  if (segments.length <= nameSegments) return undefined;
  return {
    name: segments.slice(0, nameSegments).join('/'),
    subpath: segments.slice(nameSegments).join('/'),
  };
}

/**
 * Loads a subpath from the package's own root instead of through its `exports` map, or `undefined`
 * when the package cannot be located or the file is not there either.
 */
function loadThroughPackageRoot<T>(specifier: string): { status: 'loaded'; module: T } | undefined {
  const filePath = resolveThroughPackageRoot(specifier);
  if (filePath === undefined) return undefined;
  try {
    return { status: 'loaded', module: requireModule<T>(filePath) };
  } catch {
    return undefined;
  }
}

/**
 * Absolute path to a subpath of an installed package, resolved through the package's own root
 * instead of its `exports` map. `undefined` when the package itself cannot be located.
 */
function resolveThroughPackageRoot(specifier: string): string | undefined {
  const parsed = splitSpecifier(specifier);
  if (!parsed) return undefined;

  let current: string;
  try {
    // The `.` export always exists, so resolving the package root is not subject to the refusal
    // that sent us here.
    current = path.dirname(require.resolve(parsed.name));
  } catch {
    return undefined;
  }

  // Walk up to the nearest ancestor whose manifest is this package's — the entry point can sit
  // any number of directories below the root (`dist/index.js`, `lib/cjs/index.js`…).
  for (;;) {
    if (readPackageName(path.join(current, 'package.json')) === parsed.name) {
      return path.join(current, parsed.subpath);
    }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function readPackageName(manifestPath: string): string | undefined {
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { name?: string };
    return manifest.name;
  } catch {
    // Absent or unreadable manifest — keep walking up.
    return undefined;
  }
}
