// ═══ `random(seed)`: the declaration says what the refusal says, and what it still cannot say ═══
//
// WHAT MOVED. The free `random` was declared `random(seed: number | vec2 | vec3): f32` while the
// compiler refuses `u32`, `i32` and `f64` with `TS8003 random(seed) seed must be f32, vec2, or
// vec3`. The declaration now reads `f32 | vec2 | vec3`, which is what the refusal says and what
// the hover shows (#181, docs/language-design.md Rule 12.7: one vocabulary, not two).
//
// WHAT DID NOT MOVE, MEASURED (Rule 13.3). The change was expected to hand the three refused
// seeds to TypeScript's own checker, so an author would see them while typing rather than at
// compile time. It does not, and the reason is in the library: the scalar brands are OPTIONAL
// properties — `type f32 = number & { readonly [f32Tag]?: true }`, and the same shape for `i32`,
// `u32` and `f64` — so every branded scalar is structurally assignable to every other, and a
// `u32` argument satisfies an `f32` parameter. Measured through `createTypeshadeLanguageService`
// on the six programs below, the diagnostics are IDENTICAL before and after the declaration
// changed: the `TS8003` comes from the compile the service runs, and TypeScript contributes
// nothing. The vector arm is different, because `vecTag` is a REQUIRED property carrying the
// arity: a `vec4` seed draws `typescript 2345` on top of the `TS8003`, which is what the scalar
// arm would look like if the brands were required. Making them required is a change to every
// scalar on the surface and is not this one; this file pins what is true today so that the
// change which does it turns these cases red.
//
// The return type is not touched: `f32` is correct, and is the half of the declaration that was
// already right.

import { describe, expect, it } from 'vitest';
import { createTypeshadeLanguageService } from './service.js';
import { SHADE_DTS } from './ambient.js';
import { compile } from '../compiler/ts/compile.js';

const URI = 'random-seed.ts';

interface Verdict {
  /** Every diagnostic the editor shows, `<source> <code>` and the first line of the message. */
  readonly editor: string[];
  /** The diagnostics an editor attributes to TypeScript itself, which is the half the
   *  declaration's parameter type governs. */
  readonly typescript: string[];
  readonly compiler: string[];
  readonly emits: boolean;
}

function measure(source: string): Verdict {
  const service = createTypeshadeLanguageService();
  service.openDocument(URI, source);
  const shown = service.getDiagnostics(URI);
  const result = compile(source);
  return {
    editor: shown.map((d) => `${d.source ?? '?'} ${String(d.code)} ${d.message.split('\n')[0]!}`),
    typescript: shown.filter((d) => d.source === 'typescript').map((d) => `TS${String(d.code)}`),
    compiler: result.diagnostics.map((d) => `${d.code} ${d.message}`),
    emits: result.wgsl !== undefined,
  };
}

const seeded = (annotation: string): string =>
  `"use typeshade"\nexport function f(s: ${annotation}): f32 {\n  return random(s)\n}\n`;

const literal = (written: string): string =>
  `"use typeshade"\nexport function f(): f32 {\n  return random(${written})\n}\n`;

describe('the declaration of `random`', () => {
  it('takes the seed the compiler takes, and returns an f32', () => {
    expect(SHADE_DTS).toContain('declare function random(seed: f32 | vec2 | vec3): f32');
    expect(SHADE_DTS).not.toContain('declare function random(seed: number | vec2 | vec3)');
  });
});

describe('a seed the compiler refuses', () => {
  const refused: Readonly<Record<string, string>> = {
    u32: 'random(seed) seed must be f32, vec2, or vec3; got u32.',
    i32: 'random(seed) seed must be f32, vec2, or vec3; got i32.',
    f64: 'random(seed) seed must be f32, vec2, or vec3; got f64.',
  };

  for (const [annotation, sentence] of Object.entries(refused)) {
    it(`refuses a ${annotation} seed in one sentence, in both halves, and emits nothing`, () => {
      const verdict = measure(seeded(annotation));
      expect(verdict.compiler).toEqual([`TS8003 ${sentence}`]);
      expect(verdict.editor).toEqual([`typeshade TS8003 ${sentence}`]);
      expect(verdict.emits).toBe(false);
    });

    it(`the ${annotation} seed reaches the editor only as the compiler's sentence`, () => {
      // The measurement above, stated as the claim it disproves: naming the parameter `f32`
      // does NOT put TypeScript's checker on the case, because the scalar brands are optional
      // properties and a `u32` is assignable to an `f32`. A change that makes a brand required
      // turns this case red, and the line to write then is the `typescript 2345` the `vec4`
      // case below already shows.
      expect(measure(seeded(annotation)).typescript).toEqual([]);
    });
  }

  it('a vec4 seed is the shape a required brand gives: TypeScript speaks too', () => {
    const verdict = measure(seeded('vec4'));
    expect(verdict.compiler).toEqual([
      'TS8003 random(seed) seed must be f32, vec2, or vec3; got vec4<f32>.',
    ]);
    expect(verdict.typescript).toEqual(['TS2345']);
    expect(verdict.editor[1]).toContain(
      "is not assignable to parameter of type 'f32 | vec2 | vec3'",
    );
    expect(verdict.emits).toBe(false);
  });
});

describe('a seed that must keep compiling', () => {
  const accepted: Readonly<Record<string, string>> = {
    'an f32 parameter': seeded('f32'),
    'a vec2 parameter': seeded('vec2'),
    'a vec3 parameter': seeded('vec3'),
    // Rule 5.1: an integer literal in a float position is an `f32`, so `random(3)` is a seed of
    // 3.0 and not an `i32`. It compiled before the declaration named `f32` and still does — the
    // case this change was most likely to break, since `3` is not an `f32` to a reader.
    'a float literal': literal('0.5'),
    'an integer literal': literal('3'),
    'an f32 local from a literal':
      '"use typeshade"\nexport function f(): f32 {\n  const s: f32 = 0.5\n  return random(s)\n}\n',
  };

  for (const [what, source] of Object.entries(accepted)) {
    it(`${what} compiles with no diagnostic in either half`, () => {
      const verdict = measure(source);
      expect(verdict.editor).toEqual([]);
      expect(verdict.compiler).toEqual([]);
      expect(verdict.emits).toBe(true);
    });
  }

  it('the integer literal is the same seed as the float literal it stands for', () => {
    // `random(3)` and `random(3.)` are one program: if the literal were retargeted to an
    // integer the hash would take a different argument, and the emitted text would say so.
    expect(compile(literal('3')).wgsl).toEqual(compile(literal('3.')).wgsl);
  });
});
