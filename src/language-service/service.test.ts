import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTypeshadeLanguageService } from './service.js';
import { compileTsSource } from '../compiler/ts/source-file.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const HELLO = readFileSync(join(HERE, '..', '..', 'examples', 'hello.shade.ts'), 'utf8');

describe('document lifecycle', () => {
  it('returns no diagnostics for a document that was never opened', () => {
    const service = createTypeshadeLanguageService();
    expect(service.getDiagnostics('never-opened.ts')).toEqual([]);
  });

  it('opens, updates and closes a document, tracking versions so a stale request never hits new text', () => {
    const service = createTypeshadeLanguageService();
    service.openDocument('a.ts', '"use typeshade";\nconst x = 1', 1);
    const firstDiagnostics = service.getDiagnostics('a.ts');
    service.updateDocument('a.ts', '"use typeshade";\nconst x = 1', 2);
    const secondDiagnostics = service.getDiagnostics('a.ts');
    expect(firstDiagnostics).toEqual(secondDiagnostics);
    service.closeDocument('a.ts');
    expect(service.getDiagnostics('a.ts')).toEqual([]);
  });

  it('reflects an update when the adapter does not track versions itself', () => {
    const service = createTypeshadeLanguageService();
    service.openDocument('b.ts', '"use typeshade";\nexport function f(): f32 {\n  return 1\n}');
    expect(
      service
        .getDiagnostics('b.ts')
        .some((d) => d.source === 'typeshade' && d.severity === 'error'),
    ).toBe(false);
    service.updateDocument(
      'b.ts',
      '"use typeshade";\nexport function f(): f32 {\n  return true\n}',
    );
    expect(
      service
        .getDiagnostics('b.ts')
        .some((d) => d.source === 'typeshade' && d.severity === 'error'),
    ).toBe(true);
  });
});

describe('getDiagnostics: a broken program', () => {
  it('reports a real TypeScript diagnostic and a real TypeShade diagnostic, both with correct ranges', () => {
    const service = createTypeshadeLanguageService();
    // Line 2 (0-based): a genuine TS type error (assigning a string where f32 is annotated).
    // Line 3 (0-based): a genuine TypeShade error (vec4(...) given only 2 of its 4 components).
    const text =
      '"use typeshade";\n' +
      'export function f(): vec4 {\n' +
      '  let bad: f32 = "nope"\n' +
      '  return vec4(1., 2.)\n' +
      '}\n';
    service.openDocument('broken.ts', text);
    const diagnostics = service.getDiagnostics('broken.ts');

    const tsDiag = diagnostics.find(
      (d) => d.source === 'typescript' && d.message.includes('not assignable'),
    );
    expect(tsDiag, 'expected a "not assignable" TypeScript diagnostic').toBeDefined();
    expect(tsDiag!.severity).toBe('error');
    expect(tsDiag!.range.start.line).toBe(2);
    expect(tsDiag!.span.length).toBeGreaterThan(0);

    const shadeDiag = diagnostics.find((d) => d.source === 'typeshade' && d.code === 'TS8019');
    expect(shadeDiag, 'expected the vector-arity TypeShade diagnostic').toBeDefined();
    expect(shadeDiag!.severity).toBe('error');
    expect(shadeDiag!.message).toContain('component count mismatch');
    expect(shadeDiag!.range.start.line).toBe(3);
  });

  it('lists the two halves in document order: span start, then length, then source (#25 of the site review)', () => {
    const service = createTypeshadeLanguageService();
    // The TypeShade error sits on line 2 and the TypeScript error on line 3. The merge used to
    // append every TypeShade row after every TypeScript row, so the problem list read 3 then 2.
    const text =
      '"use typeshade";\n' +
      'export function f(): vec4 {\n' +
      '  let v: vec4 = vec4(1., 2.)\n' +
      '  let bad: f32 = "nope"\n' +
      '  return v\n' +
      '}\n';
    service.openDocument('order.ts', text);
    const diagnostics = service.getDiagnostics('order.ts');

    const sources = diagnostics.map((d) => d.source);
    expect(sources, 'both halves must report').toContain('typeshade');
    expect(sources, 'both halves must report').toContain('typescript');
    const starts = diagnostics.map((d) => d.span.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(
      sources.indexOf('typeshade'),
      'the line-2 TypeShade row precedes the line-3 TypeScript row',
    ).toBeLessThan(sources.lastIndexOf('typescript'));
    // Ties break by length, then by source, so the order is a function of the rows alone.
    for (let i = 1; i < diagnostics.length; i++) {
      const a = diagnostics[i - 1]!;
      const b = diagnostics[i]!;
      if (a.span.start !== b.span.start) continue;
      expect(a.span.length <= b.span.length).toBe(true);
      if (a.span.length === b.span.length) expect(a.source <= b.source).toBe(true);
    }
  });

  it('never reports TS1206 for @vertex/@fragment/@builtin/@location on the entry grammar', () => {
    const service = createTypeshadeLanguageService();
    service.openDocument('hello.ts', HELLO);
    const ts1206 = service
      .getDiagnostics('hello.ts')
      .filter((d) => d.source === 'typescript' && d.code === 1206);
    expect(ts1206).toEqual([]);
  });

  // Regression: the compiler's own `lowerSourceFunctions` collects every top-level function
  // declaration (`sourceFile.statements.filter(ts.isFunctionDeclaration)`), with no `export`
  // requirement at all, so `@vertex` on a non-exported function compiles and emits today. The
  // TS1206 filter used to require `export` on the decorated function, which disagreed with that
  // and left a real TS1206 red on a program the compiler accepts outright.
  it('never reports TS1206 for @vertex/@fragment on a non-exported top-level function either', () => {
    const service = createTypeshadeLanguageService();
    const text =
      '"use typeshade";\n' +
      'class Clip {\n' +
      '  @builtin("position") pos: vec4\n' +
      '}\n' +
      '@vertex\n' +
      'function vs(@builtin("vertex_index") i: u32): Clip {\n' +
      '  return { pos: vec4(0., 0., 0., 1.) }\n' +
      '}\n';
    service.openDocument('unexported.ts', text);
    const ts1206 = service
      .getDiagnostics('unexported.ts')
      .filter((d) => d.source === 'typescript' && d.code === 1206);
    expect(ts1206).toEqual([]);
  });

  // A decorator on a declaration that takes none is the compiler's TS8028 now (Rule 6.7), with
  // the sentence that says what the attribute is, so TypeScript's TS1206 "Decorators are not
  // valid here" on the same decorator would be the one mistake said twice (Rule 12.4). That
  // holds at any depth: a namespace's constant and a function's local are declarations too.
  it('says a decorator on a declaration once, as the compiler does', () => {
    const service = createTypeshadeLanguageService();
    const text =
      '"use typeshade";\n' +
      'class U { a: f32 }\n' +
      '@group(2) @binding(5) declare const u: uniform<U>;\n' +
      '@id(7) declare const k: override<f32>;\n' +
      '@bogus const K: f32 = 1.;\n' +
      'namespace N { @group(1) export const J: f32 = 1.; }\n' +
      '@fragment\n' +
      'export function fs(): vec4 { @bogus const l = 1.; return vec4(u.a + k + K + N.J + l); }\n';
    service.openDocument('decorated.ts', text);
    const diagnostics = service.getDiagnostics('decorated.ts');
    expect(
      diagnostics.map((d) => [
        d.source,
        d.code,
        text.slice(d.span.start, d.span.start + d.span.length),
      ]),
    ).toEqual([
      ['typeshade', 'TS8028', '@group(2)'],
      ['typeshade', 'TS8028', '@binding(5)'],
      ['typeshade', 'TS8028', '@id(7)'],
      ['typeshade', 'TS8028', '@bogus'],
      ['typeshade', 'TS8028', '@group(1)'],
      ['typeshade', 'TS8028', '@bogus'],
    ]);
  });

  // A class and its fields take decorators in TypeScript, so `@size` there is TypeScript's
  // TS2304 "Cannot find name 'size'" as well as the compiler's TS8028 on the same decorator.
  it("says a WGSL attribute on a field once, without TypeScript's unresolved name", () => {
    const service = createTypeshadeLanguageService();
    const text =
      '"use typeshade";\n' +
      'class S { @size(16) x: f32; @align(16) y: f32; @locaton(0) z: f32 }\n' +
      'declare const u: uniform<S>;\n' +
      '@fragment\n' +
      'export function fs(): vec4 { return vec4(u.x + u.y + u.z); }\n';
    service.openDocument('field.ts', text);
    expect(
      service
        .getDiagnostics('field.ts')
        .map((d) => [d.source, d.code, text.slice(d.span.start, d.span.start + d.span.length)]),
    ).toEqual([
      ['typeshade', 'TS8028', '@size(16)'],
      ['typeshade', 'TS8010', '@align(16)'],
      ['typeshade', 'TS8028', '@locaton(0)'],
    ]);
  });

  // `a + b` on two class instances was TypeScript's TS2365 alone before the compiler refused
  // the operator (Rule 7.1); now the compiler's TS8003 says it, and TypeScript's gives way, as
  // do TS2362 and TS2363 on two bools and the TS2322 their `number` result draws (Rule 12.4).
  it('says an operator WGSL has no overload for once, as the compiler does', () => {
    const service = createTypeshadeLanguageService();
    const text =
      '"use typeshade";\n' +
      'class A { x: f32 = 0.; }\n' +
      'export function k(): f32 { const a = new A(); const b = new A(); return (a + b).x; }\n' +
      'export function m(p: bool, q: bool): bool { return p * q; }\n';
    service.openDocument('operators.ts', text);
    expect(
      service
        .getDiagnostics('operators.ts')
        .map((d) => [d.source, d.code, text.slice(d.span.start, d.span.start + d.span.length)]),
    ).toEqual([
      ['typeshade', 'TS8003', 'a + b'],
      ['typeshade', 'TS8003', 'p * q'],
    ]);
  });

  // TypeScript types an operation from the operator alone, a `number` whatever the operands,
  // so where the compiler refuses the operation, every report about its value is that guess
  // again: TS2339 on a member of it, TS7053 on an element, TS2322 where it is returned, in
  // place or through a local declared from it, and TS2769 where it is an argument. Each was a
  // second diagnostic for the one refused operator (Rule 12.4).
  it("says a refused operator once, without TypeScript's report about its value", () => {
    const service = createTypeshadeLanguageService();
    const text =
      '"use typeshade";\n' +
      'class A { x: f32 = 0.; }\n' +
      'declare const t: texture_2d<f32>;\n' +
      'export function f(a: A, b: A): f32 { return (a & b).x; }\n' +
      'export function g(a: A): f32 { return (-a).x; }\n' +
      'export function h(a: array<f32, 2>): f32 { const b = -a; return b[0]; }\n' +
      'export function i(p: bool, q: bool): bool { const c = p * q; return c; }\n' +
      'export function j(a: A): f32 { let v = a; v += new A(); return v.x; }\n' +
      'export function l(a: A): f32 { const b = +a; return b.x; }\n' +
      'export function m(): vec4f { return textureLoad(+t, vec2i(0, 0), 0); }\n';
    service.openDocument('knock-on.ts', text);
    expect(
      service
        .getDiagnostics('knock-on.ts')
        .map((d) => [d.source, d.code, text.slice(d.span.start, d.span.start + d.span.length)]),
    ).toEqual([
      ['typeshade', 'TS8003', 'a & b'],
      ['typeshade', 'TS8003', '-a'],
      ['typeshade', 'TS8003', '-a'],
      ['typeshade', 'TS8003', 'p * q'],
      ['typeshade', 'TS8003', 'v'],
      ['typeshade', 'TS8003', '+a'],
      ['typeshade', 'TS8003', '+t'],
    ]);
  });

  // A decorator nothing reads is the compiler's TS8028, and its TS8035 on a method (Rule 6.7):
  // on a function declared in another function's body TypeScript also says TS1206, and on a
  // static field or a method, which it lets a decorator name, TS2304 for a name the ambient
  // library does not declare. Either would be the one mistake said twice (Rule 12.4).
  it('says a decorator on a local function, a static field or a method once', () => {
    const service = createTypeshadeLanguageService();
    const text =
      '"use typeshade";\n' +
      'class A { @bogus static K: f32 = 2.; x: f32 = 0.; @bogus m(): f32 { return 1.; } }\n' +
      'namespace N { @bogus export function f(): f32 { return 1.; } }\n' +
      '@fragment\n' +
      'export function fs(): vec4 { @bogus function g(): f32 { return 1.; } ' +
      'return vec4(A.K + N.f() + g()); }\n';
    service.openDocument('unread.ts', text);
    expect(
      service
        .getDiagnostics('unread.ts')
        .map((d) => [d.source, d.code, text.slice(d.span.start, d.span.start + d.span.length)]),
    ).toEqual([
      ['typeshade', 'TS8028', '@bogus'],
      ['typeshade', 'TS8035', '@bogus'],
      ['typeshade', 'TS8028', '@bogus'],
      ['typeshade', 'TS8028', '@bogus'],
    ]);
  });

  // The places TypeScript refuses a decorator the compiler did not read: a constructor (TS1206),
  // an abstract method (TS1249), a local function's parameter, where Tint refuses the WGSL
  // (TS1206), and the second decorator of a method (TS2304). Each is the compiler's refusal
  // alone. A method's `@fragment`, which TypeScript checks against a `TypedPropertyDescriptor`
  // the ambient library does not declare, adds nothing of TypeScript's either (TS2318).
  it('says a decorator on a constructor, an abstract method or a helper parameter once', () => {
    const service = createTypeshadeLanguageService();
    const text =
      '"use typeshade";\n' +
      'class M { x: f32 = 0.; @bogus constructor() { this.x = 1.; } @a @b f(): f32 { return 1.; } ' +
      '@fragment g(): f32 { return 2.; } }\n' +
      'abstract class B { x: f32 = 0.; @bogus abstract f(): f32; }\n' +
      'class C extends B { f(): f32 { return this.x; } }\n' +
      '@fragment\n' +
      'export function fs(@builtin("position") p: vec4): vec4 {\n' +
      '  function g(@location(0) x: f32): f32 { return x; }\n' +
      '  const m = new M();\n' +
      '  return vec4(g(p.x) + m.f() + m.g() + new C().f());\n' +
      '}\n';
    service.openDocument('unread2.ts', text);
    expect(
      service
        .getDiagnostics('unread2.ts')
        .map((d) => [d.source, d.code, text.slice(d.span.start, d.span.start + d.span.length)]),
    ).toEqual([
      ['typeshade', 'TS8028', '@bogus'],
      ['typeshade', 'TS8035', '@a'],
      ['typeshade', 'TS8035', '@fragment'],
      ['typeshade', 'TS8028', '@bogus'],
      ['typeshade', 'TS8028', '@location(0)'],
    ]);
  });

  // A namespace's function is an entry as a top-level one is (`@fragment fn N_fs`), so its
  // decorators and its parameters' are the grammar, as they are on a top-level function: no
  // TS1206 (Rule 12.7).
  it("says nothing about a namespace entry's decorators", () => {
    const service = createTypeshadeLanguageService();
    const text =
      '"use typeshade";\n' +
      'namespace N {\n' +
      '  @fragment export function fs(@builtin("position") p: vec4): vec4 { return p; }\n' +
      '}\n';
    service.openDocument('ns-entry.ts', text);
    expect(service.getDiagnostics('ns-entry.ts')).toEqual([]);
    expect(service.getCompiledOutput('ns-entry.ts', 'wgsl')?.text).toContain('@fragment');
  });
});

describe('getCompiledOutput', () => {
  it('returns the same WGSL as compileTsSource for a clean program', () => {
    const service = createTypeshadeLanguageService();
    service.openDocument('hello.ts', HELLO);
    const output = service.getCompiledOutput('hello.ts', 'wgsl');
    const direct = compileTsSource(HELLO, { fileName: 'hello.ts' });
    expect(output).toBeDefined();
    expect(output!.diagnostics).toEqual([]);
    expect(output!.text).toBe(direct.wgsl);
    expect(output!.text.length).toBeGreaterThan(0);
  });

  it('returns undefined for a document that was never opened', () => {
    const service = createTypeshadeLanguageService();
    expect(service.getCompiledOutput('nope.ts', 'wgsl')).toBeUndefined();
  });

  // Regression: an emit exception was swallowed into `text: ''` with no diagnostic, so an
  // output pane showed an empty shader and nothing to say why. A compute-only module asked for
  // a GLSL stage is the natural case: emitGlslModule refuses it (glsl-es300 has no compute)
  // with an UnsupportedFeatureError naming the missing capability.
  it('reports an emit exception as a BACKEND diagnostic on the first statement, with empty text', () => {
    const service = createTypeshadeLanguageService();
    const text =
      '"use typeshade";\n' +
      '@compute([64, 1, 1])\n' +
      'export function cs(@builtin("global_invocation_id") id: vec3u): void {\n' +
      '  const x = id.x\n' +
      '}\n';
    service.openDocument('compute.ts', text);
    expect(service.getDiagnostics('compute.ts')).toEqual([]);
    expect(service.getCompiledOutput('compute.ts', 'wgsl')?.text).toContain('@compute');

    for (const target of ['glsl-vertex', 'glsl-fragment'] as const) {
      const output = service.getCompiledOutput('compute.ts', target);
      expect(output).toBeDefined();
      expect(output!.text).toBe('');
      expect(output!.diagnostics).toHaveLength(1);
      const d = output!.diagnostics[0]!;
      expect(d.source).toBe('typeshade');
      expect(d.code).toBe('TS8015');
      expect(d.severity).toBe('error');
      expect(d.message).toContain(target);
      expect(d.message).toContain('compute');
      // The range covers the first statement: the directive on line 0.
      expect(d.range.start.line).toBe(0);
      expect(text.slice(d.span.start, d.span.start + d.span.length)).toBe('"use typeshade";');
    }
    // The emit failure is a fact about that target only: getDiagnostics stays clean.
    expect(service.getDiagnostics('compute.ts')).toEqual([]);
  });

  it('produces GLSL fragment output distinct from the WGSL text', () => {
    const service = createTypeshadeLanguageService();
    service.openDocument('hello.ts', HELLO);
    const glsl = service.getCompiledOutput('hello.ts', 'glsl-fragment');
    expect(glsl).toBeDefined();
    expect(glsl!.diagnostics).toEqual([]);
    expect(glsl!.text).toContain('void main');
  });
});

describe('getDiagnostics: Stage 3 TypeShade checks (design doc §10 step 5)', () => {
  it('reports an unknown builtin with source typeshade, the right code, and a range over the literal', () => {
    const service = createTypeshadeLanguageService();
    const text =
      '"use typeshade";\n' +
      '@vertex\n' +
      'export function vs(@builtin("vertex_idx") i: u32): vec4 {\n' +
      '  return vec4(0., 0., 0., 1.)\n' +
      '}\n';
    service.openDocument('builtin-name.ts', text);
    const d = service
      .getDiagnostics('builtin-name.ts')
      .find((d) => d.source === 'typeshade' && d.code === 'TS8024');
    expect(d, 'expected a TS8024 (BUILTIN_NAME) diagnostic').toBeDefined();
    expect(d!.severity).toBe('error');
    expect(d!.message).toContain('Did you mean "vertex_index"?');
    // Line 2 (0-based): the `@builtin("vertex_idx")` parameter decorator.
    expect(d!.range.start.line).toBe(2);
    expect(text.slice(d!.span.start, d!.span.start + d!.span.length)).toBe('"vertex_idx"');
  });

  it('reports a wrong-stage builtin with source typeshade and the right code', () => {
    const service = createTypeshadeLanguageService();
    const text =
      '"use typeshade";\n' +
      '@vertex\n' +
      'export function vs(@builtin("front_facing") f: bool): vec4 {\n' +
      '  return vec4(0., 0., 0., 1.)\n' +
      '}\n';
    service.openDocument('builtin-stage.ts', text);
    const d = service
      .getDiagnostics('builtin-stage.ts')
      .find((d) => d.source === 'typeshade' && d.code === 'TS8025');
    expect(d, 'expected a TS8025 (BUILTIN_STAGE) diagnostic').toBeDefined();
    expect(d!.severity).toBe('error');
    expect(d!.range.start.line).toBe(2);
  });

  it('warns about a @compute workgroup shape over the default limits with source typeshade and the right code', () => {
    const service = createTypeshadeLanguageService();
    const text =
      '"use typeshade";\n' + '@compute([64, 8, 1])\n' + 'export function cs(): void {\n' + '}\n';
    service.openDocument('workgroup.ts', text);
    const d = service
      .getDiagnostics('workgroup.ts')
      .find((d) => d.source === 'typeshade' && d.code === 'TS8026');
    expect(d, 'expected a TS8026 (WORKGROUP_SHAPE) diagnostic').toBeDefined();
    expect(d!.severity).toBe('warning');
    expect(d!.range.start.line).toBe(1);
  });

  it('reports an entry function with no return annotation that returns a value, naming the inferred type', () => {
    const service = createTypeshadeLanguageService();
    const text =
      '"use typeshade";\n' +
      '@fragment\n' +
      'export function fs() {\n' +
      '  return vec4(1., 0., 0., 1.)\n' +
      '}\n';
    service.openDocument('no-return-type.ts', text);
    const d = service
      .getDiagnostics('no-return-type.ts')
      .find((d) => d.source === 'typeshade' && d.code === 'TS8021');
    expect(d, 'expected a TS8021 (RETURN_SHAPE) diagnostic').toBeDefined();
    expect(d!.severity).toBe('error');
    expect(d!.message).toContain('inferred type vec4)');
  });

  // `mat2<f32>` used to be the TS8027 sample here. Every `matCxR` is a type since #149, so
  // the sample moved to what TS8027 still marks: a NON-SQUARE matrix of emulated doubles,
  // which the fp64 pass has no df64 body for (it has one per dimension, not per shape).
  it('reports a non-square f64 matrix as unsupported with source typeshade and the right code', () => {
    const service = createTypeshadeLanguageService();
    const text =
      '"use typeshade";\n' +
      'export function f(m: mat2x3<f64>): vec2 {\n' +
      '  return vec2(0., 0.)\n' +
      '}\n';
    service.openDocument('mat2.ts', text);
    const d = service
      .getDiagnostics('mat2.ts')
      .find((d) => d.source === 'typeshade' && d.code === 'TS8027');
    expect(d, 'expected a TS8027 (MAT_UNSUPPORTED) diagnostic').toBeDefined();
    expect(d!.severity).toBe('error');
  });

  it('reports nothing for mat2, which is now an ordinary type', () => {
    const service = createTypeshadeLanguageService();
    service.openDocument(
      'mat2ok.ts',
      '"use typeshade";\nexport function f(m: mat2<f32>): vec2 {\n  return m * vec2(1., 0.)\n}\n',
    );
    expect(service.getDiagnostics('mat2ok.ts')).toEqual([]);
  });
});

describe('positionAt / offsetAt', () => {
  it('round-trips on an open document', () => {
    const service = createTypeshadeLanguageService();
    service.openDocument('rt.ts', HELLO);
    const offset = 40;
    const position = service.positionAt('rt.ts', offset);
    expect(service.offsetAt('rt.ts', position)).toBe(offset);
  });

  it('handles a CRLF document at the same zero-based position as LF', () => {
    const service = createTypeshadeLanguageService();
    const crlf = '"use typeshade";\r\nexport function f(): f32 {\r\n  return 1\r\n}\r\n';
    service.openDocument('crlf.ts', crlf);
    const position = service.positionAt('crlf.ts', crlf.indexOf('f32'));
    expect(position.line).toBe(1);
    const back = service.offsetAt('crlf.ts', position);
    expect(crlf.slice(back, back + 3)).toBe('f32');
  });

  it('produces clean diagnostics on a CRLF document', () => {
    const service = createTypeshadeLanguageService();
    const crlf = HELLO.replace(/\n/g, '\r\n');
    service.openDocument('crlf-hello.ts', crlf);
    expect(service.getDiagnostics('crlf-hello.ts')).toEqual([]);
  });
});

describe('getDiagnostics: a syntax error', () => {
  it('shows the parse error once, from TypeScript, with no cascaded TypeShade diagnostics', () => {
    const service = createTypeshadeLanguageService();
    service.openDocument(
      'syntax.ts',
      '"use typeshade";\nexport function f(): vec4 {\n  return vec4(3.14;\n}\n',
    );
    const all = service.getDiagnostics('syntax.ts');
    // TypeScript's own TS1005 (`')' expected`) on line 2 (0-based), once.
    const parse = all.filter((d) => d.source === 'typescript' && d.code === 1005);
    expect(parse).toHaveLength(1);
    expect(parse[0]!.range.start.line).toBe(2);
    // The compiler's SYNTAX copy of it is dropped here, and nothing was lowered, so no
    // TypeShade diagnostic at all.
    expect(all.filter((d) => d.source === 'typeshade')).toEqual([]);
    expect(all.filter((d) => /'\)' expected/.test(d.message))).toHaveLength(1);
    // And the compiled output for such a document is empty, not a WGSL module.
    expect(service.getCompiledOutput('syntax.ts', 'wgsl')?.text ?? '').not.toMatch(/fn f/);
  });
});

describe('getDiagnostics: cache invalidation across imports (design doc §8)', () => {
  const B_OK = '"use typeshade";\nexport function k(): f32 {\n  return 1.\n}\n';
  const B_BROKEN = '"use typeshade";\nexport function k(): bool {\n  return true\n}\n';
  const A =
    '"use typeshade";\nimport { k } from "./b.js"\nexport function f(): f32 {\n  return k()\n}\n';
  const tsErrors = (service: ReturnType<typeof createTypeshadeLanguageService>) =>
    service
      .getDiagnostics('/a.ts')
      .filter((d) => d.source === 'typescript')
      .map((d) => d.code);

  // Regression: the cache was keyed by A's own (uri, version) alone, so once A's diagnostics
  // had been computed, changing or closing B never refreshed them until A itself was edited.
  it('refreshes A when the document it imports changes, without A being touched', () => {
    const service = createTypeshadeLanguageService();
    service.openDocument('/b.ts', B_OK, 1);
    service.openDocument('/a.ts', A, 1);
    expect(tsErrors(service)).toEqual([]);
    service.updateDocument('/b.ts', B_BROKEN, 2);
    // k() is now bool, returned where f32 is annotated: TS2322 in A.
    expect(tsErrors(service)).toContain(2322);
    service.updateDocument('/b.ts', B_OK, 3);
    expect(tsErrors(service)).toEqual([]);
  });

  it('reflects a closed import as a missing module, then its reopening as resolved again', () => {
    const service = createTypeshadeLanguageService();
    service.openDocument('/b.ts', B_OK, 1);
    service.openDocument('/a.ts', A, 1);
    expect(tsErrors(service)).toEqual([]);
    service.closeDocument('/b.ts');
    // TS2307: Cannot find module './b.js'.
    expect(tsErrors(service)).toContain(2307);
    service.openDocument('/b.ts', B_OK, 1);
    expect(tsErrors(service)).toEqual([]);
  });

  // Regression: the key was built from the top-level import and export declarations alone,
  // so a module reached only through an import(...) type never entered it, and A's diagnostics
  // stayed put while C changed, though the TypeScript program had followed that edge.
  it('follows a module referenced only through an import("...") type', () => {
    const service = createTypeshadeLanguageService();
    const C_OK = '"use typeshade";\nexport function c(): f32 {\n  return 1.\n}\n';
    const C_BROKEN = '"use typeshade";\nexport function c(): bool {\n  return true\n}\n';
    const A3 =
      '"use typeshade";\n' +
      'type M = typeof import("./c.js")\n' +
      'export function f(): f32 {\n  const m: M = null as any\n  return m.c()\n}\n';
    service.openDocument('/c.ts', C_OK, 1);
    service.openDocument('/a.ts', A3, 1);
    expect(tsErrors(service)).toEqual([]);
    service.updateDocument('/c.ts', C_BROKEN, 2);
    expect(tsErrors(service)).toContain(2322);
    service.updateDocument('/c.ts', C_OK, 3);
    expect(tsErrors(service)).toEqual([]);
  });

  it('follows the import chain transitively: a change two hops away refreshes the root', () => {
    const service = createTypeshadeLanguageService();
    const C_OK = '"use typeshade";\nexport function c(): f32 {\n  return 1.\n}\n';
    const C_BROKEN = '"use typeshade";\nexport function c(): bool {\n  return true\n}\n';
    // B re-exports c's result under an inferred type, so A's own type error appears or
    // disappears with C's declared return type while B's text never changes.
    const B = '"use typeshade";\nimport { c } from "./c.js"\nexport const K = c()\n';
    const A2 =
      '"use typeshade";\nimport { K } from "./b.js"\nexport function f(): f32 {\n  return K\n}\n';
    service.openDocument('/c.ts', C_OK, 1);
    service.openDocument('/b.ts', B, 1);
    service.openDocument('/a.ts', A2, 1);
    expect(tsErrors(service)).toEqual([]);
    service.updateDocument('/c.ts', C_BROKEN, 2);
    expect(tsErrors(service)).toContain(2322);
    service.updateDocument('/c.ts', C_OK, 3);
    expect(tsErrors(service)).toEqual([]);
  });
});
