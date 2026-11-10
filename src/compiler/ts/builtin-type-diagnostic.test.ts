// A builtin field's type is a declaration error, reported once even when several entries
// use its struct (#321, types#10). Its stage remains a check of each entry use.
// Tint in Chromium 156 (SwiftShader) accepts position: vec4<f32> and vertex_index: u32,
// and refuses their vec3<f32> and f32 neighbours. The broken-shader instrument failed first.
// Verifies: Rule 8.2, Rule 12.4, Rule 12.7 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const fileName = '/a.shade.ts';

function both(source: string, library?: string) {
  const readDocument = (path: string): string | undefined =>
    path === '/lib.shade.ts' ? library : undefined;
  const result = compile(source, { fileName, readDocument });
  const service = createTypeshadeLanguageService({ readDocument });
  if (library !== undefined) service.openDocument('/lib.shade.ts', library);
  service.openDocument(fileName, source);
  const compiler = result.diagnostics.map((d) => `${d.code} ${d.message}`);
  const entryDiagnostics = service.getDiagnostics(fileName);
  const editor = [
    ...(library === undefined ? [] : service.getDiagnostics('/lib.shade.ts')),
    ...entryDiagnostics,
  ];
  expect(editor.map((d) => `${d.code} ${d.message}`)).toEqual(compiler);
  expect(
    editor.map((d) => ({ fileName: d.uri, start: d.span.start, length: d.span.length })),
  ).toEqual(
    result.diagnostics.map((d) => ({ fileName: d.fileName, start: d.start, length: d.length })),
  );
  return { result, compiler, entryDiagnostics };
}

const forms = [
  ['class', (t: string) => `class Out { pos: builtin<"position", ${t}>; }`, 'Out'],
  ['interface', (t: string) => `interface Out { pos: builtin<"position", ${t}>; }`, 'Out'],
  ['object alias', (t: string) => `type Out = { pos: builtin<"position", ${t}> };`, 'Out'],
  [
    'named alias',
    (t: string) => `class Record { pos: builtin<"position", ${t}>; } type Out = Record;`,
    'Out',
  ],
  [
    'inherited class',
    (t: string) => `class Base { pos: builtin<"position", ${t}>; } class Out extends Base {}`,
    'Out',
  ],
  ['generic class', (_t: string) => 'class Out<T> { pos: builtin<"position", T>; }', 'Out<T>'],
] as const;

function entries(type: string, value: string): string {
  return `
@vertex export function vs(): ${type} { return { pos: ${value}(0.) }; }
@fragment export function fs(v: ${type}): vec4 { return vec4(v.pos.xyz, 1.); }`;
}

describe('a builtin type error belongs to the field declaration', () => {
  for (const [name, declaration, entryType] of forms) {
    it(`refuses a wrong position type once through a ${name}, shared by two entries`, () => {
      const source = `"use typeshade";\n${declaration('vec3')}${entries(entryType.replace('T', 'vec3'), 'vec3')}`;
      const { result, compiler } = both(source);
      expect(compiler).toEqual(['TS8003 Builtin "position" is "vec4"; this declares it "vec3".']);
      expect(result.diagnostics[0]!.start).toBe(source.indexOf('"position"'));
      expect(result.wgsl).toBeUndefined();
    });

    it(`accepts the vec4 neighbour through a ${name} on both shader targets`, () => {
      const source = `"use typeshade";\n${declaration('vec4')}${entries(entryType.replace('T', 'vec4'), 'vec4')}`;
      const { result, compiler } = both(source);
      expect(compiler).toEqual([]);
      expect(result.wgsl).toContain('@builtin(position) pos: vec4<f32>');
      expect(result.glsl?.vertex).toBeDefined();
      expect(result.glsl?.fragment).toBeDefined();
    });
  }

  it('reports an imported class field once at its declaration', () => {
    const library = '"use typeshade"; export class Out { pos: builtin<"position", vec3>; }';
    const source = `"use typeshade"; import { Out } from "./lib.shade.js";${entries('Out', 'vec3')}`;
    const { result, compiler, entryDiagnostics } = both(source, library);
    expect(compiler).toEqual(['TS8003 Builtin "position" is "vec4"; this declares it "vec3".']);
    expect(entryDiagnostics).toEqual([]);
    expect(result.diagnostics[0]!.fileName).toBe('/lib.shade.ts');
    expect(result.diagnostics[0]!.start).toBe(library.indexOf('"position"'));
  });

  it('still checks a field that no entry uses', () => {
    const { compiler } = both('"use typeshade"; class Out { pos: builtin<"position", vec3>; }');
    expect(compiler).toEqual(['TS8003 Builtin "position" is "vec4"; this declares it "vec3".']);
  });

  it('still checks a directly attributed entry parameter', () => {
    const { compiler } = both(`"use typeshade";
@vertex export function vs(i: builtin<"vertex_index", f32>): vec4 { return vec4(i); }`);
    expect(compiler).toEqual(['TS8003 Builtin "vertex_index" is "u32"; this declares it "f32".']);
  });

  it('keeps the stage check when a correctly typed field is used in the wrong entry', () => {
    const { compiler } = both(`"use typeshade";
interface Input { i: builtin<"vertex_index", u32>; }
@fragment export function fs(v: Input): vec4 { return vec4(f32(v.i)); }`);
    expect(compiler).toEqual([
      'TS8025 Builtin "vertex_index" is not a valid fragment input; it is a vertex input.',
    ]);
  });
});
