// A storage array of vectors or structs, indexed with an `i32`, on GLSL ES 3.00 (#388).
//
// WebGL2 has no storage buffer, so the GLSL writer reads a storage array from a data texture:
// element `i`'s first lane is `i * stride`, a `u32`. The index is what the author wrote, and a
// literal (`vs[0]`) or an `i32` variable is an `i32`, so the lowering built `i32 * u32`, which
// the module validator refuses. `compile()` gave the WGSL and no GLSL, with a `TS8015` warning
// in the validator's words; a `u32` index and an array of one-lane elements escaped it. The
// index is now converted to `u32` before it meets the stride (`laneIndex` in
// src/core/backends/glsl.ts).
//
// Which half the tests read (CLAUDE.md, "A test reads both halves"): the programs are valid, and
// the editor reported nothing on them before or after. What no test read was their GLSL:
// the storage-lowering tests build IR with `u32` literal indices, and no registered example
// indexes such an array with an `i32` in a fragment entry.
//
// Measured on 2026-09-28 on Chromium's WebGL2 (SwiftShader), each program's vertex and fragment
// GLSL compiled and linked (Rule 13.3). Before the fix, `vs[0]`, `vs[i]` (`i: i32`), `ls[1].b`,
// `ls[1].s` and `ls[i].a` had no GLSL, and `ls[u32(1)].b`, their neighbour, compiled and linked.
// After it, all six compiled and linked.

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const program = (body: string): string => `"use typeshade";
class L { a: vec4; b: vec4; s: f32; }
declare const ls: storage<array<L>>;
declare const vs: storage<array<vec4>>;
@fragment
export function fs(): vec4 { ${body} }
`;

/** The fragment GLSL of `body`, with the diagnostics of both halves. */
function both(body: string): { glsl: string | undefined; compiler: string[]; editor: string[] } {
  const src = program(body);
  const r = compile(src);
  const service = createTypeshadeLanguageService();
  service.openDocument('a.ts', src);
  const g = r.glsl as { fragment?: string } | string | undefined;
  return {
    glsl: typeof g === 'string' ? g : g?.fragment,
    compiler: r.diagnostics.map((d) => `${d.code} ${d.message}`),
    editor: service.getDiagnostics('a.ts').map((d) => `${String(d.code)} ${d.message}`),
  };
}

describe('a storage array of vectors or structs, indexed with an i32, on GLSL (#388)', () => {
  it.each([
    // An element's lanes: `L` is 12 lanes (a, b, s and the struct's padding), `b` starts at 4.
    ['return vs[0];', ['_sfetch(vs, int(0u))', '_sfetch(vs, int(3u))']],
    ['return ls[1].b;', ['_sfetch(ls, int(16u))', '_sfetch(ls, int(19u))']],
    ['return vec4(ls[1].s);', ['_sfetch(ls, int(20u))']],
    ['const i = i32(1); return vs[i];', ['(uint(1) * 4u)']],
    ['const i = i32(1); return ls[i].a;', ['(uint(1) * 12u)']],
  ])('%s has GLSL, reading the lanes the index names', (body, lanes) => {
    const r = both(body);
    expect(r.compiler).toEqual([]);
    expect(r.editor).toEqual([]);
    expect(r.glsl).toBeDefined();
    for (const lane of lanes) expect(r.glsl).toContain(lane);
  });

  it('leaves a u32 index as it was', () => {
    const r = both('return ls[u32(1)].b;');
    expect(r.compiler).toEqual([]);
    // Folded to the same lanes as `ls[1].b`, with no conversion added.
    expect(r.glsl).toContain('_sfetch(ls, int(16u))');
    expect(r.glsl).not.toContain('uint(');
  });
});
