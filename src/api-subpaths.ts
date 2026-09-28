// ═══ The public API subpaths: one list, read by both surface gates ═══
//
// Two gates read the public surface one `package.json` `exports` subpath at a time:
// `api-doc-coverage.test.ts` holds every export of an API subpath to a doc comment at its
// definition site, and `api-surface.test.ts` bakes each export's shape into `__api__/surface.md`.
// Each gate used to keep its own copy of this list, and the copies came apart. `./compute` joined
// `exports` in X-GIS #1946, and the doc gate's copy with it, because that gate's arm A5 failed
// until the subpath was classified. Nothing held the snapshot's copy, so no change to the types
// `typeshade/compute` exports could show in the snapshot. A second copy agrees with the first
// only until someone edits one of them (AGENTS.md#gate-discipline, one authority), so the list is
// kept once, here, and both gates import it.
//
// WHAT HOLDS IT. Arm A5 of `api-doc-coverage.test.ts` pins `API_SUBPATHS` and `NOT_API_SUBPATHS`
// together against the keys of `exports` by set equality, so a subpath the manifest gains fails
// there until it is classified here. Both gates read the same `API_SUBPATHS`, so a subpath
// classified as API is doc-checked and snapshotted at once, and neither gate can drop one
// without A5 failing. The cut that proved it: `./compute` deleted from `API_SUBPATHS` fails A5
// (the manifest exports a subpath nothing classifies) and the snapshot arm of
// `api-surface.test.ts` (the committed `./compute` section is no longer rendered).
//
// Test code in all but name: only those two tests import it, so tsconfig.json keeps it out of
// dist/ as it keeps them out.

/** The subpaths that ARE the public API. Every export of each owes a doc comment
 *  (`api-doc-coverage.test.ts`) and has its shape baked into `__api__/surface.md`
 *  (`api-surface.test.ts`), whose sections follow this order. */
export const API_SUBPATHS = [
  '.',
  './compute',
  './dev',
  './debug',
  './emit-prod',
  './vite',
  './core/ir',
  './language-service',
] as const;

/** Subpaths deliberately outside the public API, with the reason. Neither gate reads them.
 *  `./examples` is a curated gallery whose 36 objects already carry required `title` and
 *  `blurb` fields — a TSDoc on each would be a second authority for the same prose.
 *  `./shade` is not a TypeScript module at all: it resolves to `dist/shade.d.ts`, the ambient
 *  authoring lib written out of `SHADE_DTS` by `scripts/emit-shade-dts.ts` for a consumer to
 *  put in their `types` array. It exports no symbol a reader could import, so there is nothing
 *  to document or snapshot; the declarations carry their own prose, and `ambient.ts` carries the
 *  reasoning. Both are kept in their own list rather than as rows of the doc gate's allowlist so
 *  "wholesale" is never available as an escape hatch for real debt.
 *  `./runtime` is what a module the Vite plugin generates imports, and nothing else does
 *  (change 0009): its names are the contract between the generator and its output, from the
 *  same package version, and change with them, so no reader is promised them. */
export const NOT_API_SUBPATHS = ['./examples', './shade', './runtime'] as const;
