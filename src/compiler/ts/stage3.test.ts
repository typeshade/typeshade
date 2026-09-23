// Stage 3 TypeShade checks (design doc §5, §10 step 5): builtin allow-list, builtin-to-stage
// compatibility, @compute workgroup shape, missing return annotation on an entry function, and
// (optional) mat2/mat3 rejection. Each gets a positive (stays clean) and a negative (fires with
// the right code) case.
//
// Verifies: Rule 6.6, Rule 6.7, Rule 8.7 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from './compile.js';
import { compileTsSource } from './source-file.js';
import { TS_CODES } from './codes.js';
import {
  ATTRIBUTE_NAMES,
  WGSL_ATTRIBUTES_ELSEWHERE,
  WGSL_MEMBER_ATTRIBUTES,
} from './builtin-check.js';
import { reflect } from '../../core/reflect.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

function diag(source: string) {
  return compileTsSource(source);
}

/** The editor's diagnostics on the same source, as `[source, code, message]`. */
function editor(source: string): (string | number)[][] {
  const service = createTypeshadeLanguageService();
  service.openDocument('a.ts', source);
  return service.getDiagnostics('a.ts').map((d) => [d.source, d.code, d.message]);
}

/** Why a written `@group` or `@binding` is not applied, whichever form declares the binding. */
const SLOT =
  "is WGSL's attribute, and is not applied: reflect() reports the group and slot each binding " +
  'gets. Remove it, and read the slot from reflect() on the host.';

/** Why `@std140` is not applied anywhere but on a class, which has its own sentence. */
const STD140 =
  '"@std140" is not applied: WGSL lays out a struct by its own rules, which reflect() reports. ' +
  'Remove it.';

describe('builtin name allow-list (BUILTIN_NAME)', () => {
  it('rejects a typo\'d builtin with a "Did you mean" suggestion', () => {
    const r = diag(`
      "use typeshade";
      export function vs(@builtin("vertex_idx") i: u32): vec4 {
        return vec4(0., 0., 0., 1.);
      }
    `);
    const d = r.diagnostics.find((d) => d.code === TS_CODES.BUILTIN_NAME);
    expect(d, 'expected a BUILTIN_NAME diagnostic').toBeDefined();
    expect(d!.category).toBe('error');
    expect(d!.message).toContain('Unknown builtin "vertex_idx"');
    expect(d!.message).toContain('Did you mean "vertex_index"?');
  });

  it('accepts every real WgslBuiltinName with zero BUILTIN_NAME diagnostics', () => {
    const r = diag(`
      "use typeshade";
      export function vs(@builtin("vertex_index") i: u32): vec4 {
        return vec4(0., 0., 0., 1.);
      }
    `);
    expect(r.diagnostics.filter((d) => d.code === TS_CODES.BUILTIN_NAME)).toEqual([]);
  });

  it('gives the BUILTIN_NAME diagnostic a span over the string literal argument', () => {
    const r = diag(`
      "use typeshade";
      export function vs(@builtin("vertex_idx") i: u32): vec4 {
        return vec4(0., 0., 0., 1.);
      }
    `);
    const d = r.diagnostics.find((d) => d.code === TS_CODES.BUILTIN_NAME)!;
    expect(r.sourceFile.text.slice(d.start, d.start + d.length)).toBe('"vertex_idx"');
  });
});

describe('builtin stage/direction compatibility (BUILTIN_STAGE)', () => {
  it('rejects a fragment-only input builtin on a vertex parameter', () => {
    const r = diag(`
      "use typeshade";
      @vertex
      export function vs(@builtin("front_facing") f: bool): vec4 {
        return vec4(0., 0., 0., 1.);
      }
    `);
    const d = r.diagnostics.find((d) => d.code === TS_CODES.BUILTIN_STAGE);
    expect(d, 'expected a BUILTIN_STAGE diagnostic').toBeDefined();
    expect(d!.category).toBe('error');
    expect(d!.message).toContain('front_facing');
    expect(d!.message).toContain('vertex input');
  });

  it('accepts vertex_index as a vertex input', () => {
    const r = diag(`
      "use typeshade";
      @vertex
      export function vs(@builtin("vertex_index") i: u32): vec4 {
        return vec4(0., 0., 0., 1.);
      }
    `);
    expect(r.diagnostics.filter((d) => d.code === TS_CODES.BUILTIN_STAGE)).toEqual([]);
  });

  it('accepts position as a vertex output and the same struct field as a fragment input', () => {
    const r = diag(`
      "use typeshade";
      class Clip {
        @builtin("position") pos: vec4;
      }
      @vertex
      export function vs(): Clip {
        return { pos: vec4(0., 0., 0., 1.) };
      }
      @fragment
      export function fs(v: Clip): vec4 {
        return v.pos;
      }
    `);
    expect(r.diagnostics.filter((d) => d.code === TS_CODES.BUILTIN_STAGE)).toEqual([]);
  });

  it('rejects frag_depth (a fragment output) used as a vertex return struct field', () => {
    const r = diag(`
      "use typeshade";
      class Out {
        @builtin("frag_depth") d: f32;
      }
      @vertex
      export function vs(): Out {
        return { d: 1. };
      }
    `);
    const d = r.diagnostics.find((d) => d.code === TS_CODES.BUILTIN_STAGE);
    expect(d, 'expected a BUILTIN_STAGE diagnostic for the struct field').toBeDefined();
    expect(d!.message).toContain('frag_depth');
    expect(d!.message).toContain('vertex output');
  });

  it('accepts the compute builtins as compute inputs', () => {
    const r = diag(`
      "use typeshade";
      @compute([64])
      export function cs(@builtin("global_invocation_id") id: vec3): void {
      }
    `);
    expect(r.diagnostics.filter((d) => d.code === TS_CODES.BUILTIN_STAGE)).toEqual([]);
  });
});

describe('@compute workgroup shape', () => {
  it('carries a two-dimensional shape to the emitted attribute and the reflection', () => {
    const r = compile(`"use typeshade";
declare const dst: storage<array<u32>, "read_write">;
@compute([8, 8])
export function cs(@builtin("global_invocation_id") gid: vec3u): void {
  dst[gid.y * 64 + gid.x] = gid.x + gid.y;
}
`);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('@compute @workgroup_size(8, 8)');
    const entry = reflect(r.module).entries.find((e) => e.name === 'cs');
    expect(entry?.workgroupShape).toEqual([8, 8, 1]);
    expect(entry?.workgroupSize).toBe(8);
  });

  it('carries a three-dimensional shape, keeping a y of 1 between x and z', () => {
    const r = compile(`"use typeshade";
declare const dst: storage<array<u32>, "read_write">;
@compute([4, 1, 2])
export function cs(@builtin("local_invocation_index") i: u32): void {
  dst[i] = i;
}
`);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('@compute @workgroup_size(4, 1, 2)');
    expect(reflect(r.module).entries[0]?.workgroupShape).toEqual([4, 1, 2]);
  });

  it('emits a one-dimensional shape as it always did', () => {
    for (const deco of ['@compute', '@compute([64])', '@compute([64, 1, 1])']) {
      const r = compile(`"use typeshade"
declare const dst: storage<array<u32>, "read_write">
${deco}
export function cs(@builtin("global_invocation_id") gid: vec3u): void {
  dst[gid.x] = gid.x
}
`);
      expect(r.diagnostics, deco).toEqual([]);
      expect(r.wgsl, deco).toContain('@compute @workgroup_size(64)\n');
      expect(reflect(r.module).entries[0]?.workgroupShape, deco).toEqual([64, 1, 1]);
    }
  });

  it.each([
    ['[512]', 'x = 512, over maxComputeWorkgroupSizeX (256)'],
    ['[1, 300]', 'y = 300, over maxComputeWorkgroupSizeY (256)'],
    ['[1, 1, 65]', 'z = 65, over maxComputeWorkgroupSizeZ (64)'],
    ['[16, 16, 2]', '512 invocations, over maxComputeInvocationsPerWorkgroup (256)'],
  ])('warns (WORKGROUP_SHAPE) that %s exceeds a default WebGPU limit', (shape, clause) => {
    const r = diag(`
      "use typeshade";
      @compute(${shape})
      export function cs(): void {
      }
    `);
    const d = r.diagnostics.find((d) => d.code === TS_CODES.WORKGROUP_SHAPE);
    expect(d, 'expected a WORKGROUP_SHAPE diagnostic').toBeDefined();
    expect(d!.category).toBe('warning');
    expect(d!.message).toContain(clause);
  });

  it('stays silent at the default limits themselves', () => {
    for (const shape of ['[256]', '[16, 16]', '[4, 4, 16]', '[1, 1, 64]']) {
      const r = diag(`
        "use typeshade";
        @compute(${shape})
        export function cs(): void {
        }
      `);
      expect(
        r.diagnostics.filter((d) => d.code === TS_CODES.WORKGROUP_SHAPE),
        shape,
      ).toEqual([]);
    }
  });
});

describe('@compute argument shapes (#118, WORKGROUP_ARG)', () => {
  const cs = (deco: string) => `
      "use typeshade";
      const SIZE = 64;
      ${deco}
      export function cs(): void {
      }
    `;
  it('refuses an object, a bare number, a string and an identifier instead of defaulting to 64', () => {
    // Every row compiled with zero diagnostics and emitted `@workgroup_size(64)` (#118): the
    // author asked for one size and dispatched against another.
    for (const written of ['{ workgroup: [8, 8, 1] }', '128', '"big"', 'SIZE']) {
      const r = diag(cs(`@compute(${written})`));
      const d = r.diagnostics.find((d) => d.code === TS_CODES.WORKGROUP_ARG);
      expect(d, `expected WORKGROUP_ARG for @compute(${written})`).toBeDefined();
      expect(d!.category).toBe('error');
      expect(d!.message).toContain(`"${written}" is not a workgroup shape`);
      expect(d!.message).toContain('@compute([64, 1, 1])');
    }
  });

  it('refuses an empty array, a fourth axis, a fraction and a zero', () => {
    for (const written of ['[]', '[64, 1, 1, 1]', '[1.5]', '[0]']) {
      const r = diag(cs(`@compute(${written})`));
      expect(
        r.diagnostics.some((d) => d.code === TS_CODES.WORKGROUP_ARG),
        `expected WORKGROUP_ARG for @compute(${written})`,
      ).toBe(true);
    }
  });

  it('keeps the default of 64 for a bare @compute and for @compute()', () => {
    for (const deco of ['@compute', '@compute()']) {
      const r = compile(cs(deco));
      expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
      expect(r.wgsl).toContain('@workgroup_size(64)');
    }
  });

  it('reads the size the author wrote, across lines and through as const', () => {
    const r1 = compile(
      cs(`@compute([
        128,
        1,
        1,
      ])`),
    );
    expect(r1.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(r1.wgsl).toContain('@workgroup_size(128)');
    const r2 = compile(cs('@compute([256] as const)'));
    expect(r2.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(r2.wgsl).toContain('@workgroup_size(256)');
  });
});

describe('entry function missing a return type annotation but returning a value (RETURN_SHAPE)', () => {
  it('is an error naming the inferred type', () => {
    const r = diag(`
      "use typeshade";
      @fragment
      export function fs() {
        return vec4(1., 0., 0., 1.);
      }
    `);
    const d = r.diagnostics.find((d) => d.code === TS_CODES.RETURN_SHAPE && d.category === 'error');
    expect(d, 'expected an error-level RETURN_SHAPE diagnostic').toBeDefined();
    expect(d!.message).toContain('vec4<f32>');
    expect(d!.message).toContain('no return type annotation');
  });

  it('is silent for an ordinary helper function with no return annotation (Rule 8.19)', () => {
    const r = diag(`
      "use typeshade";
      export function helper() {
        const x = 1.;
      }
    `);
    expect(r.diagnostics.filter((d) => d.code === TS_CODES.RETURN_SHAPE)).toEqual([]);
  });

  it('is silent for an entry function with no return annotation that truly returns nothing', () => {
    const r = diag(`
      "use typeshade";
      @vertex
      export function vs(): void {
      }
    `);
    expect(r.diagnostics.filter((d) => d.code === TS_CODES.RETURN_SHAPE)).toEqual([]);
  });

  it('still errors (declared type) for an annotated entry function that returns the wrong type', () => {
    const r = diag(`
      "use typeshade";
      @fragment
      export function fs(): vec4 {
        return vec4(1., 0., 0., 1.);
      }
    `);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  });
});

// `mat2` and `mat3` used to be refused as MAT_UNSUPPORTED, on the recorded ground that "a 2×2
// or 3×3 float matrix lays out differently under the WGSL and GLSL std140 rules". Measured
// (#149), that is half right: a two-ROW matrix diverges and a 3×3 does not, and the divergence
// belongs to the uniform LAYOUT rather than to the type. Every `matCxR` is spellable now; what
// MAT_UNSUPPORTED still marks is the shape the fp64 pass cannot carry.
describe('every matCxR is a type, and the f64 ones are square-only (MAT_UNSUPPORTED)', () => {
  it('accepts mat2<f32> as a parameter type, the generic form that used to be refused', () => {
    const r = diag(`
      "use typeshade";
      export function f(m: mat2<f32>): vec2 {
        return m * vec2(1., 0.);
      }
    `);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  });

  it('accepts mat3<f32> as a return type', () => {
    const r = diag(`
      "use typeshade";
      declare const m: uniform<mat3<f32>>;
      export function f(): mat3<f32> {
        return m;
      }
    `);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  });

  it('accepts every one of the nine shapes, bare and generic', () => {
    for (const cols of [2, 3, 4] as const) {
      for (const rows of [2, 3, 4] as const) {
        const name = `mat${cols}x${rows}`;
        const r = diag(`
          "use typeshade";
          export function f(m: ${name}): vec${rows} {
            return m * vec${cols}(${Array.from({ length: cols }, () => '1.').join(', ')})
          }
        `);
        expect(
          r.diagnostics.filter((d) => d.category === 'error'),
          name,
        ).toEqual([]);
      }
    }
  });

  it('still refuses a NON-SQUARE matrix of emulated doubles, which the fp64 pass has no body for', () => {
    const r = diag(`
      "use typeshade";
      export function f(m: mat2x3<f64>): f32 {
        return 0.;
      }
    `);
    const d = r.diagnostics.find((d) => d.code === TS_CODES.MAT_UNSUPPORTED);
    expect(d, 'expected a MAT_UNSUPPORTED diagnostic').toBeDefined();
    expect(d!.message).toContain('square matrix of doubles only');
  });

  it('keeps the SQUARE emulated-double matrices working', () => {
    const r = diag(`
      "use typeshade";
      export function f(m: mat3<f64>): mat3<f64> {
        return transpose(m);
      }
    `);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  });

  it('leaves mat4/mat4x4, bare and generic, working as before', () => {
    const r = diag(`
      "use typeshade";
      declare const m: uniform<mat4<f32>>;
      export function f(): mat4 {
        return m;
      }
    `);
    expect(r.diagnostics.filter((d) => d.code === TS_CODES.MAT_UNSUPPORTED)).toEqual([]);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  });
});

// Regression: a misspelled attribute (`@bogus`, `@vertx`, `@framgent`) used to be silent from
// both the compiler and the language service — TypeScript never resolves a decorator on an
// invalid target, so there is no TS2304, and nothing checked the attribute name itself. The
// practical failure is that the function or field just silently stops being an entry point or
// an I/O field, with no diagnostic naming the typo.
describe('attribute name allow-list (ATTRIBUTE_NAME)', () => {
  it('rejects a misspelled stage decorator on a top-level function, with a suggestion', () => {
    const r = diag(`
      "use typeshade";
      @vertx
      export function vs(): vec4 {
        return vec4(0., 0., 0., 1.);
      }
    `);
    const d = r.diagnostics.find((d) => d.code === TS_CODES.ATTRIBUTE_NAME);
    expect(d, 'expected an ATTRIBUTE_NAME diagnostic').toBeDefined();
    expect(d!.category).toBe('error');
    expect(d!.message).toContain('vertx');
    expect(d!.message).toContain('vertex');
  });

  it('rejects a misspelled parameter decorator', () => {
    const r = diag(`
      "use typeshade";
      @vertex
      export function vs(@locaiton(0) x: f32): vec4 {
        return vec4(x, 0., 0., 1.);
      }
    `);
    expect(r.diagnostics.some((d) => d.code === TS_CODES.ATTRIBUTE_NAME)).toBe(true);
  });

  it('rejects a misspelled field decorator on a data class', () => {
    const r = diag(`
      "use typeshade";
      class Clip {
        @buildin("position") pos: vec4;
      }
      export function f(): f32 { return 0.; }
    `);
    expect(r.diagnostics.some((d) => d.code === TS_CODES.ATTRIBUTE_NAME)).toBe(true);
  });

  it('does not flag any of the five recognized attributes', () => {
    const r = diag(`
      "use typeshade";
      class Clip {
        @builtin("position") pos: vec4;
        @location(0) uv: vec2;
      }
      @vertex
      export function vs(@builtin("vertex_index") i: u32): Clip {
        return { pos: vec4(0., 0., 0., 1.), uv: vec2(0., 0.) };
      }
    `);
    expect(r.diagnostics.filter((d) => d.code === TS_CODES.ATTRIBUTE_NAME)).toEqual([]);
  });

  it('does not double up on @align/@std140, which already get their own "not applied" message', () => {
    const r = diag(`
      "use typeshade";
      @std140
      class Camera {
        @align(16) pos: vec3;
      }
      export function f(): f32 { return 0.; }
    `);
    expect(r.diagnostics.filter((d) => d.code === TS_CODES.ATTRIBUTE_NAME)).toEqual([]);
    expect(r.diagnostics.some((d) => /not applied/.test(d.message))).toBe(true);
  });

  // WGSL's own attributes (Rule 2.1) were answered "Unknown attribute", which is false, and
  // named no spelling. Each now says it is WGSL's and where its intent goes.
  it.each([
    [
      '@workgroup_size on a compute entry',
      `@compute
@workgroup_size(64)
export function cs(): void { }`,
      '"@workgroup_size" is WGSL\'s attribute, written here as @compute\'s argument: ' +
        '@compute([64]) or @compute([8, 8]).',
    ],
    [
      '@size on a field',
      `class S { @size(16) x: f32 }
declare const u: uniform<S>
@fragment export function fs(): vec4 { return vec4(u.x) }`,
      '"@size" is WGSL\'s attribute, and is not applied: a field takes the size WGSL\'s layout ' +
        'gives its type, which reflect() reports. Add a field where you need padding.',
    ],
    [
      '@must_use on a function',
      `@must_use
function f(): f32 { return 1. }
@fragment export function fs(): vec4 { return vec4(f()) }`,
      '"@must_use" is WGSL\'s attribute, and is not applied: a call\'s result is not checked ' +
        'for use. Remove it.',
    ],
    [
      '@group on a parameter',
      `@fragment export function fs(@group(0) @location(0) c: f32): vec4 { return vec4(c) }`,
      `"@group" ${SLOT}`,
    ],
    [
      '@binding on a field',
      `class S { @binding(1) x: f32 }
declare const u: uniform<S>
@fragment export function fs(): vec4 { return vec4(u.x) }`,
      `"@binding" ${SLOT}`,
    ],
    [
      '@subgroup_size on a compute entry',
      `@compute([64])
@subgroup_size(32)
export function cs(): void { }`,
      '"@subgroup_size" is WGSL\'s attribute, and is not applied: a compute entry runs at the ' +
        'subgroup size the device chooses. Remove it.',
    ],
    // `@size` and `@align` mark a struct member in WGSL; anywhere else they are named as the
    // field's, not with the field's sentence.
    [
      '@size on a parameter',
      `@fragment export function fs(@size(4) @location(0) c: f32): vec4 { return vec4(c) }`,
      '"@size" is WGSL\'s attribute for a struct field, not a parameter. Remove it.',
    ],
    [
      '@size on a class',
      `@size(16) class S { x: f32 }
declare const u: uniform<S>
@fragment export function fs(): vec4 { return vec4(u.x) }`,
      '"@size" is WGSL\'s attribute for a struct field, not a class. Remove it.',
    ],
    [
      '@align on a function',
      `@align(16)
function f(): f32 { return 1. }
@fragment export function fs(): vec4 { return vec4(f()) }`,
      '"@align" is WGSL\'s attribute for a struct field, not a function. Remove it.',
    ],
    [
      '@align on a parameter',
      `@fragment export function fs(@align(16) @location(0) c: f32): vec4 { return vec4(c) }`,
      '"@align" is WGSL\'s attribute for a struct field, not a parameter. Remove it.',
    ],
  ])("names %s as WGSL's, with where its intent goes", (_what, source, message) => {
    const r = compileTsSource(`"use typeshade"\n${source}`);
    expect(r.diagnostics.map((d) => [d.code, d.message])).toEqual([
      [TS_CODES.ATTRIBUTE_NAME, message],
    ]);
    expect(editor(`"use typeshade"\n${source}`)).toEqual([
      ['typeshade', TS_CODES.ATTRIBUTE_NAME, message],
    ]);
  });

  it("holds the attributes it answers to WGSL's list", () => {
    // Every WGSL attribute is one the compiler reads or one with a sentence of its own (a struct
    // member's, `@size` and `@align`, by where it is written), except `@const`, a keyword
    // TypeScript does not parse as a decorator. A name WGSL adds shows up here first, rather
    // than as a false "Unknown attribute".
    const fixture = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      'core',
      'spec-conformance',
      'fixtures',
      'wgsl-names.json',
    );
    const wgsl = (JSON.parse(readFileSync(fixture, 'utf8')) as { attributes: { names: string[] } })
      .attributes.names;
    expect(wgsl.length).toBeGreaterThan(10);
    const elsewhere = [...WGSL_ATTRIBUTES_ELSEWHERE.keys(), ...WGSL_MEMBER_ATTRIBUTES];
    const answered = new Set([...ATTRIBUTE_NAMES, ...elsewhere, 'const']);
    expect(wgsl.filter((n) => !answered.has(n))).toEqual([]);
    expect(elsewhere.filter((n) => !wgsl.includes(n))).toEqual([]);
  });
});

// Rule 6.7: a decorator outside the list is refused. On a declaration that takes none (a
// variable statement at any depth, an enum, an interface, a type alias, a namespace, a local
// function) TypeScript parses one and its own checker refuses it (TS1206), which compile() never
// runs, and on a static field it resolves the name, so the decorator vanished: `@group(2)
// @binding(5)` was emitted at group 0, binding 0, and `@id(7)` and `@bogus` were dropped without
// a word. `@std140` vanished everywhere but on a class. The editor shows the compiler's sentence
// alone.
describe('a decorator on a declaration (Rule 6.7)', () => {
  it.each([
    [
      '@group and @binding on a uniform',
      `class U { a: f32 }
@group(2) @binding(5) declare const u: uniform<U>
@fragment export function fs(): vec4 { return vec4(u.a) }`,
      [`"@group" ${SLOT}`, `"@binding" ${SLOT}`],
    ],
    [
      '@group and @binding on a read_write storage binding',
      `@group(1) @binding(3) declare const dst: storage<array<f32>, "read_write">
@compute([64]) export function k(@builtin("global_invocation_id") g: vec3u): void { dst[g.x] = 1. }`,
      [`"@group" ${SLOT}`, `"@binding" ${SLOT}`],
    ],
    [
      '@binding on a texture',
      `@binding(1) declare const t: texture_2d<f32>
declare const s: sampler
@fragment export function fs(): vec4 { return textureSample(t, s, vec2(0.)) }`,
      [`"@binding" ${SLOT}`],
    ],
    [
      '@id on an override',
      `@id(7) declare const k: override<f32>
@fragment export function fs(): vec4 { return vec4(k) }`,
      [
        '"@id" is WGSL\'s attribute, and is not applied: the host sets an override by its ' +
          'name, which reflect() lists. Remove it.',
      ],
    ],
    [
      'an unknown name on a module constant',
      `@bogus const K: f32 = 1.
@fragment export function fs(): vec4 { return vec4(K) }`,
      [
        'Unknown attribute "@bogus". Supported attributes: @vertex, @fragment, @compute, ' +
          '@builtin, @location, @interpolate, @invariant, @blend_src, @diagnostic.',
      ],
    ],
    [
      'an entry attribute on a module variable',
      `@location(0) let v: f32 = 0.
@fragment export function fs(): vec4 { v = 1.; return vec4(v) }`,
      [
        '"@location" does not apply to a declaration: it marks an entry\'s input or output. ' +
          'Remove it.',
      ],
    ],
    [
      "an entry function's attribute on a module constant",
      `@vertex const K: f32 = 1.
@fragment export function fs(): vec4 { return vec4(K) }`,
      ['"@vertex" does not apply to a declaration: it marks an entry function. Remove it.'],
    ],
    [
      'a decorator that is not a name',
      `@a.b const K: f32 = 1.
@fragment export function fs(): vec4 { return vec4(K) }`,
      ['"@a.b" is not applied: a declaration takes no decorator. Remove it.'],
    ],
    [
      '@std140 on a module constant',
      `@std140 const K: f32 = 1.
@fragment export function fs(): vec4 { return vec4(K) }`,
      [STD140],
    ],
    // `structs.ts` says `@std140 on a class is not applied.`; anywhere else it vanished.
    [
      '@std140 on a function',
      `@std140 function f(): f32 { return 1. }
@fragment export function fs(): vec4 { return vec4(f()) }`,
      [STD140],
    ],
    [
      '@std140 on a parameter',
      `@fragment export function fs(@std140 @location(0) c: f32): vec4 { return vec4(c) }`,
      [STD140],
    ],
    [
      '@std140 on a field',
      `class S { @std140 x: f32 }
declare const u: uniform<S>
@fragment export function fs(): vec4 { return vec4(u.x) }`,
      [STD140],
    ],
    [
      '@align and @size on module constants',
      `@align(16) const K: f32 = 1.
@size(8) const J: f32 = 1.
@fragment export function fs(): vec4 { return vec4(K + J) }`,
      [
        '"@align" is WGSL\'s attribute for a struct field, not a declaration. Remove it.',
        '"@size" is WGSL\'s attribute for a struct field, not a declaration. Remove it.',
      ],
    ],
    [
      // The call form names its own slot, which reflect() reports as it does any other.
      '@group and @binding on a call-form binding',
      `@group(1) @binding(2) const a = uniform<f32>(1, 2)
@fragment export function fs(): vec4 { return vec4(a) }`,
      [`"@group" ${SLOT}`, `"@binding" ${SLOT}`],
    ],
    [
      '@group on a namespace constant',
      `namespace N { @group(1) export const K: f32 = 1.; }
@fragment export function fs(): vec4 { return vec4(N.K) }`,
      [`"@group" ${SLOT}`],
    ],
    [
      'an unknown name on a local constant',
      `@fragment export function fs(): vec4 { @bogus const k = 1.; return vec4(k) }`,
      [
        'Unknown attribute "@bogus". Supported attributes: @vertex, @fragment, @compute, ' +
          '@builtin, @location, @interpolate, @invariant, @blend_src, @diagnostic.',
      ],
    ],
    [
      'an unknown name on an enum',
      `@bogus enum Mode { A, B }
@fragment export function fs(): vec4 { return vec4(f32(Mode.B)) }`,
      [
        'Unknown attribute "@bogus". Supported attributes: @vertex, @fragment, @compute, ' +
          '@builtin, @location, @interpolate, @invariant, @blend_src, @diagnostic.',
      ],
    ],
    [
      '@binding on an interface',
      `@binding(2) interface U { a: f32; }
declare const u: uniform<U>
@fragment export function fs(): vec4 { return vec4(u.a) }`,
      [`"@binding" ${SLOT}`],
    ],
    [
      '@size on a type alias',
      `@size(4) type T = { a: f32 };
declare const u: uniform<T>
@fragment export function fs(): vec4 { return vec4(u.a) }`,
      ['"@size" is WGSL\'s attribute for a struct field, not a declaration. Remove it.'],
    ],
    [
      'an unknown name on a namespace',
      `@bogus namespace N { export const K: f32 = 1.; }
@fragment export function fs(): vec4 { return vec4(N.K) }`,
      [
        'Unknown attribute "@bogus". Supported attributes: @vertex, @fragment, @compute, ' +
          '@builtin, @location, @interpolate, @invariant, @blend_src, @diagnostic.',
      ],
    ],
    [
      "an unknown name on a namespace's function",
      `namespace N { @bogus export function f(): f32 { return 1.; } }
@fragment export function fs(): vec4 { return vec4(N.f()) }`,
      [
        'Unknown attribute "@bogus". Supported attributes: @vertex, @fragment, @compute, ' +
          '@builtin, @location, @interpolate, @invariant, @blend_src, @diagnostic.',
      ],
    ],
    [
      'an unknown name on a local function',
      `@fragment export function fs(): vec4 { @bogus function g(): f32 { return 1. } return vec4(g()) }`,
      [
        'Unknown attribute "@bogus". Supported attributes: @vertex, @fragment, @compute, ' +
          '@builtin, @location, @interpolate, @invariant, @blend_src, @diagnostic.',
      ],
    ],
    [
      'an entry attribute on a local function',
      `@fragment export function fs(): vec4 { @fragment function g(): f32 { return 1. } return vec4(g()) }`,
      ['"@fragment" does not apply to a local function: it marks an entry function. Remove it.'],
    ],
    [
      'an unknown name on a static field',
      `class A { @bogus static K: f32 = 2.; x: f32 = 0. }
@fragment export function fs(): vec4 { return vec4(A.K) }`,
      [
        'Unknown attribute "@bogus". Supported attributes: @vertex, @fragment, @compute, ' +
          '@builtin, @location, @interpolate, @invariant, @blend_src, @diagnostic.',
      ],
    ],
    [
      'an entry attribute on a static field',
      `class A { @location(0) static readonly K: f32 = 2.; x: f32 = 0. }
@fragment export function fs(): vec4 { return vec4(A.K) }`,
      [
        '"@location" does not apply to a static field: it marks an entry\'s input or output. ' +
          'Remove it.',
      ],
    ],
  ])('refuses %s', (_what, source, messages) => {
    const r = compileTsSource(`"use typeshade"\n${source}`);
    expect(r.diagnostics.map((d) => [d.code, d.message])).toEqual(
      messages.map((m) => [TS_CODES.ATTRIBUTE_NAME, m]),
    );
    expect(editor(`"use typeshade"\n${source}`)).toEqual(
      messages.map((m) => ['typeshade', TS_CODES.ATTRIBUTE_NAME, m]),
    );
  });

  it('says where each attribute it reads belongs, when one is written on a declaration', () => {
    for (const name of ATTRIBUTE_NAMES) {
      const r = compileTsSource(`"use typeshade"
@${name} const K: f32 = 1.
@fragment export function fs(): vec4 { return vec4(K) }`);
      expect(r.diagnostics.map((d) => d.code)).toEqual([TS_CODES.ATTRIBUTE_NAME]);
      expect(r.diagnostics[0]!.message).toMatch(
        new RegExp(
          `^"@${name}" does not apply to a declaration: it marks an entry[ \\w']+\\. Remove it\\.$`,
        ),
      );
    }
  });

  it('leaves the declarations without one as they were', () => {
    const source = `"use typeshade";
class U { a: f32; }
interface V { b: f32; }
type W = { c: f32 };
enum Mode { A, B }
namespace N { export const J: f32 = 2.; }
declare const u: uniform<U>;
declare const v: uniform<V>;
declare const w: uniform<W>;
declare const k: override<f32>;
const K: f32 = 1.;
@fragment export function fs(): vec4 {
  const l = f32(Mode.B) + N.J + v.b + w.c;
  return vec4(u.a + k + K + l);
}`;
    const c = compile(source);
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(editor(source)).toEqual([]);
    expect(c.wgsl).toContain('@group(0) @binding(0) var<uniform> u: U;');
    expect(c.wgsl).toContain('override k: f32 = 0.0;');
  });
});

// Regression: a struct field with neither @builtin nor @location, used as an entry function's
// parameter or return type, used to emit invalid WGSL (a member the backend and Tint both
// reject) with zero diagnostics from either the compiler or the language service.
describe('entry-IO struct fields need @builtin or @location (STRUCT_FIELD_MISSING_ATTR)', () => {
  it('rejects an unattributed field in a @vertex return struct', () => {
    const r = diag(`
      "use typeshade";
      class Out {
        @builtin("position") pos: vec4;
        extra: vec4;
      }
      @vertex
      export function vs(): Out {
        return { pos: vec4(0., 0., 0., 1.), extra: vec4(0., 0., 0., 0.) };
      }
    `);
    const d = r.diagnostics.find((d) => d.code === TS_CODES.STRUCT_FIELD_MISSING_ATTR);
    expect(d, 'expected a STRUCT_FIELD_MISSING_ATTR diagnostic').toBeDefined();
    expect(d!.category).toBe('error');
    expect(d!.message).toContain('extra');
  });

  it('rejects an unattributed field in a @fragment input struct', () => {
    const r = diag(`
      "use typeshade";
      class In {
        @location(0) uv: vec2;
        extra: f32;
      }
      @fragment
      export function fs(v: In): vec4 {
        return vec4(v.uv, v.extra, 1.);
      }
    `);
    expect(r.diagnostics.some((d) => d.code === TS_CODES.STRUCT_FIELD_MISSING_ATTR)).toBe(true);
  });

  it('is silent when every entry-IO field carries @builtin or @location', () => {
    const r = diag(`
      "use typeshade";
      class Out {
        @builtin("position") pos: vec4;
        @location(0) uv: vec2;
      }
      @vertex
      export function vs(): Out {
        return { pos: vec4(0., 0., 0., 1.), uv: vec2(0., 0.) };
      }
    `);
    expect(r.diagnostics.filter((d) => d.code === TS_CODES.STRUCT_FIELD_MISSING_ATTR)).toEqual([]);
  });

  it('is silent for the same struct shape used only as a plain (non-entry) parameter', () => {
    const r = diag(`
      "use typeshade";
      class Data {
        a: vec4;
        b: vec4;
      }
      export function f(d: Data): vec4 {
        return d.a;
      }
    `);
    expect(r.diagnostics.filter((d) => d.code === TS_CODES.STRUCT_FIELD_MISSING_ATTR)).toEqual([]);
  });
});
