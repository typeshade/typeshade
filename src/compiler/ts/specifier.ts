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

/** Whether `specifier` names a file by a relative path (`./x`, `../x`). Anything else is a
 *  package, which a shader module does not import (roadmap X6). */
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
