import { describe, expect, it } from 'vitest';
import { tree } from './core/testing/move-purity-fixtures.js';
import { checkMove, type MoveReport } from '../scripts/move-purity.js';
import { INERT_CALLS } from '../scripts/move-purity/inert.js';

const keep = 'const Z = 1;\n';

const moveOut = (unit: string): MoveReport =>
  checkMove(tree({ 'src/a.ts': unit + keep }), tree({ 'src/a.ts': keep, 'src/b.ts': unit }));

const kinds = (report: MoveReport): string[] => report.findings.map((f) => f.kind);

describe('inert moves only (P4)', () => {
  const inert: [string, string][] = [
    ['a function', 'function f(): number {\n  return g();\n}\n'],
    ['a type alias', 'type T = { a: number };\n'],
    ['an interface', 'interface I {\n  a: number;\n}\n'],
    ['a declare statement', 'declare const external: number;\n'],
    ['an enum', 'enum E {\n  A,\n  B,\n}\n'],
    ['a literal constant', 'const A = 1;\n'],
    ['a regular expression', 'const R = /a+/g;\n'],
    ['an arrow function', 'const F = (x: number) => compute(x);\n'],
    ['an object of inert parts', "const O = { a: 1, 'b': [1, -2], c: () => 1, d };\n"],
    ['a wrapped constant', 'const W = ({ a: 1 } as const) satisfies object;\n'],
    ['a property chain', 'const P = a.b.c;\n'],
    ['a class with an inert static property', 'class C {\n  static x = 1;\n  y = make();\n}\n'],
    ['a template without substitution', 'const T = `a b`;\n'],
  ];

  it.each(inert)('accepts %s', (_name, unit) => {
    const report = moveOut(unit);
    expect(kinds(report)).toEqual([]);
    expect(report.pure).toBe(true);
  });

  const active: [string, string][] = [
    ['an expression statement', 'register();\n'],
    ['a mock call', "vi.mock('x', () => ({}));\n"],
    ['a constant from a call', 'const V = compute();\n'],
    ['a conditional', 'if (a) {\n  b();\n}\n'],
    ['a loop', 'for (;;) {\n  break;\n}\n'],
    ['an await', 'await load();\n'],
    ['a template with a substitution', 'const T = `a${b}`;\n'],
    ['a call in an object', 'const O = { a: make() };\n'],
    ['a spread of a call', 'const O = { ...make() };\n'],
    ['a class with a static block', 'class C {\n  static {\n    init();\n  }\n}\n'],
    ['a class with a static property from a call', 'class C {\n  static x = make();\n}\n'],
    ['a class that extends a call', 'class C extends mix(B) {}\n'],
    ['a decorated class', '@dec\nclass C {}\n'],
    ['a namespace', 'namespace N {\n  run();\n}\n'],
    ['a call that is not on the list', 'const V = Object.assign({}, a);\n'],
    ['a binary expression', 'const V = a + b;\n'],
  ];

  it.each(active)('refuses %s', (_name, unit) => {
    const report = moveOut(unit);
    expect(kinds(report)).toEqual(['active unit moved']);
    expect(report.findings[0]?.detail).not.toBe('');
  });

  it('accepts an active unit that stays where it is', () => {
    const unit = 'register();\n';
    const report = checkMove(
      tree({ 'src/a.ts': unit + keep }),
      tree({ 'src/a.ts': unit + keep + '\n' }),
    );
    expect(report.pure).toBe(true);
  });

  const snippets: Record<string, (argument: string) => string> = {
    'Object.freeze': (a) => `const V = Object.freeze({ a: ${a} });\n`,
    'new Map': (a) => `const V = new Map([[1, ${a}]]);\n`,
    'new Set': (a) => `const V = new Set([${a}]);\n`,
    'new WeakMap': (a) => `const V = new WeakMap([[{}, ${a}]]);\n`,
    'new WeakSet': (a) => `const V = new WeakSet([${a}]);\n`,
    Symbol: (a) => `const V = Symbol(${a});\n`,
    'Symbol.for': (a) => `const V = Symbol.for(${a});\n`,
  };

  it('has one snippet for each entry of the allow-list', () => {
    expect(Object.keys(snippets).sort()).toEqual([...INERT_CALLS].sort());
  });

  it.each(INERT_CALLS)('accepts %s with inert arguments and refuses it with a call', (entry) => {
    const snippet = snippets[entry]!;
    expect(kinds(moveOut(snippet("'a'")))).toEqual([]);
    expect(kinds(moveOut(snippet('make()')))).toEqual(['active unit moved']);
  });
});
