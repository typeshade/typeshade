// === Where a shader module's import specifier points (Rule 3.9, surface §68) ===
//
// ONE rule for both halves of a `"use typeshade"` program: the compiler follows an import
// through it (`link.ts`), and the language service resolves the same import for TypeScript
// through it (`language-service/host.ts`). Two copies of the rule would let the editor and the
// compiler read one specifier as two files (AGENTS.md#gate-discipline, one authority).
//
// No `node:path`: the language service must stay filesystem-free so it can run in a browser
// worker, and the compiler never touches a filesystem either. A path here is a string, a file
// name or a uri (`file:///p/main.shade.ts`), and the caller's `readDocument` says what it names.
// A package is found the same way: its `package.json` is one more file `readDocument` reads
// (proposal 0024).

/** Whether `specifier` names a file by a relative path (`./x`, `../x`). Anything else names a
 *  package, or nothing a shader module can import. */
export function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../');
}

/**
 * The file a relative `specifier` written in `fromFile` names: the importing file's directory
 * joined with the specifier, with a trailing `.js` or `.mjs` read as `.ts` (the spelling
 * `tsc`'s bundler resolution accepts, and the one this repository's own source writes), and
 * `.ts` appended to any other path that does not already end in a TypeScript extension, so
 * `./noise.shade` names `noise.shade.ts`. `undefined` for a specifier that is not relative.
 */
export function resolveRelativeSpecifier(fromFile: string, specifier: string): string | undefined {
  if (!isRelativeSpecifier(specifier)) return undefined;
  const dir = fromFile.includes('/') ? fromFile.slice(0, fromFile.lastIndexOf('/') + 1) : '';
  const rewritten = joinPath(dir, specifier).replace(/\.m?js$/, '.ts');
  return /\.[mc]?tsx?$/.test(rewritten) ? rewritten : `${rewritten}.ts`;
}

/** How the rule reads a file: the caller's `readDocument`, asked for `package.json` files. */
export type ReadDocument = (fileName: string) => string | undefined;

/** What a specifier written in a file names, or why it names nothing (surface §68's table). */
export type Resolution =
  /** A file: relative, or a package's. Whether it is a shader module is for its reader to see. */
  | { readonly kind: 'file'; readonly file: string }
  /** A specifier that is neither relative nor a package name: an absolute path, a url, `node:`,
   *  a scope with no name, a subpath with `.` or `..` segments. */
  | { readonly kind: 'not-a-name' }
  /** `#name`, which names an entry of a package's own `imports` map. */
  | { readonly kind: 'import-map' }
  /** No `node_modules/<name>/package.json` from the importing file's directory up. `from` is
   *  that directory, as the file's name spells it. */
  | { readonly kind: 'no-package'; readonly name: string; readonly from: string }
  /** The package has `exports`, and it names no module for `subpath` (`.` for the name alone),
   *  maps it to `null`, or names a target that is not a file inside the package. */
  | { readonly kind: 'not-exported'; readonly name: string; readonly subpath: string }
  /** The name alone, of a package with no `exports`. `root` is its directory, `main` its
   *  `main` field, which the refusal may suggest a file from. */
  | {
      readonly kind: 'no-main';
      readonly name: string;
      readonly root: string;
      readonly main: string | undefined;
    };

/**
 * What `specifier`, written in `fromFile`, names (Rule 3.9, surface §68).
 *
 * - A relative specifier names a file by `resolveRelativeSpecifier`.
 * - Any other names a package, `name` or `@scope/name`, then an optional subpath. The package is
 *   the first `node_modules/<name>/package.json` `read` finds from the importing file's directory
 *   up to the root of its name, a directory named `node_modules` skipped, the order Node and
 *   TypeScript search in. With no `read`, nothing is found.
 * - With `exports`, the subpath is looked up in it as Node looks it up: a string target, a map of
 *   subpaths with single-`*` patterns (the longest prefix first), an array's first valid target,
 *   and `null` blocking a path. At each map of conditions the rule tries `typeshade`, then
 *   `import`, then `default`, in that order wherever the package wrote them. A target is a file
 *   inside the package: it begins with `./` and has no `.`, `..`, empty or `node_modules`
 *   segment.
 * - Without `exports`, a subpath names a file of the package by the relative rule (`.js` read as
 *   `.ts`, `.ts` appended), and the name alone names nothing.
 */
export function resolveSpecifier(
  fromFile: string,
  specifier: string,
  read: ReadDocument | undefined,
): Resolution {
  if (isRelativeSpecifier(specifier)) {
    return { kind: 'file', file: resolveRelativeSpecifier(fromFile, specifier)! };
  }
  if (specifier.startsWith('#')) return { kind: 'import-map' };
  const parsed = parsePackageSpecifier(specifier);
  if (parsed === undefined) return { kind: 'not-a-name' };
  const { name, subpath } = parsed;
  const found = findPackage(fromFile, name, read);
  if (found === undefined) return { kind: 'no-package', name, from: directoryOf(fromFile) };
  const { root, manifest } = found;
  if (manifest.exports !== undefined && manifest.exports !== null) {
    const target = exportsTarget(manifest.exports, subpath);
    if (typeof target !== 'string') return { kind: 'not-exported', name, subpath };
    return { kind: 'file', file: `${root}${target.slice(2)}` };
  }
  if (subpath === '.') {
    const main = typeof manifest.main === 'string' ? manifest.main : undefined;
    return { kind: 'no-main', name, root, main };
  }
  return { kind: 'file', file: resolveRelativeSpecifier(`${root}package.json`, subpath)! };
}

/** The file `specifier` written in `fromFile` names, or `undefined`: `resolveSpecifier` for a
 *  caller that needs only the file. */
export function resolveSpecifierFile(
  fromFile: string,
  specifier: string,
  read: ReadDocument | undefined,
): string | undefined {
  const resolution = resolveSpecifier(fromFile, specifier, read);
  return resolution.kind === 'file' ? resolution.file : undefined;
}

/** The package a file belongs to, read off its path: the directory after its last
 *  `node_modules/`. */
export interface PackageOfFile {
  /** The package's `name` from its `package.json`, or the directory it is installed under. */
  readonly name: string;
  /** Its `version`, or `undefined` when its `package.json` names none or cannot be read. */
  readonly version: string | undefined;
  /** The package's directory, ending in `/`. */
  readonly root: string;
  /** The file's path inside the package. */
  readonly path: string;
}

/**
 * The package `file` belongs to, or `undefined` for a file under no `node_modules`. A program
 * holds one copy of a package version (surface §68): `packageKey` names a file by the package's
 * name, its version and the file's path inside it, so two paths that reach one version read one
 * file, as a pnpm layout's links do.
 */
export function packageOf(file: string, read: ReadDocument | undefined): PackageOfFile | undefined {
  const marker = '/node_modules/';
  const at = file.lastIndexOf(marker);
  const start = at >= 0 ? at + marker.length : file.startsWith('node_modules/') ? 13 : -1;
  if (start < 0) return undefined;
  const segments = file.slice(start).split('/');
  const scoped = segments[0]!.startsWith('@');
  const nameSegments = scoped ? 2 : 1;
  if (segments.length <= nameSegments || segments[0]!.startsWith('.')) return undefined;
  const dirName = segments.slice(0, nameSegments).join('/');
  const root = `${file.slice(0, start)}${dirName}/`;
  const text = read?.(`${root}package.json`);
  const manifest = text === undefined ? {} : parseManifest(text);
  return {
    name: typeof manifest.name === 'string' && manifest.name !== '' ? manifest.name : dirName,
    version: typeof manifest.version === 'string' ? manifest.version : undefined,
    root,
    path: file.slice(root.length),
  };
}

/** One key per file of one package version, or `undefined` when the version is unknown. */
export function packageKey(pkg: PackageOfFile): string | undefined {
  return pkg.version === undefined ? undefined : `${pkg.name}@${pkg.version}/${pkg.path}`;
}

/** The fields of a `package.json` the rule reads. */
interface Manifest {
  readonly name?: unknown;
  readonly version?: unknown;
  readonly main?: unknown;
  readonly exports?: unknown;
}

/** A `package.json`'s fields, or none when it is not a JSON object. */
function parseManifest(text: string): Manifest {
  try {
    const value: unknown = JSON.parse(text);
    return isObject(value) ? value : {};
  } catch {
    return {};
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A package specifier's package name and its subpath, `.` or `./rest`, as Node splits them;
 *  `undefined` for a specifier that is not a package name. */
function parsePackageSpecifier(
  specifier: string,
): { readonly name: string; readonly subpath: string } | undefined {
  // An absolute path, a url, `node:fs`, a Windows drive: none of them names a package.
  if (specifier.startsWith('/') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(specifier)) return undefined;
  let end = specifier.indexOf('/');
  if (specifier.startsWith('@')) {
    if (end <= 1) return undefined;
    end = specifier.indexOf('/', end + 1);
  }
  const name = end === -1 ? specifier : specifier.slice(0, end);
  if (name === '' || name.endsWith('/') || name.startsWith('.') || /[\\%]/.test(name)) {
    return undefined;
  }
  const rest = specifier.slice(name.length);
  if (rest !== '' && hasInvalidSegment(rest.slice(1))) return undefined;
  return { name, subpath: `.${rest}` };
}

/** Whether a path has an empty, `.`, `..` or `node_modules` segment, percent-encoded or not:
 *  what keeps a target or a pattern's match inside its package. */
function hasInvalidSegment(path: string): boolean {
  return path.split(/[\\/]/).some((raw) => {
    let segment = raw;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      // A malformed escape is a name like any other.
    }
    segment = segment.toLowerCase();
    return segment === '' || segment === '.' || segment === '..' || segment === 'node_modules';
  });
}

/** The directory of `fileName` as its name spells it: `src` for `src/main.shade.ts`, `.` for a
 *  name with no directory. */
function directoryOf(fileName: string): string {
  const slash = fileName.lastIndexOf('/');
  if (slash < 0) return '.';
  const dir = fileName.slice(0, slash + 1);
  return dir === '/' || dir.endsWith('//') ? dir : dir.slice(0, -1);
}

/** The first `node_modules/<name>/package.json` `read` finds from `fromFile`'s directory up. */
function findPackage(
  fromFile: string,
  name: string,
  read: ReadDocument | undefined,
): { readonly root: string; readonly manifest: Manifest } | undefined {
  if (read === undefined) return undefined;
  for (const dir of ancestorsOf(fromFile)) {
    const root = `${dir}node_modules/${name}/`;
    const text = read(`${root}package.json`);
    if (text !== undefined) return { root, manifest: parseManifest(text) };
  }
  return undefined;
}

/** The directories a package is looked for in, each ending in `/` (or `''`, the directory a
 *  relative name is relative to): `fromFile`'s own, then each one above it, up to the root of
 *  its name, with a directory named `node_modules` skipped. A uri's scheme and authority, and a
 *  name's leading `..` segments, are kept on every one. */
function ancestorsOf(fromFile: string): string[] {
  const scheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/{0,2}/.exec(fromFile);
  const prefix = scheme ? scheme[0] : '';
  const pathPart = fromFile.slice(prefix.length);
  const lead = pathPart.startsWith('/') ? '/' : '';
  const segments: string[] = [];
  for (const segment of pathPart.split('/').slice(0, -1)) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..' && segments.length > 0 && segments[segments.length - 1] !== '..') {
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  let fixed = 0;
  while (fixed < segments.length && segments[fixed] === '..') fixed++;
  const out: string[] = [];
  for (let n = segments.length; n >= fixed; n--) {
    if (n > fixed && segments[n - 1] === 'node_modules') continue;
    out.push(`${prefix}${lead}${segments.slice(0, n).join('/')}${n > 0 ? '/' : ''}`);
  }
  return out;
}

/** The conditions a map of conditions is read by, in the order they are tried (proposal 0024):
 *  a package publishes its shader modules under `typeshade`, beside the JavaScript it publishes
 *  for hosts under `import` and `default`. */
const CONDITIONS = ['typeshade', 'import', 'default'] as const;

/** A target that is not a file inside the package: an array skips it; anywhere else it names
 *  nothing, as Node's "Invalid Package Target" does. */
const INVALID = Symbol('invalid target');

/** What a target resolves to: a path inside the package (`./src/noise.shade.ts`), `null` for a
 *  path the package blocks, `undefined` for one no condition matches, or `INVALID`. */
type Target = string | null | undefined | typeof INVALID;

/** The target `exports` gives `subpath` (Node's PACKAGE_EXPORTS_RESOLVE). */
function exportsTarget(exports: unknown, subpath: string): Target {
  if (isObject(exports)) {
    const keys = Object.keys(exports);
    const subpaths = keys.filter((k) => k.startsWith('.'));
    // Subpaths and conditions mixed in one object is a package configuration Node refuses.
    if (subpaths.length > 0 && subpaths.length !== keys.length) return INVALID;
    if (subpaths.length > 0) return subpathTarget(exports, subpath);
  }
  return subpath === '.' ? resolveTarget(exports, undefined) : undefined;
}

/** The target a map of subpaths gives `key`: its own entry, else the most specific pattern that
 *  matches it (Node's PACKAGE_IMPORTS_EXPORTS_RESOLVE). */
function subpathTarget(map: Record<string, unknown>, key: string): Target {
  if (Object.hasOwn(map, key) && !key.includes('*')) return resolveTarget(map[key], undefined);
  const patterns = Object.keys(map)
    .filter((k) => k.includes('*') && k.indexOf('*') === k.lastIndexOf('*'))
    .sort((a, b) => b.indexOf('*') - a.indexOf('*') || b.length - a.length);
  for (const pattern of patterns) {
    const star = pattern.indexOf('*');
    const base = pattern.slice(0, star);
    const trailer = pattern.slice(star + 1);
    if (!key.startsWith(base) || key === base) continue;
    if (trailer.length > 0 && !(key.endsWith(trailer) && key.length >= pattern.length)) continue;
    return resolveTarget(map[pattern], key.slice(base.length, key.length - trailer.length));
  }
  return undefined;
}

/** A target, with a pattern's `*` replaced by `match` (Node's PACKAGE_TARGET_RESOLVE, with the
 *  conditions tried in `CONDITIONS`' order). */
function resolveTarget(target: unknown, match: string | undefined): Target {
  if (typeof target === 'string') {
    if (!target.startsWith('./') || hasInvalidSegment(target.slice(2))) return INVALID;
    if (match === undefined) return target;
    if (hasInvalidSegment(match)) return INVALID;
    return target.replaceAll('*', match);
  }
  if (Array.isArray(target)) {
    // The first item that resolves; else the last `null` or invalid one, as Node falls back.
    let last: Target = undefined;
    for (const item of target) {
      const resolved = resolveTarget(item, match);
      if (resolved === undefined) continue;
      if (resolved === null || resolved === INVALID) {
        last = resolved;
        continue;
      }
      return resolved;
    }
    return target.length === 0 ? null : last;
  }
  if (target === null) return null;
  if (isObject(target)) {
    for (const condition of CONDITIONS) {
      if (!Object.hasOwn(target, condition)) continue;
      const resolved = resolveTarget(target[condition], match);
      if (resolved !== undefined) return resolved;
    }
    return undefined;
  }
  return INVALID;
}

/** Joins `dir` (a uri prefix ending in `/`, or `''`) with `specifier`, resolving only the
 * specifier's own `.`/`..` segments against `dir`'s path. `dir`'s own scheme and authority
 * (`file://`) or leading `/` are matched once up front and reattached verbatim rather than
 * re-split with everything else — re-splitting the whole concatenated string on `/` silently
 * ate a `file://` authority's slashes and an absolute uri's leading `/`, so `./lib.ts` from
 * `file:///main.ts` resolved to `file:/lib.ts` and from `/main.ts` to `lib.ts`, neither of
 * which is ever an open document's uri. */
function joinPath(dir: string, specifier: string): string {
  const scheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/{0,2}/.exec(dir);
  const prefix = scheme ? scheme[0] : '';
  const pathPart = dir.slice(prefix.length);
  const isAbsolute = pathPart.startsWith('/');
  const out: string[] = [];
  for (const seg of `${pathPart}${specifier}`.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return prefix + (isAbsolute ? '/' : '') + out.join('/');
}
