// ═══ dist/shade.d.ts — the ambient lib as a FILE, for `tsc` users outside the service ═══
//
// Design doc §9 listed this as deferred: "there is still no `shade.d.ts` file in the package,
// and no `types` entry pointing at one. The ambient declarations exist only as the `SHADE_DTS`
// string exported from `./language-service` (`ambient.ts`), which the service loads itself as
// a virtual library file. A `tsc` user authoring `.shade.ts` files outside the service (the
// Vite plugin, a bare `tsconfig`) has no bundled `.d.ts` to point `types` at yet."
//
// This is that file, WRITTEN FROM the string rather than copied beside it. `ambient.ts` derives
// its whole vocabulary from the compiler's own tables (SUPPORTED_TYPE_NAMES, SCALAR_CAST, the
// Math aliases, core/sot.ts's builtin array) precisely so the editor's view and the compiler's
// cannot drift; a hand-maintained second copy on disk would reintroduce exactly that drift one
// level further out. The only authority stays `src/language-service/ambient.ts`, and
// `src/publish-manifest.test.ts` D5 fails if what is on disk is not byte-for-byte what the
// string says.
//
// WHAT THE FILE IS FOR, AND WHAT IT IS NOT. It is written for a program compiled with
// `lib: []` — it declares its own `Array`, `Function`, `Object`, `Pick` and `Math` stand-ins,
// because the service creates its program that way (§6: "the lib is compiled with `lib: []` so
// DOM globals never enter the program"). Dropped into a program that DOES load the standard
// lib, those stand-ins collide with it head-on. README's "Type-checking `.shade.ts` with tsc"
// section says so and gives the tsconfig that works; the measurements are in the PR that added
// this script.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHADE_DTS } from '../src/language-service/ambient.js';

/** Where the emitted lib lives, package-relative. `package.json` `exports` names this same
 *  path for the `./shade` subpath — there is no source form of this file to point at. */
export const SHADE_DTS_PATH = 'dist/shade.d.ts';

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function main(): number {
  const out = join(PKG_DIR, SHADE_DTS_PATH);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, SHADE_DTS);
  console.error(`wrote ${SHADE_DTS_PATH} (${SHADE_DTS.length} chars) from SHADE_DTS`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main());
