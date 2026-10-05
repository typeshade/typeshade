// Verifies: Rule 7.6, Rule 8.25, Rule 12.7 (docs/language-design.md; traced in reqs/).
//
// A read before an assignment (proposal 0043). The compiler refuses a read of a local before it
// is assigned on every path, by TypeScript's TS2454 rule, and the editor shows the compiler's
// TS8075 in TypeScript's place. The one difference is `@out`: an argument an `@out` parameter
// takes assigns the variable (proposal 0040). Every target starts such a local at zero, GLSL ES
// 3.00 included.
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { compile } from './compile.js';
import { compileModule } from '../../core/oracle.js';
import { compileModuleJs } from '../../core/cpu-codegen.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const FRAGMENT = `class VsOut { @builtin("position") pos: vec4; }
@vertex export function vs(): VsOut { return { pos: vec4(0., 0., 0., 1.) }; }
class Color { @location(0) color: vec4; }
@fragment export function fs(): Color { return { color: vec4(run(), 0., 0., 1.) }; }`;

/** Each place the compiler reports TS8075 in `body`, as `line:column` of the read. */
function compilerReads(body: string): string[] {
  const source = `"use typeshade";\n${body}`;
  const sf = ts.createSourceFile('a.ts', source, ts.ScriptTarget.Latest, true);
  return compile(source)
    .diagnostics.filter((d) => d.code === 'TS8075')
    .map((d) => {
      const at = sf.getLineAndCharacterOfPosition(d.start);
      return `${String(at.line)}:${String(at.character)}`;
    });
}

/** Each place TypeScript itself reports TS2454 in `body`, read with `f32` as `number` and the
 *  library's `bool` as `boolean` and `i32` as `number`, as `line:column`. A `switch` over a
 *  literal type is left out: TypeScript knows such a list of cases is whole, and the walk,
 *  which reads no types, does not (`definite.ts`). */
function typescriptReads(body: string): string[] {
  const source = `"use typeshade";\n${body}\ntype f32 = number; type bool = boolean; type i32 = number;`;
  const host = ts.createCompilerHost({ strict: true, noEmit: true });
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (name, target, ...rest) =>
    name === 'a.ts'
      ? ts.createSourceFile(name, source, target, true)
      : original(name, target, ...rest);
  const program = ts.createProgram(['a.ts'], { strict: true, noEmit: true }, host);
  const sf = program.getSourceFile('a.ts')!;
  return program
    .getSemanticDiagnostics(sf)
    .filter((d) => d.code === 2454)
    .map((d) => {
      const at = sf.getLineAndCharacterOfPosition(d.start ?? 0);
      return `${String(at.line)}:${String(at.character)}`;
    });
}

describe('a read before an assignment is refused as TypeScript refuses it (Rule 7.6)', () => {
  // Each body is a whole function with no `@out` argument, so the compiler's reports and
  // TypeScript's must fall on the same reads.
  const corpus: Record<string, string> = {
    'a read with no assignment': `export function run(c: bool): f32 { let s: f32; return s; }`,
    'an assignment, then a read': `export function run(c: bool): f32 { let s: f32; s = 1.; return s; }`,
    'both branches assign': `export function run(c: bool): f32 { let s: f32; if (c) { s = 1.; } else { s = 2.; } return s; }`,
    'one branch assigns': `export function run(c: bool): f32 { let s: f32; if (c) { s = 1.; } return s; }`,
    'the other branch returns': `export function run(c: bool): f32 { let s: f32; if (c) { s = 1.; } else { return 0.; } return s; }`,
    'a conditional expression assigns on both sides': `export function run(c: bool): f32 { let s: f32; c ? (s = 1.) : (s = 2.); return s; }`,
    'the right of && may not run': `export function run(c: bool): f32 { let s: f32; let t = c && (s = 1.) > 0.; return s; }`,
    'a while body may not run': `export function run(c: bool): f32 { let s: f32; let i = 0.; while (i < 3.) { s = i; i += 1.; } return s; }`,
    'a for body may not run': `export function run(c: bool): f32 { let s: f32; for (let i = 0.; i < 3.; i += 1.) { s = i; } return s; }`,
    'a do body runs once': `export function run(c: bool): f32 { let s: f32; do { s = 1.; } while (c); return s; }`,
    'a break before the assignment': `export function run(c: bool): f32 { let s: f32; do { if (c) { break; } s = 1.; } while (c); return s; }`,
    'a switch with a default': `export function run(c: bool, k: i32): f32 { let s: f32; switch (k) { case 1: s = 1.; break; default: s = 2.; } return s; }`,
    'a switch with no default': `export function run(c: bool, k: i32): f32 { let s: f32; switch (k) { case 1: s = 1.; break; case 2: s = 2.; break; } return s; }`,
    'a compound assignment reads': `export function run(c: bool): f32 { let s: f32; s += 1.; return s; }`,
    'an increment reads': `export function run(c: bool): f32 { let s: f32; s++; return s; }`,
    'a read in a local function is not checked': `export function run(c: bool): f32 { let s: f32; const f = (): f32 => s; s = 1.; return f(); }`,
    'an assignment in a local function does not count': `export function run(c: bool): f32 { let s: f32; const f = (): void => { s = 1.; }; f(); return s; }`,
    'a block shadows the name': `export function run(c: bool): f32 { let s: f32 = 1.; { let s: f32; s = 2.; } return s; }`,
    'a read in the condition': `export function run(c: bool): f32 { let s: f32; if (s > 0.) { return 1.; } return 0.; }`,
    'an assignment in the condition': `export function run(c: bool): f32 { let s: f32; if ((s = 2.) > 1.) { return s; } return s; }`,
    'two reads of one variable': `export function run(c: bool): f32 { let s: f32; return s + s; }`,
  };
  for (const [name, body] of Object.entries(corpus)) {
    it(`agrees with TypeScript's TS2454 on ${name}`, () => {
      expect(compilerReads(body)).toEqual(typescriptReads(body));
    });
  }

  it('says one sentence, and the editor shows the same one in place of TS2454', () => {
    const source = `"use typeshade";\nexport function run(): f32 { let s: f32; return s; }`;
    const said = compile(source).diagnostics.map((d) => `${d.code} ${d.message}`);
    const message =
      'TS8075 "s" is read here before it is assigned on every path. Assign it before this read, ' +
      'or declare it with a value (Rule 7.6).';
    expect(said).toEqual([message]);
    const service = createTypeshadeLanguageService();
    service.openDocument('a.ts', source);
    const editor = service.getDiagnostics('a.ts').map((d) => `${String(d.code)} ${d.message}`);
    expect(editor).toContain(message);
    expect(editor.some((d) => d.startsWith('2454'))).toBe(false);
  });

  it('takes an argument an @out parameter takes as an assignment, which TypeScript cannot', () => {
    const body = `function add(a: f32, b: f32, @out c: f32): void { c = a + b; }
export function run(): f32 { let s: f32; add(1., 2., s); return s; }`;
    expect(compilerReads(body)).toEqual([]);
    const source = `"use typeshade";\n${body}\n${FRAGMENT}`;
    const service = createTypeshadeLanguageService();
    service.openDocument('o.ts', source);
    expect(service.getDiagnostics('o.ts')).toEqual([]);
    const r = compile(source);
    expect(r.diagnostics).toEqual([]);
    expect(compileModule(r.module).fns.run!()).toBe(3);
    expect(compileModuleJs(r.module).fns.run!()).toBe(3);
  });

  it('starts a local with no initializer at zero on GLSL ES 3.00, as on WGSL and the CPU', () => {
    const r = compile(`"use typeshade";
class P { a: f32; b: vec2; }
export function run(): f32 { let s: f32; s = 1.; let q: P; q = new P(); let v: vec3; v = vec3(1.); return s + q.a + v.x; }
${FRAGMENT}`);
    expect(r.diagnostics).toEqual([]);
    const glsl = r.glsl!.fragment;
    expect(glsl).toContain('float s = 0.0;');
    expect(glsl).toContain('P q = P(0.0, vec2(0.0));');
    expect(glsl).toContain('vec3 v = vec3(0.0);');
    expect(r.wgsl).toContain('var s: f32;');
  });
});
