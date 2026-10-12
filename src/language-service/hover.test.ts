import { describe, expect, it } from 'vitest';
import { createTypeshadeLanguageService } from './service.js';
import { TS_CODES } from '../compiler/ts/codes.js';
import { compileTsSource } from '../compiler/ts/index.js';
import { compile } from '../compiler/ts/compile.js';
import { spellShaderType } from './hover.js';
import { FUNCTION_DOCS } from './docs.js';
import { compileModuleJs } from '../core/cpu-codegen.js';
import {
  arrayT,
  boolT,
  f32T,
  f64T,
  i32T,
  mat4x4fT,
  samplerT,
  structT,
  texture2dArrayfT,
  texture2dMsfT,
  texture2dfT,
  u32T,
  vec3f64T,
  vec3fT,
  vec3uT,
  voidT,
  type ShaderType,
} from '../core/ir/types.js';

describe('getHover', () => {
  it('documents a GPU type name in a type position', () => {
    const service = createTypeshadeLanguageService();
    const source =
      '"use typeshade";\nexport function f(): vec4 {\n  return vec4(0., 0., 0., 1.)\n}\n';
    service.openDocument('a.ts', source);
    const offset = source.indexOf('vec4');
    const position = service.positionAt('a.ts', offset);
    const hover = service.getHover('a.ts', position);
    expect(hover?.contents).toContain('four-component');
  });

  it('documents every matrix type name, not only mat4', () => {
    // Regression: TYPE_DOCS had only `mat4` and `mat4x4`, so hovering `mat3x2` said nothing.
    const service = createTypeshadeLanguageService();
    const source = '"use typeshade";\nexport function f(m: mat3x2): f32 {\n  return m[0].x\n}\n';
    service.openDocument('m.ts', source);
    const position = service.positionAt('m.ts', source.indexOf('mat3x2') + 2);
    expect(service.getHover('m.ts', position)?.contents).toContain('3x2 matrix');
  });

  it('documents an attribute name', () => {
    const service = createTypeshadeLanguageService();
    const source = '"use typeshade";\n@vertex\nexport function vs(): f32 {\n  return 1\n}\n';
    service.openDocument('b.ts', source);
    const offset = source.indexOf('@vertex') + 2;
    const position = service.positionAt('b.ts', offset);
    const hover = service.getHover('b.ts', position);
    expect(hover?.contents).toContain('vertex');
    expect(hover?.contents.toLowerCase()).toContain('entry point');
  });

  it('documents a builtin name inside @builtin("...")', () => {
    const service = createTypeshadeLanguageService();
    const source = '"use typeshade";\nclass Clip {\n  @builtin("vertex_index") i: u32\n}\n';
    service.openDocument('c.ts', source);
    const offset = source.indexOf('vertex_index') + 2;
    const position = service.positionAt('c.ts', offset);
    const hover = service.getHover('c.ts', position);
    expect(hover?.contents).toContain('vertex');
  });

  it('falls back to TypeScript quick info for a user-defined function', () => {
    const service = createTypeshadeLanguageService();
    const source = '"use typeshade";\nexport function origin(): f32 {\n  return 1\n}\n';
    service.openDocument('d.ts', source);
    const offset = source.indexOf('origin');
    const position = service.positionAt('d.ts', offset);
    const hover = service.getHover('d.ts', position);
    expect(hover?.contents).toContain('origin');
    expect(hover?.contents).toContain('f32');
  });

  it('returns undefined off in whitespace with nothing to document', () => {
    const service = createTypeshadeLanguageService();
    const source = '"use typeshade";\n\n\nexport function f(): f32 {\n  return 1\n}\n';
    service.openDocument('e.ts', source);
    const position = service.positionAt('e.ts', source.indexOf('\n\n\n') + 1);
    expect(service.getHover('e.ts', position)).toBeUndefined();
  });
});

describe('getHover: resource bindings (from the cached front-end analysis, §8)', () => {
  const source =
    '"use typeshade";\n' +
    'class Camera {\n' +
    '  position: vec4\n' +
    '}\n' +
    'declare const camera: uniform<Camera>\n' +
    '@fragment\n' +
    'export function fs(): vec4 {\n' +
    '  const local = camera\n' +
    '  return camera.position\n' +
    '}\n';

  it('adds the address space and @group/@binding slot under the quick info of a binding', () => {
    const service = createTypeshadeLanguageService();
    service.openDocument('r.ts', source);
    const position = service.positionAt('r.ts', source.lastIndexOf('camera.position'));
    const hover = service.getHover('r.ts', position);
    expect(hover?.contents).toContain('const camera: Camera');
    expect(hover?.contents).toContain('uniform resource at @group(0) @binding(0)');
  });

  it('says nothing about a binding for a local that merely holds one', () => {
    const service = createTypeshadeLanguageService();
    service.openDocument('r.ts', source);
    const position = service.positionAt('r.ts', source.indexOf('local'));
    const hover = service.getHover('r.ts', position);
    expect(hover?.contents).toContain('local');
    expect(hover?.contents).not.toContain('@binding');
  });
});

describe("getHover: the compiler's type for a symbol declared in this document", () => {
  // The types below are the ones the FRONT END gave each declaration. TypeScript, over the
  // ambient lib, says `number` for `x`, `0.5` for `half` and `vec3` for `v`, because the GPU
  // scalar types brand `number` optionally and a bare numeric literal is assignable to all of
  // them (`ambient.ts`); none of those three is what the compiler lowered.
  const source = [
    '"use typeshade";',
    'class Vertex {',
    '  @location(0) pos: vec3',
    '}',
    'declare const camera: uniform<Vertex>',
    'const K: f32 = 2.;',
    'export function clamp01(x: f32): f32 {',
    '  return x;',
    '}',
    '@fragment',
    'export function fs(v: vec3, p: Vertex): vec4 {',
    '  let x = 1.;',
    '  const half = 0.5;',
    '  let n = u32(1);',
    '  {',
    '    let x = u32(7);',
    '    n = x;',
    '  }',
    '  return vec4(x * K, half, p.pos.x, clamp01(v.x));',
    '}',
  ].join('\n');

  function hoverAt(offset: number): string | undefined {
    const service = createTypeshadeLanguageService();
    service.openDocument('t.ts', source);
    return service.getHover('t.ts', service.positionAt('t.ts', offset))?.contents;
  }

  it('shows f32, not number, for a local bound to a numeric literal', () => {
    const declaration = hoverAt(source.indexOf('let x = 1.') + 4);
    expect(declaration).toContain('let x: f32');
    expect(declaration).not.toContain('number');
  });

  it('shows the same f32 at a use of that local', () => {
    const use = hoverAt(source.indexOf('x * K'));
    expect(use).toContain('let x: f32');
    expect(use).not.toContain('number');
  });

  it('shows f32 for a const bound to a fractional literal, not the literal type', () => {
    expect(hoverAt(source.indexOf('const half') + 6)).toContain('const half: f32');
    expect(hoverAt(source.lastIndexOf('half'))).toContain('const half: f32');
  });

  it('shows u32 for a local bound to a u32 conversion', () => {
    expect(hoverAt(source.indexOf('let n = u32') + 4)).toContain('let n: u32');
  });

  it('spells a parameter with the WGSL element type', () => {
    expect(hoverAt(source.indexOf('v: vec3'))).toContain('(parameter) v: vec3<f32>');
    expect(hoverAt(source.indexOf('v.x'))).toContain('(parameter) v: vec3<f32>');
  });

  it('shows a module const with the compiler type', () => {
    expect(hoverAt(source.indexOf('const K') + 6)).toContain('const K: f32');
    expect(hoverAt(source.indexOf('K, half'))).toContain('const K: f32');
  });

  it('shows a function signature with the compiler types', () => {
    expect(hoverAt(source.indexOf('function clamp01') + 9)).toContain(
      'function clamp01(x: f32): f32',
    );
    expect(hoverAt(source.indexOf('clamp01(v.x)'))).toContain('function clamp01(x: f32): f32');
  });

  it('resolves a shadowing declaration by position, outer and inner', () => {
    expect(hoverAt(source.indexOf('let x = u32(7)') + 4)).toContain('let x: u32');
    expect(hoverAt(source.indexOf('n = x') + 4)).toContain('let x: u32');
    expect(hoverAt(source.indexOf('let x = 1.') + 4)).toContain('let x: f32');
  });

  it('shows a struct field access with the field type the compiler collected', () => {
    expect(hoverAt(source.indexOf('p.pos.x') + 2)).toContain('(property) Vertex.pos: vec3<f32>');
  });

  it('keeps the resource line under a binding, and names its struct', () => {
    const hover = hoverAt(source.indexOf('camera'));
    expect(hover).toContain('const camera: Vertex');
    expect(hover).toContain('uniform resource at @group(0) @binding(0)');
  });

  it("leaves TypeScript's quick info for a data class name", () => {
    expect(hoverAt(source.indexOf('class Vertex') + 6)).toContain('class Vertex');
  });
});

// #56 — `nodeAtPosition`'s span test is half-open, so one offset past a name was the
// whitespace or the punctuation after it, and the hover fell through to TypeScript's quick
// info: `let k: number` where the compiler lowered an `f32`. The end of a name is where an
// editor leaves the caret after typing it. Measured before the fix, on the source above: `k`
// answered `let k: f32` on the name and `let k: number` one offset later.
describe("getHover: the touching rule at a name's end position (#56)", () => {
  const source = [
    '"use typeshade";',
    'class Vertex {',
    '  @location(0) pos: vec3',
    '}',
    '@vertex',
    'export function vs(i: u32, p: Vertex): vec4 {',
    '  let k = 1.;',
    '  return vec4(k, p.pos.x, f32(i), 1.);',
    '}',
  ].join('\n');

  function hoverAt(offset: number): string | undefined {
    const service = createTypeshadeLanguageService();
    service.openDocument('touch.ts', source);
    return service.getHover('touch.ts', service.positionAt('touch.ts', offset))?.contents;
  }

  it.each([
    ['a local, at its declaration', 'let k'.length, 'let k', 'let k: f32'],
    ['a local, at a use', 'vec4(k'.length, 'vec4(k', 'let k: f32'],
    ['a parameter', 'vs(i'.length, 'vs(i', '(parameter) i: u32'],
    ['a struct field', 'p.pos'.length, 'p.pos', '(property) Vertex.pos: vec3<f32>'],
  ])('answers for %s at name.end', (_label, length, prefix, expected) => {
    const end = source.indexOf(prefix) + length;
    // The offset really is one past the name: the character there is not part of it.
    expect(/[A-Za-z0-9_]/.test(source[end]!)).toBe(false);
    expect(hoverAt(end)).toContain(expected);
  });

  it('still answers for the name the position is INSIDE, never the one after it', () => {
    // `k` ends where the space before `p` begins, and `p` starts one offset later: a caret on
    // `p` is `p`'s, not `k`'s, which is what the rule has to leave alone.
    const p = source.indexOf('p.pos');
    expect(hoverAt(p)).toContain('(parameter) p: Vertex');
  });

  it('leaves a position that touches no name alone', () => {
    // The offset after `{` is neither inside a name nor at the end of one.
    const brace = source.indexOf('vec4 {') + 'vec4 {'.length;
    expect(hoverAt(brace)).toBeUndefined();
  });
});

describe('getHover: an ambient name this document declares nothing of', () => {
  // The pre-filter in `getHover` skips the definition query for an identifier whose text is in
  // neither `analysis.symbols` nor `analysis.bindings`, on the ground that neither answer could
  // have used it. This is the case that takes that path, and it must still read exactly as it
  // did when TypeScript was asked: an ambient builtin is TypeScript's to describe.
  const source = [
    '"use typeshade";',
    'export function f(a: f32, b: f32): f32 {',
    '  return max(a, b);',
    '}',
  ].join('\n');

  it("keeps TypeScript's quick info for a builtin, and the compiler's for the args", () => {
    const service = createTypeshadeLanguageService();
    service.openDocument('m.ts', source);
    const hoverAt = (offset: number) =>
      service.getHover('m.ts', service.positionAt('m.ts', offset))?.contents;
    expect(hoverAt(source.indexOf('max(a, b)'))).toContain('function max');
    expect(hoverAt(source.indexOf('a, b'))).toContain('(parameter) a: f32');
  });
});

describe('getHover: a function with no return annotation', () => {
  // The body says the return type (Rule 8.19), as TypeScript infers it: the hover shows the type
  // the front end lowered, which is TypeScript's, and nothing warns. It said `void`, beside a
  // TS8021 "defaulting to void" warning, before the rule.
  const source = [
    '"use typeshade";',
    'export function helperNoRet(a: f32) {',
    '  return a;',
    '}',
  ].join('\n');

  it('hovers as the type its body returns, with no warning', () => {
    const service = createTypeshadeLanguageService();
    service.openDocument('v.ts', source);
    const offset = source.indexOf('helperNoRet') + 3;
    const hover = service.getHover('v.ts', service.positionAt('v.ts', offset));
    expect(hover?.contents).toContain('function helperNoRet(a: f32): f32');
    expect(service.getDiagnostics('v.ts').some((d) => d.code === TS_CODES.RETURN_SHAPE)).toBe(
      false,
    );
  });
});

describe('getHover: a resource binding, and where its access mode shows', () => {
  // The declaration keyword of a binding is always `const` (design rule 6.1), so the hover says
  // `const` for both of these and the ACCESS MODE is what tells them apart. It goes on the
  // resource line, beside the address space it is part of, the way WGSL writes
  // `var<storage, read_write>`.
  const source = [
    '"use typeshade";',
    'declare const ro: storage<array<f32>>',
    'declare const rw: storage<array<f32>, "read_write">',
    '@compute([64, 1, 1])',
    'export function cs(@builtin("global_invocation_id") gid: vec3u): void {',
    '  rw[gid.x] = ro[gid.x];',
    '}',
  ].join('\n');

  function hoverAt(offset: number): string | undefined {
    const service = createTypeshadeLanguageService();
    service.openDocument('w.ts', source);
    return service.getHover('w.ts', service.positionAt('w.ts', offset))?.contents;
  }

  it('says const for both, because a binding is declared const', () => {
    expect(hoverAt(source.indexOf('rw[gid.x]'))).toContain('const rw: array<f32>');
    expect(hoverAt(source.indexOf('ro[gid.x]'))).toContain('const ro: array<f32>');
  });

  it('names the access mode on the resource line, which is what tells the two apart', () => {
    expect(hoverAt(source.indexOf('rw[gid.x]'))).toContain(
      'read_write storage resource at @group(0) @binding(1)',
    );
    expect(hoverAt(source.indexOf('ro[gid.x]'))).toContain(
      'read storage resource at @group(0) @binding(0)',
    );
  });

  it('still adds the resource line under both', () => {
    expect(hoverAt(source.indexOf('rw[gid.x]'))).toContain(
      'storage resource at @group(0) @binding(1)',
    );
    expect(hoverAt(source.indexOf('ro[gid.x]'))).toContain(
      'storage resource at @group(0) @binding(0)',
    );
  });
});

describe("getHover: a runtime-sized array's length is the compiler's u32", () => {
  // The compiler reads `.length` on a runtime-sized storage array as `arrayLength(&src)`, a
  // `u32` (#46); the ambient `array<T, N>` gave `length` the type `N`, which a runtime-sized
  // array fills with its default `number`, so the editor said `number` for the same read. The
  // tests of #46 read the compiler half only. These read both, on one source (Rule 12.7).
  const program = (body: string): string =>
    [
      '"use typeshade";',
      'class Buf {',
      '  scale: f32;',
      '  xs: array<f32>;',
      '}',
      'declare const ro: storage<array<f32>>',
      'declare const rw: storage<array<u32>, "read_write">',
      'declare const b: storage<Buf>',
      '@compute([64, 1, 1])',
      'export function cs(@builtin("global_invocation_id") gid: vec3u): void {',
      body,
      '}',
    ].join('\n');
  const source = program(
    [
      '  const fixed: array<f32, 4> = [1., 2., 3., 4.];',
      '  if (gid.x >= ro.length || gid.x >= b.xs.length) {',
      '    return;',
      '  }',
      '  rw[gid.x] = rw.length + u32(fixed.length);',
    ].join('\n'),
  );

  function hoverAfter(prefix: string): string | undefined {
    const service = createTypeshadeLanguageService();
    service.openDocument('len.ts', source);
    const offset = source.indexOf(prefix) + prefix.length;
    return service.getHover('len.ts', service.positionAt('len.ts', offset))?.contents;
  }

  it.each([
    ['a read binding', 'ro.len'],
    ['a read_write binding', 'rw.len'],
    ["a binding's trailing struct member", 'b.xs.len'],
  ])('is a u32 on %s in the editor', (_label, prefix) => {
    expect(hoverAfter(prefix)).toContain('length: u32');
  });

  it("keeps a sized array's length its size, which is what separates the sizes", () => {
    expect(hoverAfter('fixed.len')).toContain('length: 4');
  });

  it('is a u32 to the compiler, and the editor refuses what the compiler refuses', () => {
    expect(compileTsSource(source).diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const service = createTypeshadeLanguageService();
    service.openDocument('len.ts', source);
    expect(service.getDiagnostics('len.ts')).toEqual([]);

    const f32Source = program('  const n: f32 = ro.length;\n  rw[gid.x] = u32(n);');
    const compiler = compileTsSource(f32Source).diagnostics.filter((d) => d.category === 'error');
    expect(compiler.map((d) => d.code)).toEqual([TS_CODES.TYPE_MISMATCH]);
    expect(compiler[0]!.message).toContain('u32');
    service.openDocument('f32.ts', f32Source);
    expect(service.getDiagnostics('f32.ts').map((d) => d.code)).toEqual([TS_CODES.TYPE_MISMATCH]);
  });
});

describe('getHover: a module variable says let, the keyword it is declared with', () => {
  // #188 made every binding hover as `const`, since a binding is always declared `const`. A module
  // variable is recorded as a binding too, and is declared `let` (Rule 6.5), so `let hits: u32`
  // hovered as `const hits: u32` from then on. No test hovered one.
  const source = [
    '"use typeshade";',
    'declare const out: storage<array<u32>, "read_write">;',
    'let hits: u32;',
    'let tile: workgroup<array<u32, 64>>;',
    '@compute([64, 1, 1])',
    'export function cs(@builtin("local_invocation_id") lid: vec3u): void {',
    '  hits += 1;',
    '  tile[lid.x] = hits;',
    '  out[lid.x] = tile[lid.x];',
    '}',
  ].join('\n');

  function hoverAt(offset: number): string | undefined {
    const service = createTypeshadeLanguageService();
    service.openDocument('mv.ts', source);
    return service.getHover('mv.ts', service.positionAt('mv.ts', offset))?.contents;
  }

  it('is a program both halves accept', () => {
    expect(compile(source).diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([]);
    const service = createTypeshadeLanguageService();
    service.openDocument('mv.ts', source);
    expect(service.getDiagnostics('mv.ts').map((d) => `${d.code} ${d.message}`)).toEqual([]);
  });

  it('says let for a per-invocation variable and for workgroup memory', () => {
    expect(hoverAt(source.indexOf('hits += 1'))).toContain('let hits: u32');
    expect(hoverAt(source.indexOf('tile[lid.x] = hits'))).toContain('let tile: array<u32, 64>');
  });

  it('still says const for the binding beside them', () => {
    expect(hoverAt(source.indexOf('out[lid.x]'))).toContain('const out: array<u32>');
  });
});

// Surface §20: a runtime-sized storage array's `.length` is `arrayLength(&src)`, a `u32`, in the
// compiler. The ambient member was `length: N` with `N` defaulting to `number`, so the editor
// hovered `(property) length: number` over the value the compiler then refused in `n * 0.5`
// (Rule 12.7). A sized array keeps its literal, which is the compile-time length.
describe("getHover: an array's length is the type the compiler reads", () => {
  const source = [
    '"use typeshade";',
    'declare const src: storage<array<f32>>;',
    'declare const dst: storage<array<f32>, "read_write">;',
    'declare const four: storage<array<f32, 4>>;',
    '@compute([64, 1, 1])',
    'export function cs(@builtin("global_invocation_id") gid: vec3u): void {',
    '  const xs: array<f32, 3> = [1., 2., 3.];',
    '  dst[gid.x] = f32(src.length) + f32(dst.length) + f32(four.length) + f32(xs.length);',
    '}',
  ].join('\n');

  function lengthHoverAfter(receiver: string): string | undefined {
    const service = createTypeshadeLanguageService();
    service.openDocument('l.ts', source);
    const offset = source.indexOf(`${receiver}.length`) + receiver.length + 2;
    return service.getHover('l.ts', service.positionAt('l.ts', offset))?.contents;
  }

  it('is u32 on a runtime-sized array, read and read_write alike', () => {
    expect(lengthHoverAfter('src')).toContain('(property) length: u32');
    expect(lengthHoverAfter('dst')).toContain('(property) length: u32');
  });

  it('keeps the literal on a sized array, a binding or a local', () => {
    expect(lengthHoverAfter('four')).toContain('(property) length: 4');
    expect(lengthHoverAfter('xs')).toContain('(property) length: 3');
  });

  it("is the u32 the compiler refuses in f32 arithmetic, and the editor says only the compiler's sentence", () => {
    const service = createTypeshadeLanguageService();
    const program = [
      '"use typeshade";',
      'declare const src: storage<array<f32>>;',
      'declare const dst: storage<array<f32>, "read_write">;',
      '@compute([64, 1, 1])',
      'export function cs(): void {',
      '  dst[0] = src.length * 0.5;',
      '}',
    ].join('\n');
    service.openDocument('m.ts', program);
    const at = program.indexOf('src.length') + 5;
    expect(service.getHover('m.ts', service.positionAt('m.ts', at))?.contents).toContain(
      '(property) length: u32',
    );
    expect(
      service.getDiagnostics('m.ts').map((d) => `${d.source} ${d.code}: ${d.message}`),
    ).toEqual([
      'typeshade TS8003: Type mismatch: cannot * u32 and f32 — no implicit int/float conversion. Cast explicitly: f32(intVal) or i32(floatVal) / u32(floatVal).',
    ]);
  });
});

describe('getHover: a symbol declared in another document', () => {
  it("keeps TypeScript's quick info, since the compiler's table is this document's", () => {
    const service = createTypeshadeLanguageService();
    service.openDocument(
      '/lib.ts',
      '"use typeshade"\nexport const K = 1.\nexport function k(): f32 {\n  return 1.\n}\n',
    );
    const main =
      '"use typeshade"\nimport { k, K } from "./lib.ts"\nexport function f(): f32 {\n  return k() * K\n}\n';
    service.openDocument('/main.ts', main);
    const hover = service.getHover(
      '/main.ts',
      service.positionAt('/main.ts', main.indexOf('* K') + 2),
    );
    // `K` is declared in `/lib.ts`, so `/main.ts`'s symbol table says nothing about it and
    // TypeScript answers, exactly as before: a span belongs to the file it indexes.
    expect(hover?.contents).toContain('const K: 1');
  });
});

describe('spellShaderType', () => {
  // One row per `ShaderType` kind, so a new kind (or a changed spelling) shows up here as a
  // diff. The f64 family is the reason this function exists at all: `wgslType` throws SD0040
  // on it, because no backend may write a pre-lowering type, and a hover still has to name it.
  const rows: readonly (readonly [ShaderType, string])[] = [
    [f32T, 'f32'],
    [i32T, 'i32'],
    [u32T, 'u32'],
    [boolT, 'bool'],
    [f64T, 'f64'],
    [vec3fT, 'vec3<f32>'],
    [vec3uT, 'vec3<u32>'],
    [vec3f64T, 'vec3<f64>'],
    [mat4x4fT, 'mat4x4<f32>'],
    [{ kind: 'mat', cols: 4, rows: 4, elem: 'f64' }, 'mat4x4<f64>'],
    [{ kind: 'mat', cols: 2, rows: 3, elem: 'f32' }, 'mat2x3<f32>'],
    [structT('Camera'), 'Camera'],
    [arrayT(f32T, 4), 'array<f32, 4>'],
    [arrayT(f32T), 'array<f32>'],
    [arrayT(vec3f64T, 2), 'array<vec3<f64>, 2>'],
    [texture2dfT, 'texture_2d<f32>'],
    [texture2dArrayfT, 'texture_2d_array<f32>'],
    [texture2dMsfT, 'texture_multisampled_2d<f32>'],
    [samplerT, 'sampler'],
    [voidT, 'void'],
  ];

  for (const [type, spelling] of rows) {
    it(`spells ${spelling}`, () => {
      expect(spellShaderType(type)).toBe(spelling);
    });
  }
});

describe('builtin JSDoc in hover', () => {
  const service = createTypeshadeLanguageService();

  it('mix function hover shows its documentation', () => {
    const source = '"use typeshade"\nexport function f(): f32 {\n  return mix(1., 2., 0.5)\n}\n';
    service.openDocument('/test.ts', source);
    const hover = service.getHover(
      '/test.ts',
      service.positionAt('/test.ts', source.indexOf('mix')),
    );
    expect(hover?.contents).toContain('a * (1 - t) + b * t');
  });

  it('Math.sin hover shows its documentation', () => {
    const source = '"use typeshade"\nexport function f(x: f32): f32 {\n  return Math.sin(x)\n}\n';
    service.openDocument('/test.ts', source);
    const hover = service.getHover(
      '/test.ts',
      service.positionAt('/test.ts', source.indexOf('sin')),
    );
    expect(hover?.contents).toContain('sine');
    expect(hover?.contents).toContain('radians');
  });

  it('PI constant hover shows its documentation', () => {
    const source = '"use typeshade"\nexport const p = PI\n';
    service.openDocument('/test.ts', source);
    const hover = service.getHover(
      '/test.ts',
      service.positionAt('/test.ts', source.indexOf('PI')),
    );
    expect(hover?.contents).toContain('mathematical constant π');
  });

  it('vec3 constructor hover shows its documentation', () => {
    const source = '"use typeshade"\nexport function f(): vec3 {\n  return vec3(1., 2., 3.)\n}\n';
    service.openDocument('/test.ts', source);
    const hover = service.getHover(
      '/test.ts',
      service.positionAt('/test.ts', source.indexOf('vec3')),
    );
    // Either the JSDoc is shown, or the type definition - both are acceptable
    expect(
      hover?.contents?.includes('Builds a `vec3`') ||
        hover?.contents?.includes('A three-component vector'),
    ).toBe(true);
  });

  it('smoothstep function hover shows its documentation', () => {
    const source =
      '"use typeshade"\nexport function f(x: f32): f32 {\n  return smoothstep(0., 1., x)\n}\n';
    service.openDocument('/test.ts', source);
    const hover = service.getHover(
      '/test.ts',
      service.positionAt('/test.ts', source.indexOf('smoothstep')),
    );
    expect(hover?.contents).toContain('Hermite interpolation');
  });
});

describe('pow and cbrt: what the hover says of a negative x holds in both halves', () => {
  // The hover said that a negative base "produces NaN", a GPU value no target promises. WGSL
  // puts every negative base outside the domain of `pow` (WGSL §17.5.46), and GLSL ES 3.00 leaves
  // the result undefined for x < 0, and for x = 0 with y <= 0 (GLSL ES 3.00 §8.2). `cbrt` reaches
  // both targets as `pow(x, 1/3)`, so the same holds for it. The one value the sentence can
  // state is the CPU oracle's, so this test reads the oracle and the hover on one source.
  const source = `"use typeshade";
export function p(x: f32, y: f32): f32 {
  return pow(x, y);
}
export function mp(x: f32, y: f32): f32 {
  return Math.pow(x, y);
}
export function c(x: f32): f32 {
  return cbrt(x);
}
export function mc(x: f32): f32 {
  return Math.cbrt(x);
}
`;
  const compiled = compile(source);

  it('the compiler half: cbrt is pow on both targets, and the oracle gives the values the hover names', () => {
    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.wgsl).toContain('pow(x, 0.3333333333333333)');
    expect(compiled.glsl?.fragment).toContain('pow(x, 0.3333333333333333)');
    // The hover names these two results, so the oracle is held to them. `eval` is the oracle
    // `compile()` hands a user; `compileModuleJs` is the generated-JavaScript one.
    expect(FUNCTION_DOCS.pow).toContain('`pow(-2., 3.)` is -8 and `pow(-2., 0.5)` is NaN.');
    expect(FUNCTION_DOCS.cbrt).toContain('the CPU oracle returns NaN.');
    const js = compileModuleJs(compiled.module).fns;
    for (const name of ['p', 'mp']) {
      expect(compiled.eval(name, [-2, 3]), name).toBe(-8);
      expect(compiled.eval(name, [-2, 0.5]), name).toBeNaN();
      expect(js[name]!(-2, 3), name).toBe(-8);
      expect(js[name]!(-2, 0.5), name).toBeNaN();
    }
    for (const name of ['c', 'mc']) {
      expect(compiled.eval(name, [-8]), name).toBeNaN();
      expect(js[name]!(-8), name).toBeNaN();
      expect(compiled.eval(name, [8]), name).toBe(2);
    }
  });

  it('the editor half: each spelling hovers with the sentence, and none promises a GPU NaN', () => {
    const service = createTypeshadeLanguageService();
    service.openDocument('/pow.ts', source);
    expect(service.getDiagnostics('/pow.ts')).toEqual([]);
    const hoverAt = (needle: string, plus = 0) =>
      service.getHover('/pow.ts', service.positionAt('/pow.ts', source.indexOf(needle) + plus))
        ?.contents;
    for (const [needle, plus, doc] of [
      ['pow(x, y)', 0, FUNCTION_DOCS.pow],
      ['Math.pow', 5, FUNCTION_DOCS.pow],
      ['cbrt(x)', 0, FUNCTION_DOCS.cbrt],
      ['Math.cbrt', 5, FUNCTION_DOCS.cbrt],
    ] as const) {
      const contents = hoverAt(needle, plus);
      expect(contents, needle).toContain(doc);
      expect(contents, needle).toContain('GPU result is undefined');
      expect(contents, needle).not.toContain('produces NaN');
    }
  });
});

describe('domain edges: what the hover says outside a domain holds in both halves', () => {
  // Seven sentences promised a GPU result outside a function's domain: NaN from asin, acos,
  // acosh, atanh and normalize, and "the other argument" from min and max. WGSL leaves those
  // inputs outside the domain (asin, acos and atanh [-1, 1], acosh [1, +inf], normalize every
  // vector but zero: WGSL §17.5), which gives an indeterminate value, and lets an implementation
  // assume that NaNs and infinities are absent, naming min and max (§15.7.2). GLSL ES 3.00 leaves
  // the inverse functions undefined outside their domains (§8.1) and requires no NaN (§4.5.1).
  // The one value a sentence can state is the CPU oracle's, so this test reads the oracle and
  // the hover on one source.
  const source = `"use typeshade";
export function fasin(x: f32): f32 {
  return asin(x);
}
export function facos(x: f32): f32 {
  return acos(x);
}
export function facosh(x: f32): f32 {
  return acosh(x);
}
export function fatanh(x: f32): f32 {
  return atanh(x);
}
export function fnormalize(v: vec3): vec3 {
  return normalize(v);
}
export function fmin(a: f32, b: f32): f32 {
  return min(a, b);
}
export function fmax(a: f32, b: f32): f32 {
  return max(a, b);
}
`;
  const compiled = compile(source);

  it('the compiler half: the oracle gives the values the hover names', () => {
    expect(compiled.diagnostics).toEqual([]);
    const js = compileModuleJs(compiled.module).fns;
    const both = (name: string, args: unknown[]) => [
      compiled.eval(name, args as never),
      js[name]!(...(args as never[])),
    ];
    for (const [name, x] of [
      ['fasin', 2],
      ['fasin', -2],
      ['facos', 2],
      ['facos', -2],
      ['facosh', 0.5],
      ['fatanh', 2],
      ['fatanh', -2],
    ] as const) {
      for (const value of both(name, [x])) expect(value, `${name}(${x})`).toBeNaN();
    }
    for (const value of both('fatanh', [1])) expect(value).toBe(Infinity);
    for (const value of both('fatanh', [-1])) expect(value).toBe(-Infinity);
    for (const value of both('fnormalize', [[0, 0, 0]])) {
      for (const component of value as number[]) expect(component).toBeNaN();
    }
    for (const name of ['fmin', 'fmax']) {
      for (const value of both(name, [NaN, 1])) expect(value, name).toBe(1);
      for (const value of both(name, [1, NaN])) expect(value, name).toBe(1);
    }
  });

  it('the editor half: each function hovers with its sentence, and none promises a GPU result there', () => {
    const service = createTypeshadeLanguageService();
    service.openDocument('/domain.ts', source);
    expect(service.getDiagnostics('/domain.ts')).toEqual([]);
    for (const name of ['asin', 'acos', 'acosh', 'atanh', 'normalize', 'min', 'max'] as const) {
      const needle = `return ${name}(`;
      const contents = service.getHover(
        '/domain.ts',
        service.positionAt('/domain.ts', source.indexOf(needle) + 'return '.length),
      )?.contents;
      expect(contents, name).toContain(FUNCTION_DOCS[name]);
      expect(contents, name).toContain('the GPU result is undefined');
      expect(contents, name).not.toMatch(/Returns `NaN`|produces NaN|the other is returned/);
    }
  });
});

describe('getHover: class members (#86 step 3)', () => {
  // The TypeScript checker knows a class's members, so the service adds nothing for them; this
  // pins what an editor shows, so a change in the ambient lib or the hover path that broke it
  // would say so here rather than in a screenshot.
  const source = `"use typeshade";
class Ray {
  origin: vec3;
  dir: vec3;
  constructor(origin: vec3, dir: vec3) {
    this.origin = origin;
    this.dir = dir;
  }
  at(t: f32): vec3 {
    return this.origin + this.dir * t;
  }
  advance(t: f32): void {
    this.origin = this.at(t);
  }
  static up(): vec3 {
    return vec3(0., 1., 0.);
  }
}
@fragment
export function fs(@location(0) uv: vec2): vec4 {
  let r = new Ray(vec3(uv, 0.), vec3(0., 0., 1.));
  r.advance(1.);
  return vec4(r.at(2.) + Ray.up(), 1.);
}
`;
  const service = createTypeshadeLanguageService();
  service.openDocument('m.ts', source);
  const hoverAt = (needle: string, plus = 0) =>
    service.getHover('m.ts', service.positionAt('m.ts', source.indexOf(needle) + plus))?.contents;

  it('a method reads as the class member at its declaration and at a call', () => {
    expect(hoverAt('at(t: f32)')).toBe('```ts\n(method) Ray.at(t: f32): vec3\n```');
    expect(hoverAt('r.at(2.)', 2)).toBe('```ts\n(method) Ray.at(t: f32): vec3\n```');
    expect(hoverAt('r.advance(1.)', 2)).toBe('```ts\n(method) Ray.advance(t: f32): void\n```');
    expect(hoverAt('Ray.up()', 4)).toBe('```ts\n(method) Ray.up(): vec3\n```');
  });

  it('the constructor, a field through this, and a local holding the class', () => {
    expect(hoverAt('new Ray(', 4)).toBe(
      '```ts\nconstructor Ray(origin: vec3, dir: vec3): Ray\n```',
    );
    expect(hoverAt('this.origin = origin', 5)).toBe('```ts\n(property) Ray.origin: vec3<f32>\n```');
    expect(hoverAt('let r', 4)).toBe('```ts\nlet r: Ray\n```');
  });

  it('go to definition from a call lands on the method', () => {
    const defs = service.getDefinition(
      'm.ts',
      service.positionAt('m.ts', source.indexOf('r.at(2.)') + 2),
    );
    expect(defs).toEqual([
      { uri: 'm.ts', range: { start: { line: 8, character: 2 }, end: { line: 8, character: 4 } } },
    ]);
    expect(service.getDiagnostics('m.ts')).toEqual([]);
  });
});
