import { describe, expect, it } from 'vitest';
import { compileTsSource } from './source-file.js';
import { compileModule } from '../../core/oracle.js';
import { compileModuleJs } from '../../core/cpu-codegen.js';
import { compile } from './compile.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

// Verifies: Rule 11.9 (a console call delivers its event to the host's sink on the CPU).
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
  console.count();
}`);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.message).toBe(
      'console.count() is not supported in TypeShade yet. Use log, info, debug, warn, error, or table.',
    );
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

// Verifies: Rule 11.9 (console.table takes one value, and a matrix is delivered as its columns;
// changes/0019).
describe('console.table shows one value as a table (surface §66)', () => {
  const src = (body: string): string => `"use typeshade";
class P {
  pos: vec2;
  speed: f32;
}
export function main(x: f32): void {
  const ps: array<P, 2> = [{ pos: vec2(x, 2.), speed: 3. }, { pos: vec2(4., 5.), speed: x }];
  const m = mat3x2(1., 2., 3., 4., 5., x);
  ${body}
}`;
  const editor = (body: string): string[] => {
    const service = createTypeshadeLanguageService();
    service.openDocument('a.ts', src(body));
    return service.getDiagnostics('a.ts').map((d) => `${String(d.code)} ${String(d.message)}`);
  };
  /** The events of one run, on the interpreter (`eval`) and on the generated code, which must
   *  agree. */
  const events = (body: string): unknown[] => {
    const out: unknown[] = [];
    const r = compile(src(body), {
      consoleSink: (e) => out.push({ method: e.method, args: e.args }),
    });
    expect(r.diagnostics).toEqual([]);
    r.eval('main', [1.5]);
    const js: unknown[] = [];
    compileModuleJs(r.module, {
      consoleSink: (e) => js.push({ method: e.method, args: e.args }),
    }).fns.main!(1.5);
    expect(js).toEqual(out);
    return out;
  };

  it('delivers an array of structs as it is, and a matrix as its columns', () => {
    expect(events('console.table(ps);')).toEqual([
      {
        method: 'table',
        args: [
          [
            { pos: [1.5, 2], speed: 3 },
            { pos: [4, 5], speed: 1.5 },
          ],
        ],
      },
    ]);
    // Three columns of two rows, as WGSL indexes it (m[j] is column j).
    expect(events('console.table(m);')).toEqual([
      {
        method: 'table',
        args: [
          [
            [1, 2],
            [3, 4],
            [5, 1.5],
          ],
        ],
      },
    ]);
    // console.log keeps the flat, column-major form.
    expect(events('console.log(m);')).toEqual([{ method: 'log', args: [[1, 2, 3, 4, 5, 1.5]] }]);
    expect(events('console.table(x);')).toEqual([{ method: 'table', args: [1.5] }]);
  });

  it('draws no error in either half for one value', () => {
    for (const body of ['console.table(ps);', 'console.table(m);', 'console.table(x);']) {
      expect(compile(src(body)).diagnostics, body).toEqual([]);
      expect(editor(body), body).toEqual([]);
    }
  });

  it('refuses the columns argument once, with the remedy, in both halves', () => {
    const body = 'console.table(ps, ["pos"]);';
    expect(compile(src(body)).diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([
      'TS8099 console.table() takes one value, the data to show. Select the columns in the ' +
        'shader, into a smaller struct, or filter the table on the host.',
    ]);
    expect(editor(body).some((m) => m.startsWith('TS8099 console.table() takes one value'))).toBe(
      true,
    );
  });

  it('refuses a table of text, or of nothing, and points at console.log', () => {
    for (const body of ['console.table("ps");', 'console.table();']) {
      expect(
        compile(src(body)).diagnostics.map((d) => `${d.code} ${d.message}`),
        body,
      ).toEqual([
        'TS8099 console.table() takes one value, the data to show: an array, a struct, a ' +
          'vector, a matrix or a scalar. Text goes in a console.log() beside it.',
      ]);
      expect(
        editor(body).some((m) => m.startsWith('TS8099 console.table()')),
        body,
      ).toBe(true);
    }
  });

  it('completes exactly the six methods after console., as the compiler accepts them', () => {
    const text = src('console.');
    const service = createTypeshadeLanguageService();
    service.openDocument('a.ts', text);
    const lines = text.split('\n');
    const line = lines.findIndex((l) => l.trim() === 'console.');
    const items = service.getCompletions('a.ts', {
      line,
      character: lines[line]!.indexOf('console.') + 'console.'.length,
    });
    expect(items.map((i) => i.label).sort()).toEqual(
      ['debug', 'error', 'info', 'log', 'table', 'warn'].sort(),
    );
  });
});
