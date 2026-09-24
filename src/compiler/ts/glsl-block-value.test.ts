// A uniform block's struct used as a value, on GLSL ES 3.00.
//
// `declare const u: uniform<U>` is a std140 block on GLSL, `layout(std140) uniform U { … } u;`,
// whose tag is the struct's own name, the one a GLSL host binds it by (`BindEntry.structName`).
// GLSL gives a block name no other use, so the writer declared no `struct U`, and every VALUE of
// `U` named a type that did not exist: a helper's parameter `float f(U x)`, a local `U copy;`, the
// `self_` of a method called on the uniform, a field `U inner;` of another block. `compile()`
// returned that text with no diagnostic, the editor's GLSL pane showed the same text, and ANGLE
// refused the stage. The WGSL was valid throughout. A local `const c = u` escaped only because
// copy propagation removes the local.
//
// Such a value now takes a twin struct, `U_value`, and a read of the block whole is rebuilt from
// its members (src/core/backends/glsl-block-values.ts). The block itself is emitted as before.
//
// Which half the tests read (CLAUDE.md, "A test reads both halves"): the two halves agreed, and
// rightly, since the program is valid: `compile()` reported nothing and neither did the editor.
// What no test read was this shape's GLSL on a driver. The compile gate compiles the registered
// examples, and none of them hands a uniform to a helper or copies one, so the text below is
// what these tests pin for both halves, and the measurement is the driver's.
//
// Measured on 2026-09-24 through the compile gate's instruments (Chromium's WebGPU and WebGL2 on
// SwiftShader, each handed a broken shader first), over temporary examples holding these
// programs (Rule 13.3). Before the fix, Tint accepted every WGSL and WebGL2 refused the fragment
// stage of the helper program and of the method program with `'U' : syntax error`, of the local
// copy with `'U' : variable expected`, and of the nested block with `'U' : syntax error`, while
// the `const c = u` program compiled. After it, every program compiled and linked, and so did
// one holding a module constant, a module variable, a struct holding the type, a list of it, a
// conditional between the uniform and a local, and a helper called from the vertex stage.

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { emitGlslFragment } from '../../core/backends/glsl.js';
import { lowerUniformBlockValues } from '../../core/backends/glsl-block-values.js';
import { reflect } from '../../core/reflect.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';
import { checkDocuments } from '../../language-service/check.js';

const VS = `class VsOut {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}

@vertex
export function vs(@builtin("vertex_index") idx: u32): VsOut {
  const x = f32(idx & 1) * 4. - 1.;
  const y = f32(idx >> 1) * 4. - 1.;
  return { pos: vec4(x, y, 0., 1.), uv: vec2(x, y) };
}`;

const program = (decls: string, body: string): string => `"use typeshade";

${decls}

${VS}

@fragment
export function fs(v: VsOut): vec4 {
${body}
}
`;

const U = `class U {
  a: f32;
  b: vec2;
}

declare const u: uniform<U>;`;

/** The block exactly as it was emitted before this change: the host's names do not move. */
const BLOCK = `layout(std140) uniform U {
  float a;
  vec2 b;
} u;`;

const TWIN = `struct U_value {
  float a;
  vec2 b;
};`;

/** Every line of `glsl` that spells the name `U` on its own. The block's tag is the only one. */
const namesU = (glsl: string): string[] => glsl.split('\n').filter((l) => /\bU\b/.test(l));

const CASES: readonly (readonly [label: string, source: string, lines: readonly string[]])[] = [
  [
    'a helper that takes the struct',
    program(
      `${U}

function f(x: U): f32 {
  return x.a + x.b.y;
}`,
      '  return vec4(f(u), v.uv.x, 0., 1.);',
    ),
    ['float f(U_value x) {', '  _ret = vec4(f(U_value(u.a, u.b)), uv.x, 0.0, 1.0);'],
  ],
  [
    'a local the uniform is assigned to',
    program(U, '  let copy: U;\n  copy = u;\n  return vec4(copy.a, copy.b.y, v.uv.x, 1.);'),
    ['  U_value copy;', '  copy = U_value(u.a, u.b);'],
  ],
  [
    'a method called on the uniform',
    program(
      `class U {
  a: f32;
  b: vec2;
  sum(): f32 {
    return this.a + this.b.y;
  }
}

declare const u: uniform<U>;`,
      '  return vec4(u.sum(), v.uv.x, 0., 1.);',
    ),
    ['float U_sum(U_value self_) {', '  _ret = vec4(U_sum(U_value(u.a, u.b)), uv.x, 0.0, 1.0);'],
  ],
  [
    'a method that writes its object, on a local copy',
    program(
      `class U {
  a: f32;
  b: vec2;
  bump(): void {
    this.a = this.a + 1.;
  }
}

declare const u: uniform<U>;`,
      '  let c: U = u;\n  c.bump();\n  return vec4(c.a, c.b.y, v.uv.x, 1.);',
    ),
    // The `inout` argument is the local itself, never a rebuilt copy of it.
    ['void U_bump(inout U_value self_) {', '  U_value c = U_value(u.a, u.b);', '  U_bump(c);'],
  ],
  [
    'a field of another block',
    program(
      `${U}

class W {
  inner: U;
  k: f32;
}

declare const w: uniform<W>;`,
      '  return vec4(w.inner.a + u.a, w.k, v.uv.x, 1.);',
    ),
    ['layout(std140) uniform W {', '  U_value inner;'],
  ],
];

describe('a uniform block struct used as a value, on GLSL ES 3.00', () => {
  for (const [label, src, lines] of CASES) {
    describe(label, () => {
      it('compile(): no diagnostic, and the value takes the twin beside the unchanged block', () => {
        const r = compile(src);
        expect(r.diagnostics).toEqual([]);
        expect(r.wgsl).toContain('var<uniform> u: U;');
        const glsl = r.glsl!.fragment;
        expect(glsl).toContain(TWIN);
        expect(glsl).toContain(BLOCK);
        for (const line of lines) expect(glsl.split('\n')).toContain(line);
        expect(namesU(glsl)).toEqual(['layout(std140) uniform U {']);
      });

      it("the language service: no diagnostic, and its GLSL pane is compile()'s text", () => {
        const service = createTypeshadeLanguageService();
        service.openDocument('a.ts', src);
        expect(service.getDiagnostics('a.ts')).toEqual([]);
        const pane = service.getCompiledOutput('a.ts', 'glsl-fragment')!;
        expect(pane.diagnostics).toEqual([]);
        expect(pane.text).toContain(TWIN);
        expect(pane.text).toBe(compile(src).glsl!.fragment);
      });

      it('typeshade check reports nothing', () => {
        const report = checkDocuments([{ path: 'a.shade.ts', uri: 'a.shade.ts', text: src }]);
        expect(report.diagnostics).toEqual([]);
      });
    });
  }
});

describe('what does not move', () => {
  it('the block keeps the name reflect() gives a host for getUniformBlockIndex', () => {
    const r = compile(CASES[0]![1]);
    const entry = reflect(r.module)
      .bindGroups.flatMap((g) => g.entries)
      .find((e) => e.name === 'u');
    expect(entry?.structName).toBe('U');
    expect(r.glsl!.fragment).toContain(BLOCK);
  });

  it('a module that only reads members declares no twin, and is lowered to itself', () => {
    const src = program(U, '  return vec4(u.a, u.b.y, v.uv.x, 1.);');
    const r = compile(src);
    expect(r.diagnostics).toEqual([]);
    expect(r.glsl!.fragment).toContain(BLOCK);
    expect(r.glsl!.fragment).not.toContain('U_value');
    expect(lowerUniformBlockValues(r.module)).toBe(r.module);
  });

  it('a local const copy was already folded away, and still is', () => {
    const r = compile(program(U, '  const c = u;\n  return vec4(c.a, c.b.y, v.uv.x, 1.);'));
    expect(r.diagnostics).toEqual([]);
    expect(r.glsl!.fragment).toContain('  _ret = vec4(u.a, u.b.y, uv.x, 1.0);');
    expect(r.glsl!.fragment).not.toContain('U_value');
  });
});

describe('the twin and its name', () => {
  it('is numbered past a name the module already has', () => {
    // `value()` on `U` is the module function `U_value`.
    const r = compile(
      program(
        `class U {
  a: f32;
  b: vec2;
  value(): f32 {
    return this.a;
  }
}

declare const u: uniform<U>;`,
        '  return vec4(u.value(), v.uv.x, 0., 1.);',
      ),
    );
    expect(r.diagnostics).toEqual([]);
    const glsl = r.glsl!.fragment.split('\n');
    expect(glsl).toContain('struct U_value_1 {');
    expect(glsl).toContain('float U_value(U_value_1 self_) {');
    expect(glsl).toContain('  _ret = vec4(U_value(U_value_1(u.a, u.b)), uv.x, 0.0, 1.0);');
  });

  it('never carries a double underscore, which ANGLE refuses in any name', () => {
    const r = compile(
      program(
        `class Pad_ {
  a: f32;
}

declare const u: uniform<Pad_>;

function f(x: Pad_): f32 {
  return x.a;
}`,
        '  return vec4(f(u), v.uv.x, 0., 1.);',
      ),
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.glsl!.fragment).toContain('struct Pad_value {');
    expect(r.glsl!.fragment).not.toContain('__');
  });

  it('is declared in the stage that uses it, and only there', () => {
    const src = `"use typeshade";

${U}

function f(x: U): f32 {
  return x.a + x.b.y;
}

${VS.replace('uv: vec2(x, y)', 'uv: vec2(x, y * f(u))')}

@fragment
export function fs(v: VsOut): vec4 {
  return vec4(v.uv, u.a, 1.);
}
`;
    const r = compile(src);
    expect(r.diagnostics).toEqual([]);
    expect(r.glsl!.vertex).toContain(TWIN);
    expect(r.glsl!.vertex).toContain('  uv = vec2(x, (y * f(U_value(u.a, u.b))));');
    expect(r.glsl!.fragment).not.toContain('U_value');
  });

  it("is a plain struct in a declarations-only fragment's manifest, and the block is not", () => {
    const f = emitGlslFragment(compile(CASES[0]![1]).module, 'fragment');
    expect(f.source).toContain(TWIN);
    expect(f.declares.structs).toContain('U_value');
    expect(f.declares.structs).not.toContain('U');
    expect(f.declares.bindings).toContain('u');
  });
});
