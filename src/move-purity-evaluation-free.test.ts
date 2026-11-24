import { describe, expect, it } from 'vitest';
import { tree } from './core/testing/move-purity-fixtures.js';
import { checkMove, type MoveReport } from '../scripts/move-purity.js';
import { EVALUATION_FREE_CALLS } from '../scripts/move-purity/evaluation-free.js';

const keep = 'const Z = 1;\n';
const library = {
  'src/e.ts':
    'export enum SOME_ENUM {\n  A,\n  B,\n}\nexport const shared = { a: 1 };\nexport const FROZEN = Object.freeze({ a: 1 });\nexport class Base {}\nexport function helper(): number {\n  return 1;\n}\n',
};
const imports =
  "import { SOME_ENUM, shared, FROZEN, Base, helper } from './e.js';\nimport * as ns from './e.js';\n";

const moveOut = (unit: string): MoveReport =>
  checkMove(
    tree({ ...library, 'src/a.ts': imports + unit + keep }),
    tree({ ...library, 'src/a.ts': imports + keep, 'src/b.ts': imports + unit }),
  );

const refusals = (report: MoveReport): string[] =>
  report.findings.filter((f) => f.kind === 'not a clean file path').map((f) => f.detail);

describe('evaluation-free moves only (P4)', () => {
  const free: [string, string][] = [
    ['a function', 'function f(): number {\n  return g();\n}\n'],
    ['a type alias', 'type T = { a: number };\n'],
    ['an interface', 'interface I {\n  a: number;\n}\n'],
    ['a declare const', 'declare const external: number;\n'],
    ['a declare function', 'declare function external(): number;\n'],
    [
      'an enum with literals and members',
      'enum E {\n  A,\n  B = 1 << 2,\n  C = A | B,\n  D = SOME_ENUM.A,\n}\n',
    ],
    ['a literal constant', 'const A = 1;\n'],
    ['a regular expression', 'const R = /a+/g;\n'],
    ['an arrow function', 'const F = (x: number) => compute(x);\n'],
    [
      'an object of free parts',
      "const O = { a: 1, 'b': [1, -2], c: () => 1, get d() { return 1; }, e: helper };\n",
    ],
    ['a wrapped constant', 'const W = ({ a: 1 } as const) satisfies object;\n'],
    ['a template with free substitutions', 'const T = `a${1}b${A_NUMBER}`;\n'],
    ['operators over literals', 'const V = (1 + 2) * 3 > 4 ? "a" : void 0;\n'],
    ['a class with a literal static property', 'class C {\n  static x = 1;\n  y = make();\n}\n'],
    ['a class that extends an imported class', 'class C extends Base {}\n'],
    ['an enum member read', 'const S = SOME_ENUM.A;\n'],
    ['a frozen literal', 'const F = Object.freeze({ a: 1, b: [1, 2] });\n'],
    ['a reference to a function and to a mutable object', 'const R = [helper, shared];\n'],
    ['a member of a namespace import', 'const R = ns.helper;\n'],
  ];

  it.each(free)('accepts %s', (_name, unit) => {
    const body = unit.includes('A_NUMBER') ? 'const A_NUMBER = 1;\n' + unit : unit;
    const report = moveOut(body);
    expect(refusals(report)).toEqual([]);
  });

  it('accepts moving declared ambient functions and constants with no finding at all', () => {
    expect(moveOut('declare function external(): number;\n').findings).toEqual([]);
    expect(moveOut('declare const external: number;\n').findings).toEqual([]);
    expect(moveOut('const S = SOME_ENUM.A;\n').pure).toBe(true);
  });

  const active: [string, string][] = [
    ['an expression statement', 'register();\n'],
    ['a mock call', "vi.mock('x', () => ({}));\n"],
    ['a constant from a call', 'const V = compute();\n'],
    ['a conditional', 'if (a) {\n  b();\n}\n'],
    ['a loop', 'for (;;) {\n  break;\n}\n'],
    ['an await', 'await load();\n'],
    ['a template with a call', 'const T = `a${make()}`;\n'],
    ['a template that coerces an object', 'const T = `${shared}`;\n'],
    ['an operator over an object', 'const T = shared + 1;\n'],
    ['a comma expression before a namespace member', 'const T = (effect(), ns).helper;\n'],
    ['an element access', "const T = shared['a'];\n"],
    ['a computed key from an object', 'const T = { [shared]: 1 };\n'],
    ['a typeof of a function', 'const T = typeof helper;\n'],
    ['a call in an object', 'const O = { a: make() };\n'],
    ['a spread in an object', 'const O = { ...shared };\n'],
    ['a spread in an array', 'const O = [...[1]];\n'],
    ['a let', 'let V = 1;\n'],
    ['a destructuring constant', 'const { a } = shared;\n'],
    ['a read through a mutable object', 'const V = shared.a;\n'],
    ['a read of a frozen primitive object', 'const R = FROZEN.a + 1;\n'],
    ['a read of an object constant by a template', 'const R = `${FROZEN.a}`;\n'],
    ['a coercion of a frozen object', 'const R = `${FROZEN}`;\n'],
    ['a read of an enum member through an object', 'const R = shared[SOME_ENUM.A];\n'],
    ['an unresolved name', 'const V = unknownName;\n'],
    ['an enum with a call initializer', 'enum E {\n  A = make(),\n}\n'],
    ['Object.freeze of an identifier', 'const V = Object.freeze(shared);\n'],
    ['new Map of an identifier', 'const V = new Map(shared);\n'],
    ['an assignment operator', 'const V = (a += 1);\n'],
    ['instanceof', 'const V = shared instanceof Base;\n'],
    ['a class with a static block', 'class C {\n  static {\n    init();\n  }\n}\n'],
    ['a class with a static property from a call', 'class C {\n  static x = make();\n}\n'],
    ['a class that extends a call', 'class C extends mix(Base) {}\n'],
    ['a decorated class', '@dec\nclass C {}\n'],
    ['a namespace', 'namespace N {\n  run();\n}\n'],
    ['a declare module', "declare module 'x' {\n  export const a: number;\n}\n"],
    ['a declare global', 'declare global {\n  interface Window {\n    a: number;\n  }\n}\n'],
    ['a call that is not on the list', 'const V = Object.assign({}, shared);\n'],
  ];

  it.each(active)('refuses %s with its reason', (_name, unit) => {
    const report = moveOut(unit);
    const details = refusals(report);
    expect(details).toHaveLength(2);
    expect(details[0]).toMatch(/^base: active unit at line 3: [A-Za-z]+/);
    expect(details[1]).toMatch(/^head: active unit at line 3: [A-Za-z]+/);
    const reason = details[0]!.replace(/^base: active unit at line 3: /, '');
    expect(reason.length).toBeLessThanOrEqual(60);
    expect(report.pure).toBe(false);
  });

  it('accepts an active unit in a file that the range does not touch', () => {
    const files = { 'src/n.ts': 'register();\n' };
    const report = checkMove(
      tree({ ...files, 'src/a.ts': keep + 'const Y = 2;\n' }),
      tree({ ...files, 'src/a.ts': 'const Y = 2;\n', 'src/b.ts': keep }),
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
    expect(Object.keys(snippets).sort()).toEqual([...EVALUATION_FREE_CALLS].sort());
  });

  it.each(EVALUATION_FREE_CALLS)(
    'accepts %s with free arguments and refuses it with a call',
    (entry) => {
      const snippet = snippets[entry]!;
      const literal = entry.startsWith('Symbol') ? "'a'" : "'a'";
      expect(refusals(moveOut(snippet(literal)))).toEqual([]);
      expect(refusals(moveOut(snippet('make()'))).length).toBeGreaterThan(0);
    },
  );
});
