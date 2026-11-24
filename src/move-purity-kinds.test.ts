import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { tree } from './core/testing/move-purity-fixtures.js';
import {
  ACCEPTED_CLASS_MEMBER_KINDS,
  ACCEPTED_EXPRESSION_KINDS,
  ACCEPTED_OBJECT_MEMBER_KINDS,
  ACCEPTED_STATEMENT_KINDS,
  acceptedKindNames,
  kindName,
} from '../scripts/move-purity/accepted-kinds.js';
import { activeUnitsOf } from '../scripts/move-purity/clean-files.js';
import { createSide } from '../scripts/move-purity/side-program.js';

const LIB =
  'export let counter = 0;\nconst holder = { get x() { return 1; } };\nexport const viaGetter = holder.x;\n';
const NS = "import * as ns from './lib.js';\n";
const PREAMBLE = 'function helper(): number {\n  return 1;\n}\nenum E {\n  A,\n}\n';

const activeCount = (text: string): number => {
  const withImport = text.includes('ns.') || text.includes('ns?.') ? NS + text : text;
  const side = createSide('/kinds-fixture', tree({ 'src/lib.ts': LIB, 'src/a.ts': withImport }));
  return activeUnitsOf(side, 'src/a.ts').length;
};

const kindsIn = (text: string): Set<string> => {
  const found = new Set<string>();
  const visit = (node: ts.Node): void => {
    found.add(kindName(node.kind));
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile('a.ts', text, ts.ScriptTarget.Latest, true));
  return found;
};

const STATEMENTS: [string, string][] = [
  ['ClassDeclaration', 'class C {}'],
  ['EnumDeclaration', 'enum G {\n  A,\n}'],
  ['ExportAssignment', 'export default 1;'],
  ['ExportDeclaration', 'export { helper };'],
  ['FunctionDeclaration', 'function g() {}'],
  ['InterfaceDeclaration', 'interface I {\n  a: number;\n}'],
  ['TypeAliasDeclaration', 'type T = number;'],
  ['VariableStatement', 'const X = 1;'],
];

const EXPRESSIONS: [string, string][] = [
  ['ArrayLiteralExpression', '[1, 2]'],
  ['ArrowFunction', '() => 1'],
  ['AsExpression', '1 as number'],
  ['BigIntLiteral', '10n'],
  ['BinaryExpression', '1 + 2'],
  ['CallExpression', 'Object.freeze([1])'],
  ['ClassExpression', 'class {}'],
  ['ConditionalExpression', '1 ? 2 : 3'],
  ['FalseKeyword', 'false'],
  ['FunctionExpression', 'function () {}'],
  ['Identifier', 'helper'],
  ['NewExpression', 'new Map()'],
  ['NoSubstitutionTemplateLiteral', '`a`'],
  ['NonNullExpression', 'helper!'],
  ['NullKeyword', 'null'],
  ['NumericLiteral', '1'],
  ['ObjectLiteralExpression', '{ a: 1 }'],
  ['OmittedExpression', '[, 1]'],
  ['ParenthesizedExpression', '(1)'],
  ['PrefixUnaryExpression', '-1'],
  ['PropertyAccessExpression', 'E.A'],
  ['RegularExpressionLiteral', '/a/'],
  ['SatisfiesExpression', '1 satisfies number'],
  ['StringLiteral', "'a'"],
  ['TemplateExpression', '`a${1}`'],
  ['TrueKeyword', 'true'],
  ['TypeAssertionExpression', '<number>1'],
  ['TypeOfExpression', 'typeof 1'],
  ['VoidExpression', 'void 0'],
];

const CLASS_MEMBERS: [string, string][] = [
  ['Constructor', 'class C {\n  constructor() {}\n}'],
  ['GetAccessor', 'class C {\n  get a() {\n    return 1;\n  }\n}'],
  ['IndexSignature', 'class C {\n  [k: string]: number;\n}'],
  ['MethodDeclaration', 'class C {\n  m() {}\n}'],
  ['PropertyDeclaration', 'class C {\n  p = 1;\n}'],
  ['SemicolonClassElement', 'class C {\n  ;\n}'],
  ['SetAccessor', 'class C {\n  set a(v: number) {}\n}'],
];

const OBJECT_MEMBERS: [string, string][] = [
  ['GetAccessor', 'const O = { get a() { return 1; } };'],
  ['MethodDeclaration', 'const O = { m() {} };'],
  ['PropertyAssignment', 'const O = { p: 1 };'],
  ['SetAccessor', 'const O = { set a(v: number) {} };'],
  ['ShorthandPropertyAssignment', 'const O = { helper };'],
];

const snippetsOf = (table: [string, string][], wrap: (s: string) => string): string[] =>
  table.map(([, snippet]) => PREAMBLE + wrap(snippet) + '\n');

describe('the classifier accepts only the kinds of its allow-list (P4)', () => {
  it('names each accepted statement kind in a literal list', () => {
    expect(acceptedKindNames(ACCEPTED_STATEMENT_KINDS)).toEqual(STATEMENTS.map(([k]) => k).sort());
  });

  it('names each accepted expression kind in a literal list', () => {
    expect(acceptedKindNames(ACCEPTED_EXPRESSION_KINDS)).toEqual(
      EXPRESSIONS.map(([k]) => k).sort(),
    );
  });

  it('names each accepted member kind in a literal list', () => {
    expect(acceptedKindNames(ACCEPTED_CLASS_MEMBER_KINDS)).toEqual(
      CLASS_MEMBERS.map(([k]) => k).sort(),
    );
    expect(acceptedKindNames(ACCEPTED_OBJECT_MEMBER_KINDS)).toEqual(
      OBJECT_MEMBERS.map(([k]) => k).sort(),
    );
  });

  const groups: [string, [string, string][], (snippet: string) => string][] = [
    ['statement', STATEMENTS, (s) => s],
    ['expression', EXPRESSIONS, (s) => `const V = ${s};`],
    ['class member', CLASS_MEMBERS, (s) => s],
    ['object member', OBJECT_MEMBERS, (s) => s],
  ];

  for (const [label, table, wrap] of groups) {
    it.each(table)(`takes one snippet of the ${label} kind %s as free`, (kind, snippet) => {
      const [text] = snippetsOf([[kind, snippet]], wrap);
      expect(kindsIn(text!).has(kind)).toBe(true);
      expect(activeCount(text!)).toBe(0);
    });
  }
});

describe('the classifier refuses everything else (P4)', () => {
  const refused: [string, string][] = [
    ['a getter entry of a Map', 'const V = new Map([{ get 0() { return 1; }, 1: 2 }]);'],
    ['a getter entry of a Set', 'const V = new Set([{ get a() { return 1; } }]);'],
    [
      'a class with a static getter as a Map entry',
      'class K { static get 0() { run(); return 1; } }\nconst V = new Map([K]);',
    ],
    ['an import equals', 'import a = ns.counter;'],
    ['an exported import equals', 'export import a = ns.counter;'],
    ['an import equals require', "import fs = require('node:fs');"],
    ['a using declaration', 'using x = make();'],
    ['an await using declaration', 'await using y = make();'],
    ['a using declaration of null', 'using z = null;'],
    ['an IIFE statement', '(() => 1)();'],
    ['an IIFE in a constant', 'const V = (() => 1)();'],
    ['a tagged template', 'const V = tag`a`;'],
    ['a spread in an array', 'const V = [...[1]];'],
    ['a spread in an object', 'const V = { ...{ a: 1 } };'],
    ['a spread in a call', 'const V = Object.freeze([...[1]]);'],
    ['an element access', 'const V = [1][0];'],
    ['an optional chain', 'const V = ns?.counter;'],
    ['the in operator', "const V = 'a' in { a: 1 };"],
    ['the instanceof operator', 'const V = helper instanceof Object;'],
    ['an assignment operator', 'declare let a: number;\nconst V = (a += 1);'],
    ['a postfix update', 'declare let a: number;\nconst V = a++;'],
    ['a prefix update', 'declare let a: number;\nconst V = ++a;'],
    ['an await', 'const V = await 1;'],
    ['a dynamic import', "const V = import('node:fs');"],
    ['import.meta', 'const V = import.meta.url;'],
    ['a namespace with a call', 'namespace N {\n  run();\n}'],
    ['a namespace with a constant', 'namespace N {\n  export const a = 1;\n}'],
    ['a static block', 'class C {\n  static {\n    run();\n  }\n}'],
    ['a decorated class', '@dec\nclass C {}'],
    ['a decorated member', 'class C {\n  @dec m() {}\n}'],
    ['a static initializer with a call', 'class C {\n  static x = make();\n}'],
    ['a computed name in an object', 'const V = { [make()]: 1 };'],
    ['a computed name in a class', 'class C {\n  [make()] = 1;\n}'],
    ['a template with an object substitution', 'const V = `${{ a: 1 }}`;'],
    ['a template with an array substitution', 'const V = `${[1]}`;'],
    ['a read of an imported let', 'const V = ns.counter + 1;'],
    [
      'a read of an imported let by name',
      "import { counter } from './lib.js';\nconst V = counter + 1;",
    ],
    ['a namespace member that reads a getter', 'const V = ns.viaGetter;'],
    ['a let', 'let v = 1;'],
    ['a var', 'var v = 1;'],
    ['a destructuring', 'const { a } = { a: 1 };'],
    ['a call statement', 'register();'],
    ['a new of an unlisted class', 'const V = new Date();'],
    ['a new of a local class', 'class C {}\nconst V = new C();'],
    ['a loop', 'for (;;) {\n  break;\n}'],
    ['a conditional statement', 'if (true) {\n  run();\n}'],
    ['a literal expression statement', '1;'],
    ['a comma expression', 'const V = (run(), 1);'],
    ['a delete', 'const V = delete ({} as { a?: number }).a;'],
    ['a throw', "throw new Error('x');"],
    ['an exported call', 'export default make();'],
    ['a declare module', "declare module 'x' {\n  export const a: number;\n}"],
    ['a declare global', 'declare global {\n  interface Window {\n    a: number;\n  }\n}'],
    ['a class that extends a call', 'class C extends mix(helper) {}'],
    ['an enum with a call', 'enum F {\n  A = make(),\n}'],
  ];

  it('has at least 40 refused snippets', () => {
    expect(refused.length).toBeGreaterThanOrEqual(40);
  });

  it.each(refused)('refuses %s', (_name, snippet) => {
    expect(activeCount(snippet + '\n')).toBeGreaterThan(0);
  });
});
