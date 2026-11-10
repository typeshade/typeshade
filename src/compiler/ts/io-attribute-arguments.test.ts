// Verifies: Rule 6.6, Rule 6.7, Rule 8.2, Rule 12.4, Rule 12.6, Rule 12.7.
// Present but malformed IO attributes must not disappear into an unattributed parameter.
// Measured 2026-11-07 on Chromium 156.0.8078.4 / Google SwiftShader: ten previously emitted
// malformed cases fail shader creation with "missing entry point IO attribute on parameter"
// or "'@location' must be an 'i32' or 'u32' value". Nine valid neighbours create pipelines.
// The two extra-argument sources previously discarded their second argument and emitted valid
// WGSL. Synthetic @location(0, 1) fails with "location expects 1 argument, got 2". A builtin's
// extra argument is refused by TypeShade's one-name contract; WGSL has a builtin depth-mode
// argument, so this does not claim every two-argument WGSL builtin attribute is invalid.
// The broken-shader instrument fails too. These are module/pipeline checks, not draw results.
import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const URI = '/attributes/main.shade.ts';
const BUILTIN = '@builtin takes one name as a string: @builtin("position").';
const LOCATION = '@location takes one non-negative integer literal: @location(0).';

type Refusal = { code: string; message: string; at: string };
function paired(body: string, refusal?: Refusal & { also?: readonly Refusal[] }) {
  const source = `"use typeshade";\n${body}`;
  const compiled = compile(source, { fileName: URI });
  const errors = compiled.diagnostics.filter((d) => d.category === 'error');
  const service = createTypeshadeLanguageService();
  service.updateDocument(URI, source);
  const editor = service.getDiagnostics(URI).filter((d) => d.severity === 'error');
  const expected = refusal === undefined ? [] : [refusal, ...(refusal.also ?? [])];
  expect(errors).toHaveLength(expected.length);
  expect(editor).toHaveLength(expected.length);
  for (const r of expected) {
    const start = source.indexOf(r.at);
    expect(start).toBeGreaterThanOrEqual(0);
    const line = source.slice(0, start).split('\n').length - 1;
    const character = start - source.lastIndexOf('\n', start) - 1;
    expect(
      errors.find((d) => d.code === r.code && d.message === r.message && d.start === start),
    ).toMatchObject({
      code: r.code,
      message: r.message,
      fileName: URI,
      start,
      length: r.at.length,
      line: line + 1,
      character: character + 1,
      endLine: line + 1,
      endCharacter: character + r.at.length + 1,
    });
    expect(
      editor.find((d) => d.code === r.code && d.message === r.message && d.span.start === start),
    ).toMatchObject({
      code: r.code,
      message: r.message,
      range: {
        start: { line, character },
        end: { line, character: character + r.at.length },
      },
    });
  }
  if (expected.length === 0) expect(compiled.wgsl).toBeDefined();
  else expect(compiled.wgsl).toBeUndefined();
  return compiled;
}

describe('malformed IO attribute arguments', () => {
  for (const decorator of [
    '@builtin',
    '@builtin()',
    '@builtin(3)',
    '@builtin(name)',
    '@builtin("vertex_index", "position")',
  ]) {
    it(`refuses the whole parameter ${decorator}`, () => {
      paired(`@vertex export function vs(${decorator} i: u32): vec4 { return vec4(f32(i)); }`, {
        code: 'TS8024',
        message: BUILTIN,
        at: decorator,
      });
    });
  }
  for (const decorator of [
    '@location',
    '@location()',
    '@location(-1)',
    '@location("0")',
    '@location(slot)',
    '@location(0.5)',
    '@location(0, 1)',
    '@location(1e309)',
  ]) {
    it(`refuses the whole parameter ${decorator}`, () => {
      paired(`@vertex export function vs(${decorator} x: f32): vec4 { return vec4(x); }`, {
        code: 'TS8028',
        message: LOCATION,
        at: decorator,
      });
    });
  }
  for (const [type, code, message] of [
    ['builtin<3, u32>', 'TS8024', BUILTIN],
    ['builtin<string, u32>', 'TS8024', BUILTIN],
    ['location<-1, f32>', 'TS8028', LOCATION],
    ['location<"0", f32>', 'TS8028', LOCATION],
    ['location<number, f32>', 'TS8028', LOCATION],
    ['location<0.5, f32>', 'TS8028', LOCATION],
  ]) {
    it(`reads the same refusal in parameter type ${type}`, () => {
      paired(`@vertex export function vs(x: ${type}): vec4 { return vec4(f32(x)); }`, {
        code: code!,
        message: message!,
        at: type!,
      });
    });
  }
  for (const [member, at, code, message] of [
    ['@builtin() pos: vec4;', '@builtin()', 'TS8024', BUILTIN],
    ['@builtin(3) pos: vec4;', '@builtin(3)', 'TS8024', BUILTIN],
    ['@location(-1) pos: vec4;', '@location(-1)', 'TS8028', LOCATION],
    ['pos: builtin<3, vec4>;', 'builtin<3, vec4>', 'TS8024', BUILTIN],
    ['pos: location<0.5, vec4>;', 'location<0.5, vec4>', 'TS8028', LOCATION],
  ]) {
    it(`does not add missing-attribute or missing-position errors for ${at}`, () => {
      paired(
        `class Output { ${member} }
@vertex export function vs(): Output { return { pos: vec4(0.) }; }
@fragment export function fs(p: Output): vec4 { return p.pos; }`,
        { code: code!, message: message!, at: at! },
      );
    });
  }
  for (const declaration of [
    'interface Output { pos: builtin<3, vec4>; }',
    'type Output = { pos: builtin<3, vec4>; };',
    'class Base { pos: builtin<3, vec4>; } class Output extends Base {}',
  ]) {
    it(`keeps the field refusal through ${declaration}`, () => {
      paired(
        `${declaration}
@vertex export function vs(): Output { return { pos: vec4(0.) }; }`,
        { code: 'TS8024', message: BUILTIN, at: 'builtin<3, vec4>' },
      );
    });
  }
});

describe('independent mistakes and refused declarations', () => {
  for (const type of [
    'builtin<3, u32, { interpolate: "bogus" }>',
    'location<"0", f32, { interpolate: "bogus" }>',
  ]) {
    it(`keeps the independent option refusal in ${type}`, () => {
      paired(`@fragment export function fs(x: ${type}): vec4 { return vec4(0.); }`, {
        code: type.startsWith('builtin') ? 'TS8024' : 'TS8028',
        message: type.startsWith('builtin') ? BUILTIN : LOCATION,
        at: type,
        also: [
          {
            code: 'TS8028',
            message: 'interpolate type "bogus" is not one WGSL has: perspective, linear, flat.',
            at: 'interpolate: "bogus"',
          },
        ],
      });
    });
  }
  it('keeps an independent option refusal on a field', () => {
    paired(
      `interface Output { color: location<"0", vec4, { interpolate: "bogus" }>; }
@fragment export function fs(): Output { return { color: vec4(0.) }; }`,
      {
        code: 'TS8028',
        message: LOCATION,
        at: 'location<"0", vec4, { interpolate: "bogus" }>',
        also: [
          {
            code: 'TS8028',
            message: 'interpolate type "bogus" is not one WGSL has: perspective, linear, flat.',
            at: 'interpolate: "bogus"',
          },
        ],
      },
    );
  });
  it('keeps an independent blend source refusal on a field', () => {
    paired(
      `interface Output { color: location<"0", vec4, { blend_src: 2 }>; }
@fragment export function fs(): Output { return { color: vec4(0.) }; }`,
      {
        code: 'TS8028',
        message: LOCATION,
        at: 'location<"0", vec4, { blend_src: 2 }>',
        also: [
          {
            code: 'TS8010',
            message: 'blend_src takes 0 or 1 — the two sources a dual-source blend mixes — not 2.',
            at: 'color: location<"0", vec4, { blend_src: 2 }>;',
          },
        ],
      },
    );
  });
  for (const call of ['return vs(0);', 'const alias = vs; return alias(0);']) {
    it(`does not cascade through a refused entry: ${call}`, () => {
      paired(
        `@vertex export function vs(@builtin() i: u32): vec4 { return vec4(f32(i)); }
export function use(): vec4 { ${call} }`,
        { code: 'TS8024', message: BUILTIN, at: '@builtin()' },
      );
    });
  }
  it('does not cascade through a refused modern entry', () => {
    paired(
      `@vertex export function vs(i: builtin<3, u32>): vec4 { return vec4(f32(i)); }
export function use(): vec4 { return vs(0); }`,
      { code: 'TS8024', message: BUILTIN, at: 'builtin<3, u32>' },
    );
  });
});

describe('existing IO attribute neighbours', () => {
  for (const argument of ['"vertex_index"', "'vertex_index'", '`vertex_index`']) {
    it(`keeps builtin string spelling ${argument}`, () => {
      const c = paired(
        `@vertex export function vs(@builtin(${argument}) i: u32): vec4 { return vec4(f32(i)); }`,
      );
      expect(c.wgsl).toContain('@builtin(vertex_index) i: u32');
    });
  }
  for (const argument of ['0', '0.', '0x0', '0b0', '0o0', '0e0']) {
    it(`keeps location numeric spelling ${argument}`, () => {
      const c = paired(
        `@vertex export function vs(@location(${argument}) x: f32): vec4 { return vec4(x); }`,
      );
      expect(c.wgsl).toContain('@location(0) x: f32');
    });
  }
  it('keeps modern types and a valid option object', () => {
    paired(
      `@vertex export function vs(i: builtin<"vertex_index">, x: location<0, f32>): vec4 { return vec4(x + f32(i)); }`,
    );
    paired(
      `@fragment export function fs(x: location<0, f32, { interpolate: "flat" }>): vec4 { return vec4(x); }`,
    );
  });
  it('leaves the separate bare-parameter gap unchanged', () => {
    const c = paired('@vertex export function vs(x: f32): vec4 { return vec4(x); }');
    expect(c.wgsl).toContain('x: f32');
  });
  it('keeps misplaced malformed attributes under the existing site refusal', () => {
    paired('export function f(@builtin() x: u32): u32 { return x; }', {
      code: 'TS8028',
      message:
        '"@builtin" does not apply to a parameter of a function that is not an entry: it marks an entry\'s input or output. Remove it.',
      at: '@builtin()',
    });
  });
  it('does not suppress an independent unknown value type', () => {
    paired('@fragment export function fs(x: builtin<3, Unknown>): vec4 { return vec4(0.); }', {
      code: 'TS8002',
      message:
        'Unknown type "Unknown". Declare it in this file, or import it from another shader module.',
      at: 'Unknown',
    });
  });
  it('preserves the existing unknown-name refusal at its string argument', () => {
    paired(
      '@vertex export function vs(@builtin("vertex_idx") i: u32): vec4 { return vec4(f32(i)); }',
      {
        code: 'TS8024',
        message: 'Unknown builtin "vertex_idx". Did you mean "vertex_index"?',
        at: '"vertex_idx"',
      },
    );
  });
});

describe('attribute declarations in imported and uncollected types', () => {
  const shapes = [
    ['class', 'export class Out { x: location<0.5, f32>; }', 'Out', 'location<0.5, f32>'],
    [
      'generic class',
      'export class Out<T> { x: location<0.5, T>; }',
      'Out<f32>',
      'location<0.5, T>',
    ],
    ['interface', 'export interface Out { x: location<0.5, f32>; }', 'Out', 'location<0.5, f32>'],
    ['object alias', 'export type Out = { x: location<0.5, f32> };', 'Out', 'location<0.5, f32>'],
  ] as const;
  for (const [name, declaration, type, at] of shapes) {
    it(`reports an imported ${name} at the declaration in both halves`, () => {
      const library = `"use typeshade"; ${declaration}`;
      const main = `"use typeshade"; import { Out } from "./lib.shade.ts";
@fragment export function fs(x: ${type}): vec4 { return vec4(x.x); }`;
      const readDocument = (path: string) =>
        path === '/attributes/lib.shade.ts' ? library : undefined;
      const c = compile(main, { fileName: URI, readDocument });
      const service = createTypeshadeLanguageService({ readDocument });
      service.updateDocument(URI, main);
      service.updateDocument('/attributes/lib.shade.ts', library);
      const errors = c.diagnostics.filter((d) => d.category === 'error');
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({
        code: 'TS8028',
        message: LOCATION,
        fileName: '/attributes/lib.shade.ts',
        start: library.indexOf(at),
        length: at.length,
      });
      expect(service.getDiagnostics(URI).filter((d) => d.severity === 'error')).toEqual([]);
      const editor = service
        .getDiagnostics('/attributes/lib.shade.ts')
        .filter((d) => d.severity === 'error');
      expect(editor).toHaveLength(1);
      expect(editor[0]).toMatchObject({
        code: 'TS8028',
        message: LOCATION,
        span: { start: library.indexOf(at), length: at.length },
      });
      expect(c.wgsl).toBeUndefined();
    });
  }
  for (const body of [
    'interface Host { seed: number; callback: () => number; } type RecordType = { text: string }; export {};',
    'type location<I, T> = T; interface Host { x: location<0.5, number>; } export {};',
    'type builtin<I, T> = T; type Host = { x: builtin<3, number> }; export {};',
    'class location<I, T> { value: T; } interface Host { x: location<0.5, number>; } export {};',
    'class builtin<I, T> { value: T; } type Host = { x: builtin<3, number> }; export {};',
    'interface location<I, T> { value: T; } interface Host { x: location<0.5, number>; } export {};',
    'class Host<location> { value: location; } export {};',
    'class Host<L extends number> { value: location<L, f32>; } export {};',
  ]) {
    it(`does not collect or reinterpret host-only declarations: ${body}`, () => {
      expect(paired(body).wgsl).toBe('\n');
    });
  }
  it('checks an independent option on an uninstantiated generic declaration', () => {
    paired('class Out<T> { x: location<"0", T, { interpolate: "bogus" }>; } export {};', {
      code: 'TS8028',
      message: LOCATION,
      at: 'location<"0", T, { interpolate: "bogus" }>',
      also: [
        {
          code: 'TS8028',
          message: 'interpolate type "bogus" is not one WGSL has: perspective, linear, flat.',
          at: 'interpolate: "bogus"',
        },
      ],
    });
  });
});
