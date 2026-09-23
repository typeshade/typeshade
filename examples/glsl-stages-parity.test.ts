// ═══ emitGlslStages ≡ two emitGlslModule calls (byte-identity gate) ═══
//
// `emitGlslStages` exists to pay the IR half of a GLSL emit ONCE per module instead of
// once per stage: `lowerForGlsl` runs validate → autoVars → lowerModule → fp64Lower →
// the optimizer FIXPOINT, and on a heavy fragment (map's multidirectional hillshade,
// ~770 ms per emit) that dominates. It is only a legal substitution if the shared
// lowered module spells IDENTICALLY to two independently-lowered ones, which needs two
// properties that are easy to break silently:
//
//   1. the lowering is DETERMINISTIC (same authored module in → same lowered out), and
//   2. the spelling half does NOT mutate the lowered module it reads — otherwise the
//      SECOND stage in emitGlslStages sees a module the first one edited, and only the
//      fragment (emitted second) would drift.
//
// Asserting BOTH stages over the whole renderable example corpus catches either one:
// a mutating emitter shows up as a fragment mismatch, a non-deterministic lowering as
// a vertex mismatch. This is the gate the WGSL/GLSL goldens cannot give — they pin what
// `emitGlslModule` produces, not that the shared-lowering path agrees with it.

import { describe, it, expect } from 'vitest';
import { examples } from './index.js';
import { shadeExamples } from './_shade.js';
import { emitGlslModule, emitGlslStages } from '../src/index.js';

describe('emitGlslStages — shared lowering is byte-identical to per-stage lowering', () => {
  const renderable = examples.filter((e) => e.renderable);

  it('covers a real corpus (a registry that stops being renderable must not silently skip)', () => {
    expect(renderable.length).toBeGreaterThanOrEqual(2);
  });

  for (const ex of renderable) {
    it(`${ex.id}: both stages match emitGlslModule byte-for-byte`, () => {
      const both = emitGlslStages(ex.module);
      expect(both.vertex).toBe(emitGlslModule(ex.module, 'vertex'));
      expect(both.fragment).toBe(emitGlslModule(ex.module, 'fragment'));
    });
  }

  it('is idempotent — a second call over the same authored module emits the same bytes', () => {
    // Guards the other direction of the mutation hazard: `lowerForGlsl` must not edit
    // the AUTHORED module either, or the second pipeline built from a memoised module
    // (exactly what a draper does for its pick variant) would diverge from the first.
    const ex = renderable[0]!;
    const a = emitGlslStages(ex.module);
    const b = emitGlslStages(ex.module);
    expect(b.vertex).toBe(a.vertex);
    expect(b.fragment).toBe(a.fragment);
  });

  // X-GIS #1673 — the float-precision emit option reaches BOTH stage strings. emitGlslStages
  // spells the shared lowered module twice (assembleGlsl per stage), so an option read
  // in only one of those calls would ship a highp vertex beside a mediump fragment and
  // still look fine in any single-stage test. Asserted over the whole renderable corpus
  // so a family whose vertex is shared across variants cannot hide it.
  for (const ex of renderable) {
    it(`${ex.id}: floatPrecision threads through emitGlslStages into both stages`, () => {
      const both = emitGlslStages(ex.module, { floatPrecision: 'mediump' });
      expect(both.vertex).toContain('precision mediump float;');
      expect(both.fragment).toContain('precision mediump float;');
      expect(both.vertex).not.toContain('precision highp float;');
      expect(both.fragment).not.toContain('precision highp float;');
      // BYTE-NEUTRALITY of the default, over the same real corpus the goldens cover:
      // an explicit 'highp' must reproduce the option-free bytes exactly, and the only
      // difference to the mediump emit is that one token.
      const def = emitGlslStages(ex.module);
      expect(emitGlslStages(ex.module, { floatPrecision: 'highp' })).toEqual(def);
      expect(both.vertex.replace('precision mediump float;', 'precision highp float;')).toBe(
        def.vertex,
      );
      expect(both.fragment.replace('precision mediump float;', 'precision highp float;')).toBe(
        def.fragment,
      );
    });
  }
});

// ═══ A fragment local that shadows an input varying is correct only because of ORDER (#62) ═══
//
// Three of the porting twins emit a `main()` that declares a local with the same name as an
// `in` varying:
//
//   in vec2 uv;
//   void main() {
//     VsOut vo;
//     vo.pos = gl_FragCoord;
//     vo.uv = uv;        // reads the VARYING
//     vec2 uv = vo.uv;   // from here on, `uv` is the LOCAL
//     …
//
// This is not a miscompile and could not be turned into one on the current emitter. It is
// CORRECT for a reason the emitter never states: the gather prelude is emitted before the body,
// so the one read of the global precedes the declaration that shadows it. Reverse that order
// and the shader silently reads the wrong `uv`.
//
// The emitter already reasons about this class — `backends/glsl.ts` keeps the wrapper when a
// top-level local collides with a SCATTER target, and declines the field-inlining path when a
// body local collides with a varying the gather would substitute, which is exactly what these
// three hit. What is undeclared is that the resulting emit depends on the prelude staying in
// front. Plausible ways to break it: materialising the aggregate lazily at first use, hoisting
// user declarations to the top of `main()`, or extending field-inlining to substitute the reads
// the current bail-out rejects. Under any of them `vec2 uv = vo.uv;` starts capturing the read.
//
// The failure mode is the one this repository has been bitten by twice (#13, #40): the shader
// still compiles, still links and still runs, and the only signal is a re-baked golden — which
// says "this moved", not "this is now wrong". So the invariant is asserted here instead, from a
// fresh emit rather than from the goldens, and it changes no golden and no `src/`.
describe('a fragment local that shadows an input varying reads the varying first (#62)', () => {
  /** `in vec2 uv;`, with the interpolation and precision qualifiers GLSL ES 3.00 allows. */
  const IN_DECL =
    /^\s*(?:flat\s+|smooth\s+|centroid\s+)*in\s+(?:lowp\s+|mediump\s+|highp\s+)?\w+\s+(\w+)\s*;/gm;

  /** The text between `void main() {` and its matching brace. Brace-matched rather than
   *  regexed: a `main()` containing an `if` block would defeat a lazy `[\s\S]*?}`. */
  function mainBodyOf(text: string): string {
    const at = text.indexOf('void main()');
    if (at < 0) return '';
    const open = text.indexOf('{', at);
    let depth = 0;
    for (let i = open; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') {
        depth--;
        if (depth === 0) return text.slice(open + 1, i);
      }
    }
    return '';
  }

  /** Where `main()` declares a local called `name`, or `-1`. */
  const localDeclOf = (body: string, name: string): number =>
    new RegExp(
      `(?:^|\\n)\\s*(?:lowp |mediump |highp )?\\w+(?:\\s*\\[\\s*\\d*\\s*\\])?\\s+${name}\\s*(?:=|;)`,
    ).exec(body)?.index ?? -1;

  /** Every mention of `name` as an identifier of its own — a `.name` is a FIELD of some other
   *  value (`vo.uv`), not a read of the varying, and counting it would hide the real one. */
  const bareUses = (text: string, name: string): number =>
    [...text.matchAll(new RegExp(`(^|[^.\\w])${name}\\b`, 'g'))].length;

  /** Every example whose fragment stage emits the shadowing shape, by re-emitting it. */
  const shadowed = (): { id: string; name: string; body: string; decl: number }[] => {
    const found: { id: string; name: string; body: string; decl: number }[] = [];
    for (const ex of [...examples, ...shadeExamples]) {
      if (!ex.renderable) continue;
      let fragment: string;
      try {
        fragment = emitGlslModule(ex.module, 'fragment');
      } catch {
        continue;
      }
      const body = mainBodyOf(fragment);
      for (const m of fragment.matchAll(IN_DECL)) {
        const name = m[1] ?? '';
        const decl = localDeclOf(body, name);
        if (decl >= 0) found.push({ id: ex.id, name, body, decl });
      }
    }
    return found;
  };

  it('finds the shape in the corpus, so the arm below is asserting over something', () => {
    // Measured 2026-09-21: exactly three, all porting twins that spell `const uv = vo.uv`.
    // If this ever reaches zero the emitter has stopped producing the shape — which is a fine
    // outcome, and the moment to decide whether this suite still has a job.
    const cases = shadowed();
    expect(cases.map((c) => `${c.id}:${c.name}`).sort()).toEqual([
      'hillshade-twin:uv',
      'julia-twin:uv',
      'plasma-twin:uv',
    ]);
  });

  it('reads the varying into the aggregate BEFORE the local that shadows it is declared', () => {
    for (const { id, name, body, decl } of shadowed()) {
      const before = body.slice(0, decl);
      const gather = [...before.matchAll(new RegExp(`\\w+\\.\\w+\\s*=\\s*${name}\\s*;`, 'g'))];
      // The read exists and is in front. If it moved after the declaration it would still
      // compile, still link and read the LOCAL — the silent miscompile this pins.
      expect(
        gather.length,
        `${id}: no read of the varying "${name}" precedes its shadowing local`,
      ).toBeGreaterThan(0);
      // …and it is the ONLY use in front, so nothing else is quietly depending on the order.
      expect(
        bareUses(before, name),
        `${id}: "${name}" is used before its shadowing local for something other than the gather`,
      ).toBe(gather.length);
    }
  });

  it('reads nothing but the LOCAL after the declaration, which is what makes the order load-bearing', () => {
    // The other half of the pair: after the shadowing declaration every mention resolves to the
    // local, so the emitter gets no second chance to read the varying. That is precisely why the
    // prelude's position is the whole invariant rather than a detail of layout.
    for (const { id, name, body, decl } of shadowed()) {
      const after = body.slice(decl);
      expect(
        [...after.matchAll(new RegExp(`\\w+\\.\\w+\\s*=\\s*${name}\\s*;`, 'g'))],
        `${id}: the varying "${name}" is read again after the local shadows it`,
      ).toEqual([]);
    }
  });
});
