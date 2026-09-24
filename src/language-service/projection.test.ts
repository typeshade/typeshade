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
import { compileTsSource } from '../compiler/ts/source-file.js';

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

// A function that writes no return type returns what its body does (Rule 8.19), and TypeScript
// types a return that does vector arithmetic `number`: `glow(uv).x` was TS2339, `tint(glow(uv))`
// TS2345, completion after `glow(uv).` empty, on a program the compiler accepts. An arrow
// function handed to a call was TS2322 on its body, beside a `Cannot find global type 'Promise'`
// that TypeScript's elaboration asks for.
const RETURNS = `"use typeshade";
function glow(p: vec2) {
  return p * 0.5;
}
class Orbit {
  r: f32 = 1.;
  at(t: f32) {
    return vec2(cos(t), sin(t)) * this.r;
  }
  get twice() {
    return vec2(this.r) * 2.;
  }
}
function tint(c: vec2): f32 {
  return c.x;
}
function apply(f: (x: vec2) => vec2, v: vec2): vec2 {
  return f(v);
}
@fragment
export function fs(@location(0) uv: vec2): vec4 {
  const o = new Orbit();
  const half = (q: vec2) => q * 0.5;
  const k = 2.;
  const a = apply((x) => x * k, uv) + apply(x => x * k, uv);
  const b = apply(function (x) { return x * k; }, uv);
  const t = glow(uv).x + tint(glow(uv)) + o.at(1.).y + o.twice.x + half(uv).x;
  return vec4(a.x + b.y + t, 0., 0., 1.);
}
`;
const RLINES = RETURNS.split('\n');
const rat = (line: number, text: string, plus = 0) => ({
  line,
  character: RLINES[line]!.indexOf(text) + plus,
});

describe('a function whose return does vector arithmetic has its vector type in the editor', () => {
  const service = () => {
    const s = createTypeshadeLanguageService();
    s.openDocument('r.shade.ts', RETURNS);
    return s;
  };

  it('reports nothing on a program the compiler accepts', () => {
    expect(service().getDiagnostics('r.shade.ts')).toEqual([]);
  });

  it('writes the return type after the parameter list, and parenthesizes a bare parameter', () => {
    const written = planInsertions(RETURNS, 'r.shade.ts').map(
      (i) => `${RETURNS.slice(Math.max(0, i.at - 8), i.at)}|${i.text}`,
    );
    // The two locals are #217's, and their type is the one TypeScript gives them anyway.
    expect(written).toEqual([
      'p: vec2)|: vec2',
      '(t: f32)|: vec2',
      ' twice()|: vec2',
      'q: vec2)|: vec2',
      ' const a|: vec2',
      'pply((x)|: vec2',
      '+ apply(|(',
      ' apply(x|): vec2',
      ' const b|: vec2',
      'tion (x)|: vec2',
    ]);
  });

  it('hovers and completes the call as a vec2', () => {
    const s = service();
    const labels = s.getCompletions('r.shade.ts', rat(26, 'glow(uv).x', 9)).map((c) => c.label);
    expect(labels).toEqual(expect.arrayContaining(['x', 'y', 'xy']));
    const hover = s.getHover('r.shade.ts', rat(1, 'glow', 1));
    expect(hover?.contents).toContain('vec2');
    expect(hover?.contents).not.toContain('number');
    expect(hover?.range).toEqual({ start: rat(1, 'glow'), end: rat(1, 'glow', 4) });
  });

  it('colours the text as written, and leaves alone a written type or a return with no arithmetic', () => {
    const tokens = service()
      .getSemanticTokens('r.shade.ts')
      .filter((t) => t.line === 1)
      .map((t) => RLINES[1]!.slice(t.character, t.character + t.length));
    expect(tokens).not.toContain(': vec2');
    expect(tokens).toEqual(expect.arrayContaining(['glow', 'p', 'vec2']));
    const plain = `"use typeshade";
function a(p: vec2): vec2 {
  return p * 0.5;
}
function b(p: vec2) {
  return vec2(p.y, p.x);
}
export function c(p: vec2) {
  return length(p) * 2.;
}
`;
    // `a` writes its type and `b` returns a call TypeScript types right, so neither is touched.
    // `c` returns scalar arithmetic, which TypeScript types `number` and the front end `f32`: its
    // return is written in since 0015's class B, as a vector one's always was.
    const at = plain.indexOf('c(p: vec2)') + 'c(p: vec2)'.length;
    expect(planInsertions(plain, 'p.shade.ts')).toEqual([{ at, text: ': f32' }]);
  });

  it('writes the return type of a function that returns a mask or a bitwise result', () => {
    // A return reads the operator table a local does (`ERASING_OPERATORS`): a comparison is a
    // `boolean` to TypeScript and a mask to the compiler, and `~` a `number` and a `vec3u`.
    const src = `"use typeshade";
function inside(p: vec3, lo: vec3) {
  return lo <= p;
}
function flip(a: vec3u) {
  return ~a;
}
export function f(p: vec3, a: vec3u): f32 {
  return select(0., 1., all(inside(p, vec3(0.)))) + f32(flip(a).x);
}
`;
    expect(
      planInsertions(src, 'm.shade.ts').map((i) => `${src.slice(i.at - 8, i.at)}|${i.text}`),
    ).toEqual(['o: vec3)|: vec3b', ': vec3u)|: vec3u']);
    const s = createTypeshadeLanguageService();
    s.openDocument('m.shade.ts', src);
    expect(s.getDiagnostics('m.shade.ts')).toEqual([]);
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

describe('a scalar field or a scalar return the document leaves unannotated (0015 class B)', () => {
  // TypeScript infers `number`, or a literal type, from `0.05` and from `this.r * 2.`; the front
  // end says `f32`. The projection writes the front end's type after the name or the parameter
  // list, so a hover, a completion and the call it feeds read `f32` as the compiler does.
  const src = `"use typeshade";
class Ring {
  static readonly MIN_WIDTH = 0.01;
  static drawn = 0.;
  #width = 0.05;
  r: f32 = 1.;
  get period() {
    return this.r * 2.;
  }
  width() {
    return max(this.#width, Ring.MIN_WIDTH);
  }
}
@fragment
export function fs(@location(0) uv: vec2): vec4 {
  const ring = new Ring();
  const falloff = (d: f32) => 0.004 / (d * d + 0.002);
  return vec4(ring.period + ring.width() + falloff(uv.x), 0., 0., 1.);
}
`;

  it('writes f32 after each unannotated scalar field and scalar return, and nothing else', () => {
    // `width()` returns a `max(...)` TypeScript already types `f32` (its overload is generated
    // from core.def), and `r` writes its type: neither is touched.
    const written = planInsertions(src, 'ring.shade.ts').map(
      (i) => `${src.slice(Math.max(0, i.at - 12), i.at)}|${i.text}`,
    );
    expect(written).toEqual([
      'ly MIN_WIDTH|: f32',
      'static drawn|: f32',
      '0.;\n  #width|: f32',
      'get period()|: f32',
      'f = (d: f32)|: f32',
    ]);
  });

  it('is a program both halves accept, and the editor hovers each as the compiler types it', () => {
    const compiled = compileTsSource(src);
    expect(compiled.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const typeAt = (text: string): string | undefined => {
      const start = src.indexOf(text);
      const e = compiled.expressions.find((x) => x.start === start && x.length === text.length);
      return e === undefined ? undefined : JSON.stringify(e.type);
    };
    const f32Type = JSON.stringify({ kind: 'scalar', scalar: 'f32' });
    expect(typeAt('ring.period')).toBe(f32Type);
    expect(typeAt('falloff(uv.x)')).toBe(f32Type);

    const s = createTypeshadeLanguageService();
    s.openDocument('ring.shade.ts', src);
    expect(s.getDiagnostics('ring.shade.ts')).toEqual([]);
    const hover = (text: string, offset: number): string =>
      s.getHover('ring.shade.ts', s.positionAt('ring.shade.ts', src.indexOf(text) + offset))
        ?.contents ?? '';
    expect(hover('ring.period', 'ring.'.length)).toContain('period: f32');
    expect(hover('Ring.MIN_WIDTH', 'Ring.'.length)).toContain('MIN_WIDTH: f32');
    expect(hover('this.#width', 'this.'.length)).toContain('#width: f32');
  });
});
