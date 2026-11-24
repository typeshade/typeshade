import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { privateStaticFields, shadowedStaticFields, writtenStaticFields } from './class-names.js';

function parse(text: string): ts.SourceFile {
  return ts.createSourceFile('a.ts', text, ts.ScriptTarget.ES2022, true);
}

function classNamed(file: ts.SourceFile, name: string, nth = 0): ts.ClassDeclaration {
  const found: ts.ClassDeclaration[] = [];
  const walk = (n: ts.Node): void => {
    if (ts.isClassDeclaration(n) && n.name?.text === name) found.push(n);
    ts.forEachChild(n, walk);
  };
  walk(file);
  return found[nth]!;
}

describe('written statics', () => {
  it('lists the fields written by assignment, compound assignment, ++ and --', () => {
    const file = parse(`
class C { static a = 0; static b = 0; static c = 0; static d = 0; static e = 0; static f = 0; }
C.a = 1; C.b += 1; C.c++; --C.d; (C).e = 2; (C.f) = 3;`);
    expect([...writtenStaticFields(file)].sort()).toEqual([
      'C.a',
      'C.b',
      'C.c',
      'C.d',
      'C.e',
      'C.f',
    ]);
  });

  it('roots a write through an element or a member of the field', () => {
    const file = parse(`
class C { static v = [1, 2]; static o = { x: { y: 1 } }; static r = 0; }
C.v[0] = 1; C.o.x.y = 2;`);
    expect([...writtenStaticFields(file)].sort()).toEqual(['C.o', 'C.v']);
  });

  it('keeps a read-only or never-written field out', () => {
    const file = parse(`
class C { static readonly a = 0; static b = 0; static c = 0; }
C.a = 1; const x = C.b + C.c;`);
    expect([...writtenStaticFields(file)]).toEqual([]);
  });

  it('writes a field through this inside a static member and its arrow functions', () => {
    const file = parse(`
class C {
  static n = 0; static m = 0; static k = 0;
  static bump() { this.n++; }
  static later() { return () => { this.m += 1; }; }
  static plain() { return function () { this.k = 1; }; }
  inst() { this.n = 5; }
}`);
    expect([...writtenStaticFields(file)].sort()).toEqual(['C.m', 'C.n']);
  });

  it('writes the field of a derived class that declares its own and inherits the writer', () => {
    const file = parse(`
class Base { static hits = 0; static record() { this.hits += 1; } }
class Derived extends Base { static hits = 0; }
class Other extends Base { static other = 0; }`);
    expect([...writtenStaticFields(file)].sort()).toEqual(['Base.hits', 'Derived.hits']);
  });

  it('stops at a derived class that overrides the writer without super', () => {
    const file = parse(`
class Base { static hits = 0; static record() { this.hits += 1; } }
class Derived extends Base { static hits = 0; static record() { return 1; } }`);
    expect([...writtenStaticFields(file)]).toEqual(['Base.hits']);
  });

  it('goes on through an override that reaches super', () => {
    const file = parse(`
class Base { static hits = 0; static record() { this.hits += 1; } }
class Mid extends Base { static record() { super.record(); } }
class Leaf extends Mid { static hits = 0; }`);
    expect([...writtenStaticFields(file)].sort()).toEqual(['Base.hits', 'Leaf.hits']);
  });

  it('lands a write into a static a base declares on the base', () => {
    const file = parse(`
class Base { static origin = { y: 0 }; }
class Derived extends Base {}
Derived.origin.y = 5;
Derived.origin = { y: 1 };`);
    expect([...writtenStaticFields(file)]).toEqual(['Base.origin']);
  });

  it('gives a class with no name no static a name can reach', () => {
    const file = parse('export default class { static n = 0; static bump() { this.n++; } }');
    expect([...writtenStaticFields(file)]).toEqual([]);
  });

  it('returns the same set for the same file', () => {
    const file = parse('class C { static a = 0; } C.a = 1;');
    expect(writtenStaticFields(file)).toBe(writtenStaticFields(file));
  });
});

describe('private statics', () => {
  it('keys a private static by the name it is emitted as', () => {
    const file = parse(
      'class Cfg { static #gain = 1; static open = 2; #inst = 3; static get gain() { return 1; } }',
    );
    expect([...privateStaticFields(file)]).toEqual(['Cfg.gain']);
  });

  it('finds classes in a namespace', () => {
    const file = parse('namespace N { class K { static #a = 1; } }');
    expect([...privateStaticFields(file)]).toEqual(['K.a']);
  });
});

describe('shadowed statics', () => {
  it('marks the second static whose emitted name an earlier one took', () => {
    const cls = classNamed(
      parse('class C { static #n = 1; static n = 2; static m = 3; static #m = 4; static o = 5; }'),
      'C',
    );
    const shadowed = [...shadowedStaticFields(cls)].map((m) => m.name.getText());
    expect(shadowed).toEqual(['n', '#m']);
  });

  it('ignores instance fields and quoted names', () => {
    const cls = classNamed(parse('class C { static n = 1; n = 2; static "n" = 3; }'), 'C');
    expect(shadowedStaticFields(cls).size).toBe(0);
  });
});
