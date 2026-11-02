// The attribute types of change 0111 (decision D2, D4, D8, amendment 1): an entry input's or
// output's attribute, and a parameter's qualifier, written in its type, `builtin<'position',
// vec4>`, `location<0, vec2>`, `inout<f32>`, `out<f32>`. Each program is read by both halves,
// the emit of each pair is the decorated form's byte for byte, and the program the proposal
// promises, with no decorator at all, type-checks under a plain `tsc --strict` against the
// published ambient library.
//
// Verifies: Rule 6.6, Rule 6.7, Rule 7.2, Rule 7.6, Rule 8.2, Rule 8.25 (docs/language-design.md; traced in reqs/).

import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';
import { SHADE_DTS } from '../../language-service/ambient.js';
import { isDecoratedFormWarning } from '../../core/testing/decorated-form.js';

const compiled = (source: string) => compile(source, { fileName: 'file:///a.shade.ts' });
const editor = (source: string): string[] => {
  const service = createTypeshadeLanguageService();
  service.openDocument('a.ts', source);
  return service.getDiagnostics('a.ts').map((d) => `${String(d.code)} ${String(d.message)}`);
};

/** What a plain `tsc --strict` says of `source` beside the published ambient library, with no
 *  TypeScript library and no diagnostic filter: the configuration change 0111 promises. */
function plainTsc(source: string): string[] {
  const files: Record<string, string> = { 'a.ts': source, 'shade.d.ts': SHADE_DTS };
  const options: ts.CompilerOptions = {
    strict: true,
    noLib: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    types: [],
  };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (name, version) =>
    files[name] === undefined ? undefined : ts.createSourceFile(name, files[name]!, version, true);
  host.fileExists = (name) => files[name] !== undefined;
  host.readFile = (name) => files[name];
  const program = ts.createProgram(Object.keys(files), options, host);
  return ts
    .getPreEmitDiagnostics(program)
    .filter((d) => d.file?.fileName === 'a.ts')
    .map((d) => `TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
}

const DECORATED = `"use typeshade";
class VsOut {
  @builtin("position") @invariant pos: vec4;
  @location(0) uv: vec2;
  @location(1) @interpolate("flat") id: u32;
}
@vertex
export function vs(@builtin("vertex_index") i: u32): VsOut {
  let x = -0.8;
  if (i === 1) { x = 0.8; }
  return { pos: vec4(x, -0.8, 0., 1.), uv: vec2(x, 0.), id: i };
}
function bump(@inout v: f32): void { v += 1.; }
function put(@out v: f32): void { v = 2.; }
@fragment
export function fs(v: VsOut): vec4 {
  let a = v.uv.x;
  bump(a);
  let b: f32;
  put(b);
  return vec4(a, b, f32(v.id), 1.);
}
`;

type Struct = 'class' | 'interface' | 'type';
// A class's field takes "!", which a plain `tsc --strict` reads as assigned (TS2564).
const TYPED = (struct: Struct, bang = struct === 'class' ? '!' : ''): string => `"use typeshade";
${struct === 'type' ? 'type VsOut = {' : `${struct} VsOut {`}
  pos${bang}: builtin<"position", vec4, { invariant: true }>;
  uv${bang}: location<0, vec2>;
  id${bang}: location<1, u32, { interpolate: "flat" }>;
}
export const vs = vertex(function vs(i: builtin<"vertex_index", u32>): VsOut {
  let x = -0.8;
  if (i === 1) { x = 0.8; }
  return { pos: vec4(x, -0.8, 0., 1.), uv: vec2(x, 0.), id: i };
});
function bump(v: inout<f32>): void { v += 1.; }
function put(v: out<f32>): void { v = 2.; }
export const fs = fragment(function fs(v: VsOut): vec4 {
  let a = v.uv.x;
  bump(a);
  let b!: f32;
  put(b);
  return vec4(a, b, f32(v.id), 1.);
});
`;

describe('an attribute type compiles as the decorator it stands for (change 0111, D2, D4)', () => {
  for (const struct of ['class', 'interface', 'type'] as const) {
    it(`entry IO declared as a ${struct}: the same WGSL and GLSL ES 3.00, and no diagnostic`, () => {
      const a = compiled(DECORATED);
      const b = compiled(TYPED(struct));
      // The decorated form warns once on each of its decorators (TS8028, change 0111,
      // milestone 4), and says nothing else.
      expect(a.diagnostics.filter((d) => !isDecoratedFormWarning(d))).toEqual([]);
      expect(a.diagnostics).toHaveLength(DECORATED.match(/@\w+/g)!.length);
      expect(b.diagnostics).toEqual([]);
      expect(b.wgsl).toBe(a.wgsl);
      expect(JSON.stringify(b.glsl)).toBe(JSON.stringify(a.glsl));
    });

    it(`entry IO declared as a ${struct}: the editor reports nothing`, () => {
      expect(editor(TYPED(struct))).toEqual([]);
    });
  }

  it('a builtin id the attribute type names is checked as the decorator one is', () => {
    const codes = (source: string): string[] =>
      compiled(source)
        .diagnostics.filter((d) => d.category === 'error')
        .map((d) => String(d.code));
    const typed = codes(TYPED('interface').replace('"vertex_index"', '"vertex_idx"'));
    expect(typed).not.toEqual([]);
    expect(typed).toEqual(codes(DECORATED.replace('"vertex_index"', '"vertex_idx"')));
  });

  it('a read of an out<T> local before the call fills it is TS8075, as with @out', () => {
    const source = TYPED('interface').replace(
      'let b!: f32;\n  put(b);',
      'let b!: f32;\n  a += b;\n  put(b);',
    );
    expect(compiled(source).diagnostics.map((d) => d.code)).toContain('TS8075');
  });
});

describe('the program change 0111 promises type-checks under a plain tsc --strict', () => {
  it('the typed form: no diagnostic, with no TypeScript library and no filter', () => {
    expect(plainTsc(TYPED('interface').replace('"use typeshade";\n', ''))).toEqual([]);
  });

  it('the decorated form: TS1206 on each decorator of a function or a parameter, TS2564 on each field', () => {
    const codes = plainTsc(DECORATED.replace('"use typeshade";\n', '')).map((d) => d.split(' ')[0]);
    expect(codes).toContain('TS1206');
    expect(codes).toContain('TS2564');
  });
});
