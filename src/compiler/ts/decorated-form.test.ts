// The migration release of change 0111 (decision D5, Amendment 2, milestone 4). Each decorator of
// the decorated form on a parameter or a field still compiles as the attribute type it stands
// for, and warns once (`TS8028`), naming the new spelling and the codemod. Both halves give the
// same warning (Rule 12.7). A stage attribute on a function declaration is no decorated form: it
// is the entry's form (change 0130), with no warning, and the editor drops TypeScript's TS1206 on
// it in every file. The editor drops TS1206 on a parameter's decorator only while `compile()`
// warns on it, and never reports TS2564 (`strictPropertyInitialization: false`, change 0130 D3).
// A parameter qualifier, `@inout` or `@out`, is no decorated form either: it is the language's
// form (Rule 8.25, change 0137), which neither half warns on and the editor's TS1206 filter keeps
// in every file.
//
// Verifies: Rule 1.7, Rule 6.6, Rule 6.7 (docs/language-design.md; traced in reqs/).

import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { decoratedForms, usesDecoratedForm } from './decorated-form.js';
import { migrateSource } from '../../cli/migrate.js';
import {
  analyzeSourceFile,
  createTypeshadeLanguageService,
  createTypeshadeLanguageServiceWith,
} from '../../language-service/service.js';
import { SHADE_DTS } from '../../language-service/ambient.js';

/** The compiler's diagnostics as `category code message`. */
const compiled = (source: string): string[] =>
  compile(source).diagnostics.map((d) => `${d.category} ${d.code} ${d.message}`);

/** The editor's diagnostics on the same source, in the same form. */
const edited = (source: string): string[] => {
  const service = createTypeshadeLanguageService();
  service.openDocument('a.shade.ts', source);
  return service
    .getDiagnostics('a.shade.ts')
    .map((d) => `${d.severity} ${String(d.code)} ${d.message}`);
};

const MIGRATE = 'or run "tshc migrate" (change 0111).';
const warns = (written: string, write: string): string =>
  `warning TS8028 "${written}" is the decorated form, which the next release refuses: ${write}, ${MIGRATE}`;

const DECORATED = `"use typeshade";
declare const xs: storage<array<f32>, "read_write">;
class VsOut {
  @builtin("position") @invariant pos: vec4;
  @location(0) uv: vec2;
  @location(1) @interpolate("flat") id: u32;
}
@vertex
export function vs(@builtin("vertex_index") i: u32): VsOut {
  return { pos: vec4(0., 0., 0., 1.), uv: vec2(0., 0.), id: i };
}
function bump(@inout v: f32): void { v += 1.; }
function put(@out v: f32): void { v = 2.; }
@fragment
@diagnostic("off", "derivative_uniformity")
export function fs(v: VsOut): vec4 {
  let a = v.uv.x;
  bump(a);
  let b: f32;
  put(b);
  return vec4(a, b, f32(v.id), 1.);
}
@compute([8, 8])
export function main(@builtin("global_invocation_id") gid: vec3u): void { xs[gid.x] = 1.; }
@compute
function plain(): void {}
@workgroup_size([128])
export function scale(ys: array<f32>, k: f32): void {
  for (let i = 0; i < ys.length; i++) { ys[i] = ys[i] * k; }
}
`;

/** The filter `DECORATED` still writes: change 0132 removed it, with no warning release. */
const FILTER = '@diagnostic("off", "derivative_uniformity")\n';

/** The warning on each decorator of `DECORATED` on a parameter or a field, in source order, and
 *  the one refusal: the filter, which change 0132 removed, warned here until it was refused. A
 *  stage attribute (change 0130) and a qualifier (change 0137) are the language's forms and have
 *  none. */
const WARNINGS = [
  warns('@builtin("position")', 'write "pos: builtin<"position", { invariant: true }>"'),
  warns('@invariant', 'write "pos: builtin<"position", { invariant: true }>"'),
  warns('@location(0)', 'write "uv: location<0, vec2>"'),
  warns('@location(1)', 'write "id: location<1, u32, { interpolate: "flat" }>"'),
  warns('@interpolate("flat")', 'write "id: location<1, u32, { interpolate: "flat" }>"'),
  warns('@builtin("vertex_index")', 'write "i: builtin<"vertex_index">"'),
  'error TS8028 "@diagnostic(…)" is not a decorator the compiler reads (Rule 6.7). Delete it: ' +
    'the compiler rewrites each implicit-LOD sample or derivative it can reach (Rule 8.5) and ' +
    'reports each other one with TS8052 and the reason. "tshc migrate" deletes it.',
  warns('@builtin("global_invocation_id")', 'write "gid: builtin<"global_invocation_id">"'),
];

describe('the decorated form warns once on each decorator, in both halves (TS8028)', () => {
  it('names the attribute type or its option to write, and nothing on a stage or a qualifier', () => {
    expect(compiled(DECORATED)).toEqual(WARNINGS);
    expect(edited(DECORATED)).toEqual(WARNINGS);
  });

  it('gives one warning for each decorator but a stage or a qualifier, and still compiles as the new form does', () => {
    const count = DECORATED.match(/@\w+/g)!.filter(
      (d) => !/^@(vertex|fragment|compute|workgroup_size|inout|out)$/.test(d),
    ).length;
    expect(WARNINGS).toHaveLength(count);
    // The migration deletes the filter (change 0132), so the new form is the decorated one
    // without it.
    const migrated = migrateSource(DECORATED);
    expect(migrated.skipped).toEqual([]);
    expect(migrated.text).not.toContain('diagnostic');
    expect(DECORATED).toContain(FILTER);
    const a = compile(DECORATED.replace(FILTER, ''));
    const b = compile(migrated.text);
    expect(b.diagnostics).toEqual([]);
    expect(a.wgsl).toBe(b.wgsl);
    expect(JSON.stringify(a.glsl)).toBe(JSON.stringify(b.glsl));
  });

  it('names a blend source as the option of its location', () => {
    // A dual-source pair derives a capability GLSL ES 3.00 lacks, so its module also says so
    // (TS8015); the warnings are the subject here.
    const source = `"use typeshade";
class Out {
  @location(0) @blend_src(0) a: vec4;
  @location(0) @blend_src(1) b: vec4;
}
@fragment export function fs(): Out { return { a: vec4(1.), b: vec4(0.) }; }
`;
    const said = [
      warns('@location(0)', 'write "a: location<0, vec4, { blend_src: 0 }>"'),
      warns('@blend_src(0)', 'write "a: location<0, vec4, { blend_src: 0 }>"'),
      warns('@location(0)', 'write "b: location<0, vec4, { blend_src: 1 }>"'),
      warns('@blend_src(1)', 'write "b: location<0, vec4, { blend_src: 1 }>"'),
    ];
    const ofTs8028 = (rows: string[]) => rows.filter((r) => r.startsWith('warning TS8028'));
    expect(ofTs8028(compiled(source))).toEqual(said);
    expect(ofTs8028(edited(source))).toEqual(said);
  });

  it('says nothing of the type form, whose decorators no one wrote', () => {
    const migrated = migrateSource(DECORATED).text;
    expect(
      decoratedForms(ts.createSourceFile('a.ts', migrated, ts.ScriptTarget.Latest, true)),
    ).toEqual([]);
    expect(compiled(migrated)).toEqual([]);
    expect(edited(migrated)).toEqual([]);
  });

  it('keeps a refusal of where a decorator is written alone, with no warning beside it', () => {
    // `@location` on a helper's parameter is read nowhere, and refused (Rule 12.4).
    const source = `"use typeshade";
function h(@location(0) x: f32): f32 { return x; }
@fragment export function fs(): vec4 { return vec4(h(1.)); }
`;
    const said = [
      'error TS8028 "@location" does not apply to a parameter of a function that is not an entry: it marks an entry\'s input or output. Remove it.',
    ];
    expect(compiled(source)).toEqual(said);
    expect(edited(source)).toEqual(said);
  });
});

/** TypeScript's own view of a program in the editor: the two halves unmerged, its codes. */
const unmerged = createTypeshadeLanguageServiceWith({}, analyzeSourceFile, { merge: false });
let opened = 0;
const typescriptCodes = (source: string): number[] => {
  const uri = `/decorated/${opened++}.shade.ts`;
  unmerged.openDocument(uri, source);
  const codes = unmerged
    .getDiagnostics(uri)
    .filter((d) => d.source === 'typescript')
    .map((d) => Number(d.code));
  unmerged.closeDocument(uri);
  return codes;
};

/** What a plain `tsc --strict` says of `source` beside the published ambient library: its codes. */
function plainTscCodes(source: string): number[] {
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
    .map((d) => d.code);
}

describe("the editor's TS1206 filter, and no TS2564 (change 0130)", () => {
  // A struct class with a field and no initializer: TS2564 under a plain `--strict`.
  const STRUCT = 'class S { a: f32; }\ndeclare const u: uniform<S>;\n';
  const ATTRIBUTE = `"use typeshade";
${STRUCT}@fragment
export function fs(): vec4 { return vec4(u.a); }
`;

  it('reports no TS2564: a field needs no initializer and no "!" (D3)', () => {
    // A plain tsc --strict reports it, beside its TS1206 on the stage attribute; the TypeShade
    // program sets strictPropertyInitialization to false, so neither TypeScript's half nor the
    // merged list does.
    expect(plainTscCodes(ATTRIBUTE)).toContain(2564);
    expect(typescriptCodes(ATTRIBUTE)).toEqual([]);
    expect(compile(ATTRIBUTE).diagnostics).toEqual([]);
    expect(edited(ATTRIBUTE)).toEqual([]);
    // A written "!" is accepted and changes nothing.
    expect(edited(ATTRIBUTE.replace('a: f32', 'a!: f32'))).toEqual([]);
    expect(compile(ATTRIBUTE.replace('a: f32', 'a!: f32')).diagnostics).toEqual([]);
  });

  it('drops TS1206 on a stage attribute in every file, with no warning in either half', () => {
    expect(
      usesDecoratedForm(ts.createSourceFile('a.ts', ATTRIBUTE, ts.ScriptTarget.Latest, true)),
    ).toBe(false);
    expect(plainTscCodes(ATTRIBUTE).sort()).toEqual([1206, 2564]);
    expect(typescriptCodes(ATTRIBUTE)).toEqual([]);
    expect(compiled(ATTRIBUTE)).toEqual([]);
    expect(edited(ATTRIBUTE)).toEqual([]);
  });

  it("drops TS1206 on a parameter's decorator only while compile() warns on it", () => {
    const source = `"use typeshade";
@fragment
export function fs(@builtin("position") p: vec4): vec4 { return p; }
`;
    const said = [warns('@builtin("position")', 'write "p: builtin<"position">"')];
    expect(typescriptCodes(source)).toEqual([]);
    expect(compiled(source)).toEqual(said);
    expect(edited(source)).toEqual(said);
  });

  it('keeps TS1206 out of a parameter qualifier in a file in the new form (change 0137)', () => {
    const source = `"use typeshade";
function bump(@inout v: f32): void { v += 1.; }
@fragment
export function fs(): vec4 { let a: f32 = 0.; bump(a); return vec4(a); }
`;
    expect(
      usesDecoratedForm(ts.createSourceFile('a.ts', source, ts.ScriptTarget.Latest, true)),
    ).toBe(false);
    expect(plainTscCodes(source)).toEqual([1206, 1206]);
    expect(typescriptCodes(source)).toEqual([]);
    expect(compiled(source)).toEqual([]);
    expect(edited(source)).toEqual([]);
  });

  it('keeps TS1206 on a decorator that is no attribute, under the refusal of the compiler', () => {
    // `@bogus` is no attribute: the compiler refuses it, and the merged list keeps its sentence
    // alone (Rule 12.4); TypeScript's own half says TS1206, as a plain tsc --strict does.
    const source = `"use typeshade";
@bogus
function h(): f32 { return 1.; }
@fragment
export function fs(): vec4 { return vec4(h()); }
`;
    expect(typescriptCodes(source)).toEqual([1206]);
    expect(plainTscCodes(source)).toContain(1206);
    expect(edited(source).map((d) => d.split(' ').slice(0, 2).join(' '))).toEqual(['error TS8028']);
  });
});
