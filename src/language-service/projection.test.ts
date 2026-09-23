// Verifies: Rule 12.7 (docs/language-design.md; traced in reqs/).
// The program the service builds reads each open document with the types TypeScript cannot
// infer written in, and answers in the document as written (#162, projection.ts).
//
// TypeScript types every arithmetic result as `number`, so `const uv = p.xy * frame.scale` gave
// `uv` the type `number`: `uv.x` was TS2339 in the editor, completion after `uv.` offered
// nothing, and hover said `number`, on a program the compiler accepts. A comparison of two
// vectors is a `boolean` to TypeScript the same way, where the compiler has a mask.

import { describe, expect, it } from 'vitest';
import { createTypeshadeLanguageService } from './service.js';
import { Projection, planInsertions } from './projection.js';

const SOURCE = `"use typeshade";
class Frame { time: f32; scale: f32; }
declare const frame: uniform<Frame>;
function tint(c: vec2): f32 { return c.x; }
@fragment
export function fs(@builtin("position") p: vec4): vec4 {
  const uv = p.xy * frame.scale; const bad: i32 = 1.5;
  const t = tint(uv) + uv.x;
  return vec4(uv.x, uv.y, t, 1);
}
`;
const LINES = SOURCE.split('\n');
const at = (line: number, text: string, plus = 0) => ({
  line,
  character: LINES[line]!.indexOf(text) + plus,
});

function open(src = SOURCE) {
  const service = createTypeshadeLanguageService();
  service.openDocument('a.shade.ts', src);
  return service;
}

describe('a local built by vector arithmetic has its vector type in the editor', () => {
  it('reports only the real error, at the place the author wrote it', () => {
    const d = open().getDiagnostics('a.shade.ts');
    // No TS2339 on `uv.x`, no TS2345 on `tint(uv)`: the one diagnostic is the real mismatch,
    // AFTER the insertion on its line, and its span is the text as written.
    expect(d.map((x) => x.code)).toEqual(['TS8003']);
    expect(SOURCE.slice(d[0]!.span.start, d[0]!.span.start + d[0]!.span.length)).toBe(
      'bad: i32 = 1.5',
    );
    expect(d[0]!.range.start).toEqual(at(6, 'bad'));
  });

  it('hovers, completes and finds references as a vec2', () => {
    const service = open();
    const hover = service.getHover('a.shade.ts', at(6, 'uv', 1));
    expect(hover?.contents).toContain('const uv: vec2<f32>');
    expect(hover?.range).toEqual({ start: at(6, 'uv'), end: at(6, 'uv', 2) });
    const labels = service.getCompletions('a.shade.ts', at(7, 'uv.x', 3)).map((c) => c.label);
    expect(labels).toEqual(expect.arrayContaining(['x', 'y', 'xy']));
    const refs = service.getReferences('a.shade.ts', at(6, 'uv', 1));
    expect(refs.map((r) => r.range.start)).toEqual([
      at(6, 'uv'),
      at(7, 'tint(uv)', 5),
      at(7, 'uv.x'),
      at(8, 'uv.x'),
      at(8, 'uv.y'),
    ]);
  });

  it('reads a mask, a bitwise result, a double and a module constant as the compiler types them', () => {
    const src = `"use typeshade";
const A = vec3(1., 2., 3.);
const Y = A * 2.;
export function f(a: vec3, b: vec3, u: vec3u, d: vec3f64, md: mat3<f64>): f32 {
  const m = a < b;
  const k = u & u;
  const w = d * f64(2.);
  const t = md * md;
  return select(0., 1., m.x) + f32(k.y) + f32(w.z) + Y.x;
}
`;
    const service = open(src);
    expect(service.getDiagnostics('a.shade.ts')).toEqual([]);
    const lines = src.split('\n');
    const hover = (line: number, name: string): string | undefined =>
      service
        .getHover('a.shade.ts', { line, character: lines[line]!.indexOf(`${name} =`) })
        ?.contents.split('\n')[1];
    expect(hover(4, 'm')).toBe('const m: vec3<bool>');
    expect(hover(5, 'k')).toBe('const k: vec3<u32>');
    expect(hover(6, 'w')).toBe('const w: vec3<f64>');
    expect(hover(7, 't')).toBe('const t: mat3x3<f64>');
    expect(hover(2, 'Y')).toBe('const Y: vec3<f32>');
  });

  it('colours the text as written and nothing the service inserted', () => {
    const tokens = open()
      .getSemanticTokens('a.shade.ts')
      .filter((t) => t.line === 6)
      .map((t) => LINES[6]!.slice(t.character, t.character + t.length));
    expect(tokens).not.toContain(' = p');
    expect(tokens.slice(0, 5)).toEqual(['const', 'uv', '=', 'p', 'xy']);
  });

  it('renames through the projection, and converts offsets against the text as written', () => {
    const service = open();
    const edits = service.rename('a.shade.ts', at(6, 'uv', 1), 'st')['a.shade.ts']!;
    let renamed = SOURCE;
    for (const e of [...edits].sort(
      (a, b) =>
        b.range.start.line - a.range.start.line ||
        b.range.start.character - a.range.start.character,
    )) {
      const s = service.offsetAt('a.shade.ts', e.range.start);
      const t = service.offsetAt('a.shade.ts', e.range.end);
      renamed = renamed.slice(0, s) + e.newText + renamed.slice(t);
    }
    expect(renamed).toContain('const st = p.xy * frame.scale;');
    expect(renamed).toContain('return vec4(st.x, st.y, t, 1);');
    // The last character of line 6 is where the author's text ends, not where the projected
    // text ends, which is `: vec2`.length further on.
    const end = SOURCE.indexOf('\n', SOURCE.indexOf('const uv'));
    expect(service.positionAt('a.shade.ts', end)).toEqual({ line: 6, character: LINES[6]!.length });
  });
});

describe('what is written in, and what is not', () => {
  const planned = (body: string): string[] => {
    const src = `"use typeshade";
export function f(a: vec3, b: vec3, s: f32, m: mat4x4, q: vec4, vi: vec2i, vu: vec3u, vb: vec3b, d: vec3f64, md: mat3<f64>): f32 {
${body}
  return 0;
}
`;
    return planInsertions(src, 'a.shade.ts').map((i) => `${src.slice(i.at - 1, i.at)}${i.text}`);
  };

  it('writes the vector or matrix type of an unannotated arithmetic local', () => {
    expect(planned('  const c = a + b;')).toEqual(['c: vec3']);
    expect(planned('  let n = -a;')).toEqual(['n: vec3']);
    expect(planned('  const mq = m * q;')).toEqual(['q: vec4']);
    expect(planned('  const mm = m * m;')).toEqual(['m: mat4x4']);
    expect(planned('  const w = vi + vec2i(1, 2);')).toEqual(['w: vec2i']);
  });

  it('writes the type of every other operation TypeScript types as a number or a boolean', () => {
    // A comparison is a `boolean` to TypeScript and a mask to the compiler; the bitwise and shift
    // operators, `**` and the unary ones a `number`, as arithmetic is (`ERASING_OPERATORS`).
    expect(planned('  const lt = a < b;')).toEqual(['t: vec3b']);
    expect(planned('  const ne = a !== b;')).toEqual(['e: vec3b']);
    expect(planned('  const x = vu & vu;')).toEqual(['x: vec3u']);
    expect(planned('  const sh = vu << vu;')).toEqual(['h: vec3u']);
    expect(planned('  const p = a ** b;')).toEqual(['p: vec3']);
    expect(planned('  const nb = !vb;')).toEqual(['b: vec3b']);
    expect(planned('  const t = ~vu;')).toEqual(['t: vec3u']);
    expect(planned('  const pa = +a;')).toEqual(['a: vec3']);
  });

  it('spells an emulated double and a matrix of doubles as the ambient library does', () => {
    expect(planned('  const w = d * f64(2.);')).toEqual(['w: vec3f64']);
    expect(planned('  const mt = md * md;')).toEqual(['t: mat3x3<f64>']);
  });

  it('writes the type of a module constant', () => {
    const src = `"use typeshade";
const A = vec3(1., 2., 3.);
const Y = A * 2.;
export function f(): vec3 {
  return Y;
}
`;
    expect(
      planInsertions(src, 'a.shade.ts').map((i) => `${src.slice(i.at - 1, i.at)}${i.text}`),
    ).toEqual(['Y: vec3']);
  });

  it('leaves alone what TypeScript already types: an annotation, a call, a scalar', () => {
    expect(planned('  const c: vec3 = a + b;')).toEqual([]);
    expect(planned('  const c = vec3(1, 2, 3);')).toEqual([]);
    expect(planned('  const k = s * 2;')).toEqual([]);
    expect(planned('  const d = dot(a, b) * s;')).toEqual([]);
  });

  it('writes nothing into a file without the directive', () => {
    expect(planInsertions('export const x = 1;\n', 'a.ts')).toEqual([]);
  });
});

describe('the offset maps', () => {
  const p = new Projection('ab cd ef', [
    { at: 2, text: ': X' },
    { at: 5, text: ': YY' },
  ]);

  it('builds the projected text', () => {
    expect(p.projected).toBe('ab: X cd: YY ef');
  });

  it('keeps an offset AT an insertion before it, and maps inserted text to its point', () => {
    expect([0, 2, 3, 5, 6, 8].map((o) => p.toProjected(o))).toEqual([0, 2, 6, 8, 13, 15]);
    // Every projected offset maps back: `ab: X cd: YY ef` to `ab cd ef`, the inserted `: X`
    // and `: YY` to the point each was inserted at, and the space after each to its own space.
    expect([...Array(p.projected.length + 1).keys()].map((o) => p.toOriginal(o))).toEqual([
      0, 1, 2, 2, 2, 2, 3, 4, 5, 5, 5, 5, 5, 6, 7, 8,
    ]);
    for (let o = 0; o <= 8; o++) expect(p.toOriginal(p.toProjected(o))).toBe(o);
  });
});
