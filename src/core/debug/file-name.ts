// ═══ Shader DSL: one spelling of a file name, so a breakpoint can match a span ═══
//
// A breakpoint carries the path its editor knows a file by; a `SourceSpan` carries the name
// the file was COMPILED under. An adapter takes both from the same place, the editor, so it
// would be reasonable to compare them with `===`, and that is what this module exists to stop.
//
// The two are not the same string. A span's `file` is `ts.SourceFile.fileName`, and
// `ts.createSourceFile` path-normalizes what it is handed: `./a.ts` arrives as `a.ts`,
// `C:\shaders\a.ts` as `C:/shaders/a.ts`, `a/../b.ts` as `b.ts`. The breakpoint side goes
// through no such thing. So an adapter on Windows that compiles under the editor's path and
// then sets a breakpoint on that same path compares `C:\shaders\a.ts` against
// `C:/shaders/a.ts` and arms nothing at all, silently, because a breakpoint that matches no
// statement is also how "the author put one on a blank line" looks.
//
// Normalizing BOTH sides costs one pass over a short string per breakpoint per pause and
// removes the whole class. It deliberately reproduces what TypeScript does rather than
// inventing a rule of its own. `file-name.test.ts` checks the two agree on every spelling it
// covers by running one through `compile()` and the other through here, so a TypeScript
// upgrade that changed the normalization would be reported rather than absorbed.

/** `name` with separators and redundant segments resolved, the way `ts.createSourceFile`
 *  resolves them: backslashes become slashes, a `.` segment is dropped, and a `..` segment
 *  cancels the segment before it unless there is none to cancel.
 *
 *  A root is kept whole (a leading `/`, a UNC `//`, a drive letter, or a URI's
 *  `scheme://authority/`) and
 *  so is a leading `..`, which has nothing before it to cancel. A trailing separator is
 *  kept. The name is not resolved against any directory and nothing
 *  on disk is consulted: two names that normalize alike are treated as one file, and that is
 *  the whole of the claim.
 *
 *  Not exported from the package. An adapter does not call this: it compares nothing itself;
 *  the session normalizes both sides for it.
 *
 *  @internal
 */
export function normalizeFileName(name: string): string {
  const slashed = name.replace(/\\/g, '/')
  // The root is kept whole and never walked: `file:///shaders/a.ts` has three slashes that
  // are part of the URI, not three empty segments, and a DAP client names files that way.
  const root = /^(?:[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/]*\/?|\/\/|\/)/.exec(slashed)?.[0] ?? ''
  const out: string[] = []
  for (const part of slashed.slice(root.length).split('/')) {
    if (part === '' || part === '.') continue
    // `..` after a real segment cancels it. After nothing, or after another `..` that itself
    // could not be cancelled, it has to stay: `../a.ts` names a sibling of the parent, and
    // dropping it would make it name a sibling of the file.
    if (part === '..' && out.length > 0 && out[out.length - 1] !== '..') out.pop()
    else out.push(part)
  }
  // A trailing separator survives, because TypeScript's does and the point of this function
  // is to land on the same string it does.
  const trailing =
    out.length > 0 && slashed.length > root.length && slashed.endsWith('/') ? '/' : ''
  return root + out.join('/') + trailing
}

/** Whether two file names name one file, after {@link normalizeFileName}.
 *
 *  @internal
 */
export function sameFileName(a: string, b: string): boolean {
  return a === b || normalizeFileName(a) === normalizeFileName(b)
}
