// Verifies: Rule 12.4, Rule 12.5, Rule 12.7 (docs/language-design.md; traced in reqs/).
import { describe, expect, it } from 'vitest';
import { compile } from '../compiler/ts/compile.js';
import { analyzeSourceFile, createTypeshadeLanguageServiceWith } from './service.js';

const URI = '/loop-control.shade.ts';
const BREAK = 'break is only valid inside a loop or switch.';
const CONTINUE = 'continue is only valid inside a loop.';
const shader = (body: string): string => `"use typeshade";\n${body}`;

function both(source: string, merge = true) {
  const service = createTypeshadeLanguageServiceWith({}, analyzeSourceFile, { merge });
  service.openDocument(URI, source);
  try {
    return { compiler: compile(source, { fileName: URI }), editor: service.getDiagnostics(URI) };
  } finally {
    service.closeDocument(URI);
  }
}

describe('misplaced loop control has one diagnostic (#321 control#21 and control#28)', () => {
  it.each([
    ['break in a function', 'export function f(): f32 { break; return 1.; }', 'break;', BREAK],
    [
      'continue in a function',
      'export function f(): f32 { continue; return 1.; }',
      'continue;',
      CONTINUE,
    ],
    [
      'conditional break',
      'export function f(x: bool): f32 { if (x) break; return 1.; }',
      'break;',
      BREAK,
    ],
    [
      'conditional continue',
      'export function f(x: bool): f32 { if (x) continue; return 1.; }',
      'continue;',
      CONTINUE,
    ],
    [
      'break across a function boundary',
      'export function f(): f32 { for (let i: i32 = 0; i < 2; i++) { function g(): f32 { break; return 1.; } g(); } return 1.; }',
      'break;',
      BREAK,
    ],
    [
      'continue across a function boundary',
      'export function f(): f32 { for (let i: i32 = 0; i < 2; i++) { function g(): f32 { continue; return 1.; } g(); } return 1.; }',
      'continue;',
      CONTINUE,
    ],
    [
      'continue in a switch without a loop',
      'export function f(i: i32): f32 { switch (i) { case 0: continue; default: return 0.; } return 1.; }',
      'continue;',
      CONTINUE,
    ],
  ])(
    '%s keeps the compiler code, full text and statement span',
    (_name, body, statement, message) => {
      const source = shader(body);
      const { compiler, editor } = both(source);
      const expected = {
        code: 'TS8009',
        message,
        start: source.indexOf(statement),
        length: statement.length,
      };
      expect(
        compiler.diagnostics.map(({ code, message, start, length }) => ({
          code,
          message,
          start,
          length,
        })),
      ).toEqual([expected]);
      expect(editor.map(({ code, message, span }) => ({ code, message, ...span }))).toEqual([
        expected,
      ]);
    },
  );

  it('keeps each of two distinct misplaced statements', () => {
    const source = shader('export function f(): f32 { break; continue; return 1.; }');
    const { compiler, editor } = both(source);
    const expected = [
      { code: 'TS8009', message: BREAK },
      { code: 'TS8009', message: CONTINUE },
    ];
    expect(compiler.diagnostics.map(({ code, message }) => ({ code, message }))).toEqual(expected);
    expect(editor.map(({ code, message }) => ({ code, message }))).toEqual(expected);
    expect(editor.map((d) => d.span.start)).toEqual([
      source.indexOf('break;'),
      source.indexOf('continue;'),
    ]);
  });

  it('keeps an independent unknown name beside the jump', () => {
    const { compiler, editor } = both(
      shader('export function f(): f32 { break; return missing; }'),
    );
    const expected = [
      { code: 'TS8009', message: BREAK },
      { code: 'TS8022', message: 'Unknown identifier "missing".' },
    ];
    expect(compiler.diagnostics.map(({ code, message }) => ({ code, message }))).toEqual(expected);
    expect(editor.map(({ code, message }) => ({ code, message }))).toEqual(expected);
  });

  it('keeps an independent TypeScript constraint error', () => {
    const source = shader(`type HostOnly<N extends "good"> = f32;
class Host<T> { value!: HostOnly<"bad">; }
export function f(): f32 { break; return 1.; }`);
    const { compiler, editor } = both(source);
    expect(compiler.diagnostics.map(({ code, message }) => ({ code, message }))).toEqual([
      { code: 'TS8009', message: BREAK },
    ]);
    expect(editor.map(({ code, message }) => ({ code, message }))).toEqual([
      { code: 2344, message: 'Type \'"bad"\' does not satisfy the constraint \'"good"\'.' },
      { code: 'TS8009', message: BREAK },
    ]);
  });

  it.each(['break', 'continue'])('does not globally filter the TypeScript %s error', (jump) => {
    const { editor } = both(shader(`export function f(): f32 { ${jump}; return 1.; }`), false);
    expect(editor.map((d) => d.code)).toEqual([1107, 'TS8009']);
    expect(editor[0]?.source).toBe('typescript');
  });

  it.each(['break', 'continue'])('keeps the existing top-level %s refusal', (jump) => {
    const source = shader(`${jump};`);
    const { compiler, editor } = both(source);
    const expected = [
      {
        code: 'TS8014',
        message: `A "${jump}" statement at the top level runs nowhere; a shader file declares functions, classes, types, enums, namespaces, constants, module variables and resources.`,
      },
    ];
    expect(compiler.diagnostics.map(({ code, message }) => ({ code, message }))).toEqual(expected);
    expect(editor.map(({ code, message }) => ({ code, message }))).toEqual(expected);
  });

  it.each([
    [
      'loop break and continue',
      'export function f(): f32 { let n: f32 = 0.; for (let i: i32 = 0; i < 4; i++) { if (i === 1) continue; if (i === 3) break; n += 1.; } return n; }',
      2,
    ],
    [
      'switch break',
      'export function f(): f32 { let n: f32 = 0.; switch (i32(1)) { case 1: n = 2.; break; default: n = 3.; } return n; }',
      2,
    ],
    [
      'switch continue enclosed by a loop',
      'export function f(): f32 { let n: f32 = 0.; for (let i: i32 = 0; i < 3; i++) { switch (i) { case 1: continue; default: n += 1.; } } return n; }',
      2,
    ],
  ] as const)('keeps valid %s accepted and executable', (_name, body, expected) => {
    const { compiler, editor } = both(shader(body));
    expect(compiler.diagnostics).toEqual([]);
    expect(editor).toEqual([]);
    expect(compiler.wgsl).toBeDefined();
    expect(compiler.eval('f')).toBe(expected);
  });
});
