// ═══ The emit-golden helper — ONE bake protocol, shared by the suites that pin emits ═══
//
// Extracted when the `"use typeshade"` corpus got goldens of its own
// (`shade-examples.test.ts`) next to the EDSL corpus's (`emit-goldens.test.ts`). Both write
// into the same `__emit-goldens__/` directory and both must answer the same env flag, or a
// bake greens one suite and leaves the other red against files it just rewrote — the same
// invisible disagreement `_scan.ts` refuses to allow between the scan and the drift gate.
//
// Reads and writes the filesystem, so it is node-only: the leading underscore is this
// directory's mark for a helper that a browser build may not import (and that
// `discoverExamples` must not mistake for an example).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';

/** Where the committed emits live. Both corpora share it; ids are disjoint, which is an
 *  asserted invariant (`shade-examples.test.ts`) rather than a hope, because a collision
 *  would have two suites baking one file. */
const GOLDEN_DIR = join(dirname(fileURLToPath(import.meta.url)), '__emit-goldens__');

/** Re-bake protocol, unchanged from X-GIS #763 V3: `bun run bake:goldens` sets this, and the
 *  refreshed `__emit-goldens__/` is committed alongside the emitter change. */
const UPDATE = process.env.UPDATE_EMIT_GOLDENS === '1';

// CRLF note: goldens are committed text; git autocrlf checks them out with CRLF on Windows
// while the emitters only ever produce LF — normalise before comparing (masks line-ending
// noise only; the emitters have no CRLF code path).
const lf = (s: string): string => s.replace(/\r\n/g, '\n');

/**
 * Assert one emit is byte-equal to its committed golden, or write it when baking.
 *
 * @param file - golden filename, e.g. `hello.wgsl`, relative to {@link GOLDEN_DIR}.
 * @param emitted - the text the emitter just produced.
 */
export function checkGolden(file: string, emitted: string): void {
  const path = join(GOLDEN_DIR, file);
  if (UPDATE) {
    mkdirSync(GOLDEN_DIR, { recursive: true });
    writeFileSync(path, emitted);
    return;
  }
  expect(existsSync(path), `${file}: golden missing — bake with \`bun run bake:goldens\``).toBe(
    true,
  );
  expect(
    lf(emitted),
    `${file}: emit drifted from the committed golden — if intentional, re-bake with \`bun run bake:goldens\` and commit the diff`,
  ).toBe(lf(readFileSync(path, 'utf8')));
}
