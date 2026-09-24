import { describe, expect, it } from 'vitest';
import { compileTsSource } from './source-file.js';
import { compileModule } from '../../core/oracle.js';
import { compileModuleJs } from '../../core/cpu-codegen.js';
import { compile } from './compile.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

describe('JavaScript Console API in use typeshade', () => {
  it('lowers console.log and preserves a source span', () => {
    const result = compileTsSource(`"use typeshade";
export function main(x: f32): void {
  console.log(x);
}`);
    expect(result.diagnostics).toEqual([]);
    expect(result.funcs[0]!.body[0]!.s).toBe('call');
    const stmt = result.funcs[0]!.body[0]!;
    if (stmt.s !== 'call' || stmt.expr.op !== 'call') throw new Error('expected console call');
    expect(stmt.expr.fn).toBe('console.log');
    expect(stmt.expr.type.kind).toBe('void');
    expect(stmt.expr.span?.file).toBe('typeshade-input.ts');
    expect(stmt.expr.span?.length).toBeGreaterThan(0);
  });

  it('routes CPU execution to the host sink', () => {
    const result = compileTsSource(`"use typeshade";
export function main(x: f32): void {
  console.warn(x);
}`);
    expect(result.diagnostics).toEqual([]);
    const events: unknown[] = [];
    const cpu = compileModule(
      {
        consts: [...result.consts],
        structs: result.structs.map((s) => s.decl),
        bindings: [...result.bindings],
        funcs: [...result.funcs],
        overrides: [...result.overrides],
        vars: [...result.vars],
      },
      { consoleSink: (event) => events.push(event) },
    );
    cpu.fns.main(3);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ method: 'warn', args: [3] });
  });

  it('rejects unsupported console methods without inventing a TypeShade API', () => {
    const result = compileTsSource(`"use typeshade";
export function main(): void {
  console.table();
}`);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.message).toContain('console.table() is not supported');
  });
});

// Verifies: Rule 7.8 (a string literal argument of a console call is a label; changes/0014).
describe('a string literal argument of a console call is a label (surface §66)', () => {
  const src = (body: string): string => `"use typeshade";
class P {
  a: f32;
  b: vec3;
}
export function main(x: f32): void {
  ${body}
}`;
  const events = (body: string): unknown[] => {
    const out: unknown[] = [];
    const r = compile(src(body), {
      consoleSink: (e) => out.push({ method: e.method, args: e.args }),
    });
    expect(r.diagnostics).toEqual([]);
    r.eval('main', [1.5]);
    return out;
  };
  const editor = (body: string): string[] => {
    const service = createTypeshadeLanguageService();
    service.openDocument('a.ts', src(body));
    return service.getDiagnostics('a.ts').map((d) => `${String(d.code)} ${String(d.message)}`);
  };

  it('delivers the labels in the places written, on the interpreter and the generated code', () => {
    const body = `console.warn("x =", x, 'twice', x * 2., \`end\`);`;
    expect(events(body)).toEqual([{ method: 'warn', args: ['x =', 1.5, 'twice', 3, 'end'] }]);
    const r = compileTsSource(src(body));
    const out: unknown[] = [];
    const cpu = compileModuleJs(
      {
        consts: [...r.consts],
        structs: r.structs.map((s) => s.decl),
        bindings: [...r.bindings],
        funcs: [...r.funcs],
        overrides: [...r.overrides],
        vars: [...r.vars],
      },
      { consoleSink: (e) => out.push(e.args) },
    );
    cpu.fns.main!(1.5);
    expect(out).toEqual([['x =', 1.5, 'twice', 3, 'end']]);
  });

  it('keeps a call with no label as it was: no labels field, the values in order', () => {
    const r = compileTsSource(src('console.log(x, x);'));
    const stmt = r.funcs[0]!.body[0]!;
    if (stmt.s !== 'call' || stmt.expr.op !== 'call') throw new Error('expected a call');
    expect(stmt.expr.labels).toBeUndefined();
    expect(events('console.log(x, x);')).toEqual([{ method: 'log', args: [1.5, 1.5] }]);
  });

  it('draws no error in the editor for a label, a struct, an array or a matrix', () => {
    for (const body of [
      'console.log("x =", x);',
      'const p: P = { a: x, b: vec3(1., 2., 3.) };\n  console.log("p", p);',
      'const a: array<f32, 3> = [x, x, x];\n  console.log(a);',
      'console.log(mat2x2(1., 2., 3., 4.));',
    ]) {
      expect(compile(src(body)).diagnostics, body).toEqual([]);
      expect(editor(body), body).toEqual([]);
    }
  });

  it('refuses a template with a value in it once, naming the arguments to write', () => {
    const body = 'console.log(`x = ${x}!`);';
    const d = compile(src(body)).diagnostics;
    expect(d.map((x) => `${x.code} ${x.message}`)).toEqual([
      'TS8013 A template with a value in it builds text at run time, which a shader has no ' +
        'string for. Pass the text and the value as two arguments: console.log("x =", x, "!").',
    ]);
    expect(editor(body).some((m) => m.startsWith('TS8013 A template with a value'))).toBe(true);
  });

  it('still refuses a string that is not a literal', () => {
    const d = compile(src('console.log("x" + "y");')).diagnostics;
    expect(d.length).toBeGreaterThan(0);
    expect(d[0]!.message).toContain('A string has no GPU representation');
  });
});
