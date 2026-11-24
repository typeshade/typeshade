import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  accessorFnName,
  buildsCallerClass,
  callerClassForm,
  emittedMemberName,
  enclosingClasses,
  holdsFunction,
  isCallerClassThis,
  isPrivateName,
  privateOwner,
  returnsThis,
  staticThisClass,
  staticThisMember,
  writtenMemberName,
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

function firstOf<T extends ts.Node>(file: ts.SourceFile, test: (n: ts.Node) => n is T): T {
  let hit: T | undefined;
  const walk = (n: ts.Node): void => {
    if (hit === undefined && test(n)) hit = n;
    else ts.forEachChild(n, walk);
  };
  walk(file);
  return hit!;
}

function methodBody(text: string): ts.Block {
  return firstOf(parse(text), ts.isMethodDeclaration).body!;
}

describe('member names', () => {
  it('writes an identifier or a private name and refuses a quoted or computed one', () => {
    const cls = classNamed(parse('class C { a = 1; #b = 2; "c" = 3; [d] = 4; }'), 'C');
    const written = cls.members.map((m) => writtenMemberName(m.name!));
    expect(written).toEqual(['a', '#b', undefined, undefined]);
  });

  it('emits a private name without its hash', () => {
    expect(isPrivateName('#x')).toBe(true);
    expect(isPrivateName('x')).toBe(false);
    expect(emittedMemberName('#count')).toBe('count');
    expect(emittedMemberName('count')).toBe('count');
  });

  it('names the two halves of an accessor apart', () => {
    expect(accessorFnName('Circle', 'get', 'area')).toBe('Circle_get_area');
    expect(accessorFnName('Slider', 'set', '#value')).toBe('Slider_set_value');
  });
});

describe('private owner', () => {
  const file = parse(`
class Outer {
  #x = 1;
  #y = 2;
  m() {
    class Inner {
      #x = 3;
      n() { return this.#x + this.#y; }
    }
    return Inner;
  }
}`);

  const access = (name: string): ts.Node =>
    firstOf(
      file,
      (n): n is ts.PrivateIdentifier =>
        ts.isPrivateIdentifier(n) && n.text === name && ts.isPropertyAccessExpression(n.parent),
    );

  it('lists the enclosing classes innermost first', () => {
    const names = enclosingClasses(access('#x')).map((c) => c.name?.text);
    expect(names).toEqual(['Inner', 'Outer']);
  });

  it('resolves a private name to the innermost class that declares it', () => {
    expect(privateOwner(access('#x'), '#x')?.cls.name?.text).toBe('Inner');
    expect(privateOwner(access('#y'), '#y')?.cls.name?.text).toBe('Outer');
    expect(privateOwner(access('#y'), '#z')).toBeUndefined();
  });
});

describe('returnsThis', () => {
  it('holds when every return is this, through parentheses', () => {
    expect(returnsThis(methodBody('class C { m() { if (a) return this; return (this); } }'))).toBe(
      true,
    );
  });

  it('needs at least one return', () => {
    expect(returnsThis(methodBody('class C { m() { a(); } }'))).toBe(false);
    expect(returnsThis(undefined)).toBe(false);
  });

  it('fails when any return is another value or a bare return', () => {
    expect(returnsThis(methodBody('class C { m() { if (a) return this; return 1; } }'))).toBe(
      false,
    );
    expect(returnsThis(methodBody('class C { m() { if (a) return this; return; } }'))).toBe(false);
  });

  it('leaves the returns of a nested function to that function', () => {
    const body = methodBody(
      'class C { m() { const f = () => { return 1; }; function g() { return 2; } return this; } }',
    );
    expect(returnsThis(body)).toBe(true);
  });
});

describe('holdsFunction', () => {
  it('is true for an arrow function or a function expression and false for a value', () => {
    const cls = classNamed(
      parse('class C { a = () => 1; b = function () { return 1; }; c = 1; d; }'),
      'C',
    );
    const held = cls.members.map((m) => holdsFunction(m as ts.PropertyDeclaration));
    expect(held).toEqual([true, true, false, false]);
  });
});

describe('static this', () => {
  const file = parse(`
class C {
  static viaMethod() { return this; }
  static viaArrow() { return () => () => this; }
  static viaFunction() { return function () { return this; }; }
  static field = this;
  static { this; }
  static get acc() { return this; }
  instance() { return this; }
  constructor() { this; }
}
function plain() { return this; }`);
  const cls = classNamed(file, 'C');
  const thisAt = (name: string): ts.Node =>
    firstOf(memberNamed(cls, name), (n): n is ts.Node => n.kind === ts.SyntaxKind.ThisKeyword);

  it('finds the static member through the arrow functions between', () => {
    expect(staticThisMember(thisAt('viaMethod'))).toBe(memberNamed(cls, 'viaMethod'));
    expect(staticThisMember(thisAt('viaArrow'))).toBe(memberNamed(cls, 'viaArrow'));
    expect(staticThisMember(thisAt('acc'))).toBe(memberNamed(cls, 'acc'));
    expect(staticThisMember(thisAt('field'))).toBe(memberNamed(cls, 'field'));
  });

  it('finds a static block', () => {
    const block = cls.members.find(ts.isClassStaticBlockDeclaration)!;
    const at = firstOf(block, (n): n is ts.Node => n.kind === ts.SyntaxKind.ThisKeyword);
    expect(staticThisMember(at)).toBe(block);
  });

  it('gives nothing for an instance member, a constructor or a plain function', () => {
    expect(staticThisMember(thisAt('instance'))).toBeUndefined();
    expect(staticThisMember(thisAt('viaFunction'))).toBeUndefined();
    const ctor = cls.members.find(ts.isConstructorDeclaration)!;
    expect(
      staticThisMember(firstOf(ctor, (n): n is ts.Node => n.kind === ts.SyntaxKind.ThisKeyword)),
    ).toBeUndefined();
    const plain = file.statements.find(ts.isFunctionDeclaration)!;
    expect(
      staticThisMember(firstOf(plain, (n): n is ts.Node => n.kind === ts.SyntaxKind.ThisKeyword)),
    ).toBeUndefined();
  });

  it('names the class that declares the static member', () => {
    expect(staticThisClass(thisAt('viaArrow'))).toBe(cls);
    expect(staticThisClass(thisAt('instance'))).toBeUndefined();
  });

  it('gives no class for a class expression', () => {
    const expr = parse('const K = class { static m() { return this; } };');
    const at = firstOf(expr, (n): n is ts.Node => n.kind === ts.SyntaxKind.ThisKeyword);
    expect(staticThisClass(at)).toBeUndefined();
  });
});

describe('the this parameter of a caller class', () => {
  const file = parse(`
class Disc {
  static ok<C extends Disc>(this: { new (): C }): C { return new this(); }
  static noThisParam<C extends Disc>(): C { return new this(); }
  static notLiteral<C extends Disc>(this: C): C { return this; }
  static noCtor<C extends Disc>(this: { x: C }): C { return this.x; }
  static foreignParam<C extends Disc>(this: { new (): D }): C { return new this(); }
  static foreignBoth<C extends Disc>(this: { new (): D }): D { return new this(); }
  static wrongReturn<C extends Disc>(this: { new (): C }): number { return 1; }
  static noReturnType<C extends Disc>(this: { new (): C }) { return new this(); }
  static plainNew() { return new this(); }
  static viaArrow<C extends Disc>(this: { new (): C }): C { const f = () => new this(); return f(); }
  static viaFunction<C extends Disc>(this: { new (): C }): C { const f = function () { return new this(); }; return f(); }
  static viaParens<C extends Disc>(this: { new (): C }): C { return new (this)(); }
  static noNew<C extends Disc>(this: { new (): C }): C { return null as never; }
  static get accessor(): number { return 1; }
  m<C extends Disc>(this: { new (): C }): C { return new this(); }
}`);
  const cls = classNamed(file, 'Disc');
  const method = (name: string): ts.MethodDeclaration =>
    memberNamed(cls, name) as ts.MethodDeclaration;

  it('reads the form when the parameter builds a type parameter the method returns', () => {
    const form = callerClassForm(method('ok'));
    expect(form?.typeParam).toBe('C');
    expect(form?.thisParam.name.getText()).toBe('this');
  });

  it('reads anything else as written', () => {
    for (const name of [
      'noThisParam',
      'notLiteral',
      'noCtor',
      'foreignParam',
      'foreignBoth',
      'wrongReturn',
      'noReturnType',
    ]) {
      expect(callerClassForm(method(name)), name).toBeUndefined();
    }
  });

  it('types a this by the parameter only in a method of the form', () => {
    const thisIn = (name: string): ts.Node =>
      firstOf(
        method(name),
        (n): n is ts.Node => n.kind === ts.SyntaxKind.ThisKeyword && !ts.isParameter(n.parent),
      );
    expect(isCallerClassThis(thisIn('ok'))).toBe(true);
    expect(isCallerClassThis(thisIn('plainNew'))).toBe(false);
    expect(isCallerClassThis(thisIn('m'))).toBe(false);
    expect(isCallerClassThis(thisIn('viaFunction'))).toBe(false);
  });

  it('builds the caller class with new this, through parentheses and arrow functions', () => {
    expect(buildsCallerClass(method('ok'))).toBe(true);
    expect(buildsCallerClass(method('viaParens'))).toBe(true);
    expect(buildsCallerClass(method('viaArrow'))).toBe(true);
  });

  it('does not build it when a function rebinds this, or the form or static is missing', () => {
    expect(buildsCallerClass(method('viaFunction'))).toBe(false);
    expect(buildsCallerClass(method('noNew'))).toBe(false);
    expect(buildsCallerClass(method('plainNew'))).toBe(false);
    expect(buildsCallerClass(method('m'))).toBe(false);
    expect(buildsCallerClass(memberNamed(cls, 'accessor'))).toBe(false);
  });
});
