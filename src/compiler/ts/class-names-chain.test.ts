import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  baseClassOf,
  classExtends,
  keywordAccessOf,
  keywordAccessVia,
  memberDeclarationInChain,
  staticFieldDeclarations,
} from './class-names.js';

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

function memberNamed(cls: ts.ClassLikeDeclaration, name: string): ts.ClassElement {
  return cls.members.find(
    (m) => m.name !== undefined && ts.isIdentifier(m.name) && m.name.text === name,
  )!;
}

describe('keyword access', () => {
  it('reads private, protected and public', () => {
    const cls = classNamed(
      parse('class C { private a = 1; protected b = 2; c = 3; #d = 4; }'),
      'C',
    );
    expect(cls.members.map((m) => keywordAccessOf(m))).toEqual([
      'private',
      'protected',
      undefined,
      undefined,
    ]);
  });
});

describe('the class chain', () => {
  const file = parse(`
class A { x = 1; static s = 1; constructor(public p: number, q: number) {} }
class B extends A { y = 2; static t = 2; }
class C extends B {}
class Cyc1 extends Cyc2 {}
class Cyc2 extends Cyc1 {}
class Dup {}
class Dup {}
class D extends Dup {}
class E extends Missing {}
namespace N { class Inner {} }
class F extends N.Inner {}
class G extends Mixin(A) {}
class H extends Mixin(Missing) {}
class I extends Mixin(Dup) {}
class J extends Mixin(B) {}
class K {}`);
  const cls = (name: string): ts.ClassDeclaration => classNamed(file, name);

  it('finds the base when the file declares exactly one class of that name', () => {
    expect(baseClassOf(cls('B'))).toBe(cls('A'));
    const inner = parse('namespace N { class P {} class Q extends P {} }');
    expect(baseClassOf(classNamed(inner, 'Q'))).toBe(classNamed(inner, 'P'));
    expect(baseClassOf(cls('D'))).toBeUndefined();
    expect(baseClassOf(cls('E'))).toBeUndefined();
    expect(baseClassOf(cls('F'))).toBeUndefined();
    expect(baseClassOf(cls('K'))).toBeUndefined();
  });

  it('finds a member in the nearest class of the chain', () => {
    expect(memberDeclarationInChain(cls('C'), 'y', false)).toBe(memberNamed(cls('B'), 'y'));
    expect(memberDeclarationInChain(cls('C'), 'x', false)).toBe(memberNamed(cls('A'), 'x'));
    expect(memberDeclarationInChain(cls('C'), 't', true)).toBe(memberNamed(cls('B'), 't'));
  });

  it('keeps static and instance members apart', () => {
    expect(memberDeclarationInChain(cls('C'), 's', false)).toBeUndefined();
    expect(memberDeclarationInChain(cls('C'), 'x', true)).toBeUndefined();
  });

  it('finds a parameter property as the parameter that declares it', () => {
    const found = memberDeclarationInChain(cls('C'), 'p', false);
    expect(found !== undefined && ts.isParameter(found)).toBe(true);
    expect(memberDeclarationInChain(cls('C'), 'q', false)).toBeUndefined();
    expect(memberDeclarationInChain(cls('C'), 'p', true)).toBeUndefined();
  });

  it('gives nothing when the chain runs out, is unresolved or loops', () => {
    expect(memberDeclarationInChain(cls('C'), 'nope', false)).toBeUndefined();
    expect(memberDeclarationInChain(cls('E'), 'x', false)).toBeUndefined();
    expect(memberDeclarationInChain(cls('Cyc1'), 'x', false)).toBeUndefined();
  });

  it('reads a class that extends the owner at any depth', () => {
    expect(classExtends(cls('C'), cls('A'))).toBe(true);
    expect(classExtends(cls('C'), cls('B'))).toBe(true);
    expect(classExtends(cls('B'), cls('C'))).toBe(false);
    expect(classExtends(cls('K'), cls('A'))).toBe(false);
  });

  it('reads the argument of a mixin application as the base', () => {
    expect(classExtends(cls('G'), cls('A'))).toBe(true);
    expect(classExtends(cls('J'), cls('A'))).toBe(true);
    expect(classExtends(cls('I'), cls('A'))).toBe(false);
  });

  it('answers unknown when a heritage is not resolved', () => {
    expect(classExtends(cls('E'), cls('A'))).toBe('unknown');
    expect(classExtends(cls('F'), cls('A'))).toBe('unknown');
    expect(classExtends(cls('H'), cls('A'))).toBe('unknown');
  });

  it('lets a resolved owner win over an unresolved branch', () => {
    const own = parse('class A {} class M extends Mix(Missing, A) {}');
    expect(classExtends(classNamed(own, 'M'), classNamed(own, 'A'))).toBe(true);
  });

  it('survives a cycle', () => {
    expect(classExtends(cls('Cyc1'), cls('A'))).toBe(false);
  });

  it('answers false when every heritage resolves and none is the owner', () => {
    expect(classExtends(cls('D'), cls('A'))).toBe(false);
  });
});

describe('keyword access via', () => {
  const file = parse(`
class Owner { private a = 1; protected b = 2; }
class Child extends Owner { m() { return this.b; } }
class Stranger { m() { return 1; } }
class Unknown extends Missing { m() { return 1; } }`);
  const inside = (name: string): ts.Node => memberNamed(classNamed(file, name), 'm');
  const owner = classNamed(file, 'Owner');

  it('grants the owner its own body for either access', () => {
    const at = memberNamed(owner, 'a');
    expect(keywordAccessVia('private', owner, at)).toBe(owner);
    expect(keywordAccessVia('protected', owner, at)).toBe(owner);
  });

  it('grants a protected member to a class that extends the owner and a private one to none', () => {
    expect(keywordAccessVia('protected', owner, inside('Child'))).toBe(classNamed(file, 'Child'));
    expect(keywordAccessVia('private', owner, inside('Child'))).toBeUndefined();
  });

  it('grants nothing outside the family', () => {
    expect(keywordAccessVia('protected', owner, inside('Stranger'))).toBeUndefined();
    expect(keywordAccessVia('protected', owner, file)).toBeUndefined();
  });

  it('gives the benefit of the doubt to a heritage the file does not resolve', () => {
    expect(keywordAccessVia('protected', owner, inside('Unknown'))).toBe('granted');
    expect(keywordAccessVia('private', owner, inside('Unknown'))).toBeUndefined();
  });
});

describe('static field declarations', () => {
  it('keys each static field by class and name as written', () => {
    const file = parse(
      'class C { static a = 1; static #b = 2; c = 3; static "d" = 4; static m() {} } namespace N { class K { static e = 5; } }',
    );
    expect([...staticFieldDeclarations(file).keys()].sort()).toEqual(['C.#b', 'C.a', 'K.e']);
    expect(staticFieldDeclarations(file)).toBe(staticFieldDeclarations(file));
  });
});
