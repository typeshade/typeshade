// ═══ One object under two names (change 0142, Tables 1 and 3) ═══
//
// Implements: Rule 8.8, Rule 8.25 (docs/language-design.md; traced in reqs/).
//
// An object has the identity a JavaScript object has. A statement that stores an object another
// name holds (`q = a`, `xs[0] = a`, `b.child = a`, `[a, a]`, `new B(a)`, a function that returns
// its parameter) makes two names of one object in JavaScript. Where nothing writes the object
// after that, a copy has JavaScript's result, and the compiler makes a copy (Table 1). Where
// something does, a copy is a result JavaScript does not give, and the form is refused as not
// supported yet (OD-9) until the stage that keeps one storage for the two names.
//
// This file finds those statements on the source, so the compiler and the editor say one thing
// (Rule 12.7). It reads types only as far as the source writes them: a name whose type it cannot
// read as a value type is read as an object, so it refuses more than it must and never less.

import ts from 'typescript';
import {
  ARRAY_MUTATORS,
  bare,
  fileFunction,
  methodWritesThis,
  objectWrites,
  rootOf,
  takesThePlace,
  writeTargets,
  writesAnObject,
} from './object-reference.js';

type Fn = ts.FunctionLikeDeclaration;

/** The names whose object a value may be or may hold, each with whether the value only holds it
 *  (`part`: a part of a new aggregate) or may be the object itself, and the place that is the
 *  object where the value is exactly one place of the name. */
interface Share {
  readonly part: boolean;
  readonly place: ts.Expression | undefined;
  /** Whether one value holds the object at two places: `[a, a]`, `new B(a, a)`. */
  readonly twice?: boolean;
}
type Shares = Map<string, Share>;

const add = (into: Shares, from: Shares, asPart = false, keepPlace = true): void => {
  for (const [k, share] of from) {
    const part = share.part || asPart;
    const had = into.get(k);
    into.set(
      k,
      had === undefined
        ? { part, place: asPart || !keepPlace ? undefined : share.place, twice: share.twice }
        : { part: had.part && part, place: undefined, twice: had.twice === true || asPart },
    );
  }
};

/** The steps of a place from its root name: a field's name, or an element's index where it is
 *  written as a number. */
function stepsOf(place: ts.Expression): (string | number | undefined)[] {
  const steps: (string | number | undefined)[] = [];
  let at = bare(place);
  while (ts.isPropertyAccessExpression(at) || ts.isElementAccessExpression(at)) {
    if (ts.isPropertyAccessExpression(at)) steps.unshift(at.name.text);
    else {
      const index = bare(at.argumentExpression);
      steps.unshift(ts.isNumericLiteral(index) ? Number(index.text) : undefined);
    }
    at = bare(at.expression);
  }
  return steps;
}

/** Whether a write at `written` may change the object at `held`, two places of one name. An
 *  assignment (`replaces`) to the place itself, or to a place that holds it, puts another value
 *  there and leaves the object as it was, which is what a copy keeps too. */
function mayChange(
  written: ts.Expression,
  held: ts.Expression | undefined,
  replaces: boolean,
): boolean {
  if (held === undefined) return true;
  const w = stepsOf(written);
  const h = stepsOf(held);
  for (let i = 0; i < Math.min(w.length, h.length); i++) {
    const a = w[i];
    const b = h[i];
    if (typeof a === 'string' || typeof b === 'string') {
      if (a !== b) return false;
    } else if (a !== undefined && b !== undefined && a !== b) return false;
  }
  return replaces ? w.length > h.length : true;
}

/** The declarations of members named `name` in the classes, interfaces and object types of the
 *  file. */
function membersNamed(name: string, sourceFile: ts.SourceFile): readonly ts.Node[] {
  let byName = MEMBERS.get(sourceFile);
  if (byName === undefined) {
    byName = new Map();
    const index = byName;
    const visit = (n: ts.Node): void => {
      if (
        (ts.isPropertyDeclaration(n) ||
          ts.isPropertySignature(n) ||
          ts.isGetAccessorDeclaration(n) ||
          ts.isMethodDeclaration(n) ||
          ts.isMethodSignature(n) ||
          (ts.isParameter(n) && ts.isConstructorDeclaration(n.parent) && n.modifiers?.length)) &&
        n.name !== undefined &&
        (ts.isIdentifier(n.name) || ts.isPrivateIdentifier(n.name))
      ) {
        const list = index.get(n.name.text) ?? [];
        list.push(n);
        index.set(n.name.text, list);
      }
      ts.forEachChild(n, visit);
    };
    visit(sourceFile);
    MEMBERS.set(sourceFile, byName);
  }
  return byName.get(name) ?? [];
}
const MEMBERS = new WeakMap<ts.SourceFile, Map<string, ts.Node[]>>();

/** Whether every member named `name` in the file is a field: no getter and no method. A name
 *  the file does not declare is a builtin's, which is read as no field. */
function isField(name: string, sourceFile: ts.SourceFile): boolean {
  const members = membersNamed(name, sourceFile);
  return (
    members.length > 0 &&
    members.every(
      (m) => ts.isPropertyDeclaration(m) || ts.isPropertySignature(m) || ts.isParameter(m),
    )
  );
}

/** Whether `e` is a place the source names step by step: a name or `this`, then fields and
 *  elements. A getter, a method and a call in the chain may give any object. */
function isPlainPlace(e: ts.Expression, sourceFile: ts.SourceFile): boolean {
  let at = bare(e);
  for (;;) {
    if (ts.isIdentifier(at) || at.kind === ts.SyntaxKind.ThisKeyword) return true;
    if (ts.isPropertyAccessExpression(at)) {
      if (!isField(at.name.text, sourceFile)) return false;
      at = bare(at.expression);
    } else if (ts.isElementAccessExpression(at)) at = bare(at.expression);
    else return false;
  }
}

/** The array methods of ECMAScript that give back a number, a `bool` or nothing. */
const VALUE_METHODS = new Set([
  'indexOf',
  'lastIndexOf',
  'includes',
  'some',
  'every',
  'findIndex',
  'forEach',
  'push',
  'join',
]);

/** The element type an array type is written with. */
function elementType(type: ts.TypeNode | undefined): ts.TypeNode | undefined {
  let at = type;
  while (at !== undefined && ts.isParenthesizedTypeNode(at)) at = at.type;
  // A binding is what it holds: `workgroup<array<f32, N>>` has the elements of its array.
  while (
    at !== undefined &&
    ts.isTypeReferenceNode(at) &&
    ts.isIdentifier(at.typeName) &&
    ['uniform', 'storage', 'workgroup'].includes(at.typeName.text)
  )
    at = at.typeArguments?.[0];
  if (at === undefined) return undefined;
  if (ts.isArrayTypeNode(at)) return at.elementType;
  if (ts.isTupleTypeNode(at)) return at.elements[0];
  if (
    ts.isTypeReferenceNode(at) &&
    ts.isIdentifier(at.typeName) &&
    (at.typeName.text === 'array' || at.typeName.text === 'Array')
  )
    return at.typeArguments?.[0];
  return undefined;
}

class Reader {
  constructor(
    readonly fn: Fn | undefined,
    readonly sourceFile: ts.SourceFile,
  ) {}

  /** The declaration of the variable or parameter that the name written at `at` refers to: the
   *  nearest block, loop or function around `at` that declares it, as TypeScript resolves it.
   *  Two variables of one name in two blocks are two variables. */
  private declOf(
    name: string,
    at?: ts.Node,
  ): ts.ParameterDeclaration | ts.VariableDeclaration | ts.BindingElement | undefined {
    type Decl = ts.ParameterDeclaration | ts.VariableDeclaration | ts.BindingElement;
    const inName = (d: Decl, n: ts.BindingName): Decl | undefined => {
      if (ts.isIdentifier(n)) return n.text === name ? d : undefined;
      for (const el of n.elements) {
        if (ts.isOmittedExpression(el)) continue;
        const hit = inName(el, el.name);
        if (hit !== undefined) return hit;
      }
      return undefined;
    };
    const inList = (list: ts.VariableDeclarationList): Decl | undefined => {
      for (const d of list.declarations) {
        const hit = inName(d, d.name);
        if (hit !== undefined) return hit;
      }
      return undefined;
    };
    const inStatements = (statements: readonly ts.Statement[]): Decl | undefined => {
      for (const st of statements) {
        if (!ts.isVariableStatement(st)) continue;
        const hit = inList(st.declarationList);
        if (hit !== undefined) return hit;
      }
      return undefined;
    };
    for (let scope = at?.parent; scope !== undefined; scope = scope.parent) {
      let hit: Decl | undefined;
      if (ts.isBlock(scope) || ts.isSourceFile(scope) || ts.isModuleBlock(scope))
        hit = inStatements(scope.statements);
      else if (ts.isCaseClause(scope) || ts.isDefaultClause(scope))
        hit = inStatements(scope.statements);
      else if (ts.isForStatement(scope) || ts.isForOfStatement(scope) || ts.isForInStatement(scope))
        hit =
          scope.initializer !== undefined && ts.isVariableDeclarationList(scope.initializer)
            ? inList(scope.initializer)
            : undefined;
      else if (ts.isFunctionLike(scope)) {
        for (const q of scope.parameters) {
          hit = inName(q, q.name);
          if (hit !== undefined) break;
        }
      }
      if (hit !== undefined) return hit;
    }
    if (at?.parent !== undefined) return undefined;
    // A name with no place in the tree (a name read off a declaration): the first declaration
    // of it in the function, or in the file.
    let found: Decl | undefined;
    const visit = (n: ts.Node): void => {
      if (found !== undefined) return;
      if (
        (ts.isParameter(n) || ts.isVariableDeclaration(n) || ts.isBindingElement(n)) &&
        ts.isIdentifier(n.name) &&
        n.name.text === name
      ) {
        found = n;
        return;
      }
      ts.forEachChild(n, visit);
    };
    if (this.fn !== undefined) visit(this.fn);
    if (found !== undefined) return found;
    for (const st of this.sourceFile.statements) {
      if (ts.isVariableStatement(st)) visit(st);
    }
    return found;
  }

  /** Whether a name a pattern declares, `let { c } = b` or `let [p, q] = ps`, may be an object:
   *  `false` only where the source shows a value. */
  private patternNameIsObject(d: ts.BindingElement): boolean {
    const pattern = d.parent;
    const holder = pattern.parent;
    if (ts.isObjectBindingPattern(pattern)) {
      const key = d.propertyName ?? d.name;
      if (!ts.isIdentifier(key)) return true;
      const members = membersNamed(key.text, this.sourceFile);
      if (members.length === 0) return false;
      return members.some((m) => {
        if (ts.isMethodDeclaration(m) || ts.isMethodSignature(m)) return false;
        const field = m as ts.PropertyDeclaration;
        if (field.type !== undefined) return writesAnObject(field.type, this.sourceFile);
        return field.initializer !== undefined && this.isObject(field.initializer);
      });
    }
    if (!ts.isVariableDeclaration(holder) || holder.initializer === undefined) return true;
    const init = bare(holder.initializer);
    if (ts.isArrayLiteralExpression(init)) {
      const at = init.elements[pattern.elements.indexOf(d)];
      return at === undefined || this.isObject(at);
    }
    const elem = elementType(this.typeOf(init));
    return elem === undefined || writesAnObject(elem, this.sourceFile);
  }

  /** The expressions being read, so that `const a = b; const b = a;` ends. */
  private readonly reading = new Set<ts.Node>();

  /** The type the source writes for `e`, where it writes one. */
  private typeOf(e: ts.Expression): ts.TypeNode | undefined {
    const x = bare(e);
    if (this.reading.has(x)) return undefined;
    this.reading.add(x);
    try {
      return this.typeOfNow(x);
    } finally {
      this.reading.delete(x);
    }
  }

  private typeOfNow(x: ts.Expression): ts.TypeNode | undefined {
    if (ts.isIdentifier(x)) {
      const d = this.declOf(x.text, x);
      if (d === undefined || ts.isBindingElement(d)) return undefined;
      if (d.type !== undefined) return d.type;
      const list = ts.isVariableDeclaration(d) ? d.parent : undefined;
      if (
        list !== undefined &&
        ts.isVariableDeclarationList(list) &&
        ts.isForOfStatement(list.parent)
      )
        return elementType(this.typeOf(list.parent.expression));
      if (d.initializer !== undefined) return this.typeOf(d.initializer);
      return undefined;
    }
    if (ts.isPropertyAccessExpression(x)) {
      const types = membersNamed(x.name.text, this.sourceFile)
        .map((m) =>
          ts.isMethodDeclaration(m) || ts.isMethodSignature(m)
            ? undefined
            : (m as ts.PropertyDeclaration).type,
        )
        .filter((t): t is ts.TypeNode => t !== undefined);
      return types.length === 1 ? types[0] : undefined;
    }
    if (ts.isElementAccessExpression(x)) return elementType(this.typeOf(x.expression));
    if (ts.isCallExpression(x)) return fileFunction(x, this.sourceFile)?.type;
    return undefined;
  }

  /** Whether `e` may be an object: `false` only where the source shows a value. */
  isObject(e: ts.Expression): boolean {
    const x = bare(e);
    if (this.objects.has(x)) return false;
    this.objects.add(x);
    try {
      return this.isObjectNow(x);
    } finally {
      this.objects.delete(x);
    }
  }
  private readonly objects = new Set<ts.Node>();

  private isObjectNow(x: ts.Expression): boolean {
    if (x.kind === ts.SyntaxKind.ThisKeyword) return true;
    if (ts.isNewExpression(x) || ts.isObjectLiteralExpression(x)) return true;
    if (ts.isArrayLiteralExpression(x)) return true;
    if (ts.isConditionalExpression(x))
      return this.isObject(x.whenTrue) || this.isObject(x.whenFalse);
    if (ts.isIdentifier(x)) {
      const d = this.declOf(x.text, x);
      // A name the function and the file do not declare as a variable is no object variable: a
      // builtin, a namespace, an enum.
      if (d === undefined) return false;
      if (ts.isBindingElement(d)) return this.patternNameIsObject(d);
      const t = this.typeOf(x);
      if (t !== undefined) return writesAnObject(t, this.sourceFile);
      if (ts.isParameter(d)) return true;
      const list = d.parent;
      if (ts.isVariableDeclarationList(list) && ts.isForOfStatement(list.parent)) {
        return this.isObject(list.parent.expression);
      }
      return d.initializer !== undefined && this.isObject(d.initializer);
    }
    if (ts.isPropertyAccessExpression(x)) {
      const members = membersNamed(x.name.text, this.sourceFile);
      // A member no class of the file declares is a builtin's: a swizzle, `length`.
      if (members.length === 0) return false;
      return members.some((m) => {
        if (ts.isMethodDeclaration(m) || ts.isMethodSignature(m)) return false;
        const d = m as ts.PropertyDeclaration;
        if (d.type !== undefined) return writesAnObject(d.type, this.sourceFile);
        return d.initializer !== undefined && this.isObject(d.initializer);
      });
    }
    if (ts.isElementAccessExpression(x)) {
      const t = this.typeOf(x.expression);
      if (t !== undefined) {
        const elem = elementType(t);
        return elem !== undefined && writesAnObject(elem, this.sourceFile);
      }
      return this.isObject(x.expression);
    }
    if (ts.isCallExpression(x)) {
      const callee = fileFunction(x, this.sourceFile);
      if (callee !== undefined)
        return callee.type === undefined || writesAnObject(callee.type, this.sourceFile);
      const local = this.localFunction(x);
      if (local !== undefined)
        return local.type === undefined || writesAnObject(local.type, this.sourceFile);
      if (ts.isPropertyAccessExpression(x.expression)) {
        const name = x.expression.name.text;
        const methods = membersNamed(name, this.sourceFile).filter(
          (m) => ts.isMethodDeclaration(m) || ts.isMethodSignature(m),
        ) as ts.MethodDeclaration[];
        if (methods.length > 0)
          return methods.some(
            (m) => m.type === undefined || writesAnObject(m.type, this.sourceFile),
          );
        // A method of an array: `map` gives what its function gives, `reduce` what it starts
        // from, and any other one that is not known to give a value may give an element.
        if (!this.isObject(x.expression.expression) || VALUE_METHODS.has(name)) return false;
        const f = x.arguments[0] === undefined ? undefined : bare(x.arguments[0]);
        if (name === 'map' && f !== undefined && ts.isArrowFunction(f)) {
          if (f.type !== undefined) return writesAnObject(f.type, this.sourceFile);
          return ts.isBlock(f.body) || this.isObject(f.body);
        }
        if (name === 'reduce' || name === 'reduceRight') {
          const start = x.arguments[1];
          return start === undefined || this.isObject(start);
        }
        return true;
      }
      return false;
    }
    return false;
  }

  /** The names whose object the value of `e` may be or may hold. */
  shares(e: ts.Expression): Shares {
    const out: Shares = new Map();
    const x = bare(e);
    if (x.kind === ts.SyntaxKind.ThisKeyword) {
      out.set('this', { part: false, place: undefined });
      return out;
    }
    if (ts.isIdentifier(x)) {
      if (this.isObject(x)) out.set(x.text, { part: false, place: x });
      return out;
    }
    if (ts.isPropertyAccessExpression(x) || ts.isElementAccessExpression(x)) {
      if (!this.isObject(x)) return out;
      const root = rootOf(x);
      if (root !== undefined) {
        // A getter in the chain may give any object the root holds, so the place is not known.
        if (this.declOf(root.name.text, root.name) !== undefined)
          out.set(root.name.text, {
            part: false,
            place: isPlainPlace(x, this.sourceFile) ? x : undefined,
          });
      } else {
        let at: ts.Expression = x;
        while (ts.isPropertyAccessExpression(at) || ts.isElementAccessExpression(at))
          at = bare(at.expression);
        if (at.kind === ts.SyntaxKind.ThisKeyword)
          out.set('this', { part: false, place: undefined });
        else add(out, this.shares(at));
      }
      return out;
    }
    if (ts.isConditionalExpression(x)) {
      add(out, this.shares(x.whenTrue));
      add(out, this.shares(x.whenFalse));
      return out;
    }
    if (ts.isBinaryExpression(x)) {
      const k = x.operatorToken.kind;
      if (
        k === ts.SyntaxKind.QuestionQuestionToken ||
        k === ts.SyntaxKind.BarBarToken ||
        k === ts.SyntaxKind.AmpersandAmpersandToken
      ) {
        add(out, this.shares(x.left));
        add(out, this.shares(x.right));
      } else if (k === ts.SyntaxKind.CommaToken || k === ts.SyntaxKind.EqualsToken) {
        add(out, this.shares(x.right));
      }
      return out;
    }
    if (ts.isArrayLiteralExpression(x)) {
      for (const el of x.elements) {
        // A spread in a list is refused where it is written (TS8013), which is its one sentence.
        if (ts.isSpreadElement(el)) continue;
        add(out, this.shares(el), true);
      }
      return out;
    }
    if (ts.isObjectLiteralExpression(x)) {
      for (const prop of x.properties) {
        if (ts.isPropertyAssignment(prop)) add(out, this.shares(prop.initializer), true);
        else if (ts.isShorthandPropertyAssignment(prop)) add(out, this.shares(prop.name), true);
        else if (ts.isSpreadAssignment(prop) && this.hasObjectField(prop.expression))
          add(out, this.shares(prop.expression), true);
      }
      return out;
    }
    if (ts.isNewExpression(x)) {
      for (const a of x.arguments ?? []) add(out, this.shares(a), true);
      return out;
    }
    if (ts.isCallExpression(x)) {
      if (!this.isObject(x)) return out;
      const callee = fileFunction(x, this.sourceFile);
      if (callee !== undefined) {
        const s = summaryOf(callee, this.sourceFile);
        for (const i of s.result.keys()) {
          const a = x.arguments[i];
          // The result is the argument's own object only where every `return` names it. In any
          // other case it may be the object or hold it, and is read as the object.
          if (a !== undefined) add(out, this.shares(a), false, s.exact === i);
        }
        return out;
      }
      // A function declared inside this one may give back an argument, or an object it reads
      // from the function around it.
      const local = this.localFunction(x);
      if (local !== undefined) {
        for (const a of x.arguments) add(out, this.shares(a), false, false);
        for (const name of this.outerObjectsOf(local))
          out.set(name, { part: false, place: undefined });
        return out;
      }
      if (ts.isPropertyAccessExpression(x.expression)) {
        const method = x.expression.name.text;
        const receiver = x.expression.expression;
        const ofFile = membersNamed(method, this.sourceFile).length > 0;
        // `xs.slice()` is a new array of the same elements (Table 3).
        const fresh = method === 'slice' && !ofFile;
        if (fresh) {
          const elem = elementType(this.typeOf(receiver));
          if (elem !== undefined && !writesAnObject(elem, this.sourceFile)) return out;
        }
        // A method that returns an object may return its own object, a part of it, or an
        // argument; so may a method of an array that takes a function (`map`, `reduce`). What
        // it gives may be the object a holder it is called on keeps: `new H(a).get()`.
        for (const k of this.shares(receiver).keys()) out.set(k, { part: fresh, place: undefined });
      }
      for (const a of x.arguments) add(out, this.shares(a), false, false);
      return out;
    }
    return out;
  }

  /** The function declared inside this one that a call written `g(...)` names. */
  localFunction(call: ts.CallExpression): ts.FunctionLikeDeclaration | undefined {
    const callee = bare(call.expression);
    if (!ts.isIdentifier(callee)) return undefined;
    const d = this.declOf(callee.text, callee);
    if (d !== undefined && ts.isVariableDeclaration(d) && d.initializer !== undefined) {
      const f = bare(d.initializer);
      if (ts.isArrowFunction(f) || ts.isFunctionExpression(f)) return f;
    }
    for (
      let scope: ts.Node | undefined = callee.parent;
      scope !== undefined;
      scope = scope.parent
    ) {
      if (!ts.isBlock(scope)) continue;
      for (const st of scope.statements) {
        if (ts.isFunctionDeclaration(st) && st.name?.text === callee.text && st.body) return st;
      }
    }
    return undefined;
  }

  /** The object variables of the functions around `local` that its body names. */
  outerObjectsOf(local: ts.FunctionLikeDeclaration): string[] {
    const own = new Set<string>();
    const names = new Set<string>();
    const visit = (n: ts.Node): void => {
      if ((ts.isParameter(n) || ts.isVariableDeclaration(n)) && ts.isIdentifier(n.name))
        own.add(n.name.text);
      if (
        ts.isIdentifier(n) &&
        !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n) &&
        this.isObject(n)
      )
        names.add(n.text);
      ts.forEachChild(n, visit);
    };
    visit(local);
    return [...names].filter((n) => !own.has(n));
  }

  /** Whether the object `e` names has a field that is an object, as far as the source says. */
  private hasObjectField(e: ts.Expression): boolean {
    let t = this.typeOf(e);
    while (t !== undefined && ts.isParenthesizedTypeNode(t)) t = t.type;
    if (t === undefined) return true;
    let members: readonly ts.Node[] | undefined;
    if (ts.isTypeLiteralNode(t)) members = t.members;
    else if (ts.isTypeReferenceNode(t) && ts.isIdentifier(t.typeName)) {
      const name = t.typeName.text;
      for (const st of this.sourceFile.statements) {
        if ((ts.isInterfaceDeclaration(st) || ts.isClassDeclaration(st)) && st.name?.text === name)
          members = st.members;
        if (ts.isTypeAliasDeclaration(st) && st.name.text === name && ts.isTypeLiteralNode(st.type))
          members = st.type.members;
      }
    }
    if (members === undefined) return true;
    return members.some(
      (m) =>
        (ts.isPropertySignature(m) || ts.isPropertyDeclaration(m)) &&
        (m.type === undefined || writesAnObject(m.type, this.sourceFile)),
    );
  }
}

/** A statement that stores into `dest` an object `value` may share. */
interface Store {
  readonly node: ts.Node;
  /** The root name of the place stored into, if it has one. */
  readonly dest: string | undefined;
  /** Whether `dest` names the stored object itself (`q = a`), not an aggregate that holds it. */
  readonly whole: boolean;
  readonly shares: Shares;
  /** A `const` declaration: a write through its name is Rule 6.10's to refuse. */
  readonly isConst: boolean;
}

/** The body's own nodes: a nested function's body is its own. */
function eachOwn(body: ts.Node, visit: (n: ts.Node) => void): void {
  const walk = (n: ts.Node): void => {
    if (n !== body && ts.isFunctionLike(n) && !ts.isArrowFunction(n)) return;
    visit(n);
    ts.forEachChild(n, walk);
  };
  walk(body);
}

/** The result of `callee` named exactly by one argument: the index of the parameter every
 *  `return` of it names, where that parameter is never assigned whole. */
export function returnsItsParameter(
  callee: ts.FunctionDeclaration,
  sourceFile: ts.SourceFile,
): number | undefined {
  return summaryOf(callee, sourceFile).exact;
}

interface Summary {
  /** The parameters the result may be (`false`) or may hold (`true`). */
  readonly result: ReadonlyMap<number, boolean>;
  /** Parameter `from` stored into the object of parameter `into`. */
  readonly into: readonly { readonly from: number; readonly into: number }[];
  readonly exact: number | undefined;
  /** Whether a `return` may give an object of a variable outside the function. */
  readonly outer: boolean;
}
const SUMMARY = new WeakMap<ts.FunctionDeclaration, Summary>();
const SUMMING = new Set<ts.FunctionDeclaration>();
const NOTHING: Summary = { result: new Map(), into: [], exact: undefined, outer: true };

function storesOf(fn: Fn, reader: Reader): Store[] {
  const out: Store[] = [];
  if (fn.body === undefined) return out;
  const sourceFile = reader.sourceFile;
  eachOwn(fn.body, (n) => {
    if (ts.isVariableDeclaration(n) && !ts.isIdentifier(n.name) && n.initializer !== undefined) {
      // `let { c } = b`, `let [p, q] = ps`: each name of the pattern that is an object names an
      // object the initializer holds.
      const list = n.parent;
      const isConst = ts.isVariableDeclarationList(list) && (list.flags & ts.NodeFlags.Const) !== 0;
      const held: Shares = new Map();
      add(held, reader.shares(n.initializer), false, false);
      const each = (pattern: ts.BindingPattern): void => {
        for (const el of pattern.elements) {
          if (ts.isOmittedExpression(el)) continue;
          if (!ts.isIdentifier(el.name)) each(el.name);
          else if (held.size > 0 && reader.isObject(el.name)) {
            const shares: Shares = new Map(
              [...held.keys()].map((k) => [k, { part: false, place: undefined }]),
            );
            out.push({ node: n, dest: el.name.text, whole: true, shares, isConst });
          }
        }
      };
      each(n.name);
      return;
    }
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer !== undefined) {
      const list = n.parent;
      const isConst = ts.isVariableDeclarationList(list) && (list.flags & ts.NodeFlags.Const) !== 0;
      const shares = reader.shares(n.initializer);
      if (shares.size > 0) {
        const whole = [...shares.values()].some((share) => !share.part);
        out.push({ node: n, dest: n.name.text, whole, shares, isConst });
      }
      return;
    }
    if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isArrayLiteralExpression(bare(n.left))
    ) {
      // `[a, b] = [b, a]`: each place takes the value at its position. A list that only puts
      // the same names in another order gives each name one object, as before it.
      const places = (bare(n.left) as ts.ArrayLiteralExpression).elements;
      const right = bare(n.right);
      const values = ts.isArrayLiteralExpression(right) ? right.elements : undefined;
      const text = (es: readonly ts.Expression[]): string[] => es.map((e) => e.getText()).sort();
      const reorders =
        values !== undefined &&
        values.length === places.length &&
        new Set(text(values)).size === values.length &&
        text(values).join('\n') === text(places).join('\n');
      if (reorders) return;
      places.forEach((place, i) => {
        const root = rootOf(place);
        const shares = reader.shares(values?.[i] ?? n.right);
        if (root === undefined || shares.size === 0) return;
        const whole = root.whole && [...shares.values()].some((share) => !share.part);
        out.push({ node: n, dest: root.name.text, whole, shares, isConst: false });
      });
      return;
    }
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const root = rootOf(n.left);
      const shares = reader.shares(n.right);
      if (root !== undefined && shares.size > 0) {
        const whole = root.whole && [...shares.values()].some((share) => !share.part);
        out.push({ node: n, dest: root.name.text, whole, shares, isConst: false });
      }
      return;
    }
    if (ts.isCallExpression(n)) {
      const callee = fileFunction(n, sourceFile);
      if (callee !== undefined) {
        for (const { from, into } of summaryOf(callee, sourceFile).into) {
          const a = n.arguments[from];
          const b = n.arguments[into];
          const root = b === undefined ? undefined : rootOf(b);
          if (a === undefined || root === undefined) continue;
          const shares = reader.shares(a);
          if (shares.size > 0)
            out.push({ node: n, dest: root.name.text, whole: false, shares, isConst: false });
        }
        return;
      }
      // A function declared inside this one may keep an argument in an object of the function
      // around it that its body names.
      const local = reader.localFunction(n);
      if (local !== undefined) {
        const shares: Shares = new Map();
        for (const a of n.arguments) add(shares, reader.shares(a), true);
        if (shares.size > 0) {
          for (const dest of reader.outerObjectsOf(local)) {
            if (!shares.has(dest))
              out.push({ node: n, dest, whole: false, shares, isConst: false });
          }
        }
        return;
      }
      // `xs.push(p)`, `xs.fill(p)` and a method of the file that writes its object may keep an
      // argument in it.
      if (ts.isPropertyAccessExpression(n.expression)) {
        const method = n.expression.name.text;
        const root = rootOf(n.expression.expression);
        if (
          root !== undefined &&
          (ARRAY_MUTATORS.has(method) || methodWritesThis(method, sourceFile))
        ) {
          const shares: Shares = new Map();
          for (const a of n.arguments) add(shares, reader.shares(a), true);
          if (shares.size > 0)
            out.push({ node: n, dest: root.name.text, whole: false, shares, isConst: false });
        }
      }
    }
  });
  return out;
}

function summaryOf(fn: ts.FunctionDeclaration, sourceFile: ts.SourceFile): Summary {
  const known = SUMMARY.get(fn);
  if (known !== undefined) return known;
  if (SUMMING.has(fn) || fn.body === undefined) return NOTHING;
  SUMMING.add(fn);
  const reader = new Reader(fn, sourceFile);
  const params = fn.parameters.map((p) => (ts.isIdentifier(p.name) ? p.name.text : ''));
  // What each name holds, through every store of the body.
  const holds = new Map<string, Shares>();
  const stores = storesOf(fn, reader);
  for (const s of stores) {
    if (s.dest === undefined) continue;
    const h: Shares = holds.get(s.dest) ?? new Map();
    add(h, s.shares, !s.whole);
    holds.set(s.dest, h);
  }
  const close = (start: Shares): Shares => {
    const all: Shares = new Map(start);
    for (let grew = true; grew;) {
      grew = false;
      for (const [name, share] of [...all]) {
        for (const [inner, innerShare] of holds.get(name) ?? []) {
          const part = share.part || innerShare.part;
          const had = all.get(inner);
          if (had === undefined || (had.part && !part)) {
            all.set(inner, { part, place: undefined });
            grew = true;
          }
        }
      }
    }
    return all;
  };
  const result = new Map<number, boolean>();
  // The variables the body declares: a name that is none of them, and no parameter, is a
  // variable of the file or `this`.
  const inside = new Set<string>();
  eachOwn(fn.body, (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) inside.add(n.name.text);
  });
  let outer = false;
  let exact: number | undefined;
  let exactly = true;
  let returns = 0;
  eachOwn(fn.body, (n) => {
    if (!ts.isReturnStatement(n) || n.expression === undefined) return;
    returns++;
    const value = bare(n.expression);
    const direct = ts.isIdentifier(value) ? params.indexOf(value.text) : -1;
    if (direct < 0 || (exact !== undefined && exact !== direct)) exactly = false;
    else exact = direct;
    for (const [name, share] of close(reader.shares(n.expression))) {
      const i = params.indexOf(name);
      if (i < 0 && !inside.has(name)) outer = true;
      if (i < 0) continue;
      const had = result.get(i);
      result.set(i, had === undefined ? share.part : had && share.part);
    }
  });
  if (exact !== undefined && exactly && returns > 0) {
    // A parameter the body assigns whole, or declares again, names another object by then.
    const name = params[exact]!;
    eachOwn(fn.body, (n) => {
      for (const target of writeTargets(n)) {
        const root = rootOf(target);
        if (root !== undefined && root.whole && root.name.text === name) exactly = false;
      }
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name)
        exactly = false;
    });
  }
  const into: { from: number; into: number }[] = [];
  params.forEach((dest, j) => {
    if (dest === '') return;
    for (const name of close(holds.get(dest) ?? new Map()).keys()) {
      const i = params.indexOf(name);
      if (i >= 0 && i !== j) into.push({ from: i, into: j });
    }
  });
  const summary: Summary = {
    result,
    into,
    exact: exactly && result.size > 0 ? exact : undefined,
    outer,
  };
  SUMMING.delete(fn);
  SUMMARY.set(fn, summary);
  return summary;
}

/** A store the compiler cannot make as a copy: `node` is where, `held` the name whose object is
 *  stored, `dest` the name that would hold it, `written` the one something writes after. */
export interface SharedObject {
  readonly node: ts.Node;
  readonly held: string;
  readonly dest: string | undefined;
  readonly written: string;
  /** Whether `dest` would name the object itself, not an aggregate that holds it. */
  readonly whole: boolean;
  /** The whole sentence, where the store is none of the shapes the other fields word. */
  readonly text?: string;
}

/** The loops around `n`, inside `body`. */
function loopsAround(n: ts.Node, body: ts.Node): ts.Node[] {
  const out: ts.Node[] = [];
  for (let at: ts.Node | undefined = n.parent; at !== undefined && at !== body; at = at.parent) {
    if (ts.isIterationStatement(at, false)) out.push(at);
  }
  return out;
}

const within = (n: ts.Node, outer: ts.Node): boolean =>
  n.getStart() >= outer.getStart() && n.end <= outer.end;

/**
 * The stores of `fn`'s body that make two names of one object where something writes the object
 * afterwards (change 0142). `secondName` says which declarations the lowering binds as a second
 * name of their initializer, so they are no copy.
 */
export function sharedObjects(fn: Fn, sourceFile: ts.SourceFile): SharedObject[] {
  const cached = SHARED.get(fn);
  if (cached !== undefined) return cached;
  const out: SharedObject[] = [];
  SHARED.set(fn, out);
  const body = fn.body;
  if (body === undefined) return out;
  const reader = new Reader(fn, sourceFile);
  const stores = storesOf(fn, reader);
  const params = new Set(
    fn.parameters.flatMap((p) => (ts.isIdentifier(p.name) ? [p.name.text] : [])),
  );
  // Every write of a field or an element in the body and in the functions inside it, by the name
  // at its root, with whether the object written is a part of what the name holds; and every
  // mention of a name. A write in a function inside the body runs when that function is called,
  // which may be after any statement.
  const writes: {
    name: string;
    node: ts.Node;
    deep: boolean;
    /** The place written, where the write is through the name itself, and whether the write
     *  puts another value there (an assignment) or changes the object at the place (a method, a
     *  function that writes its parameter). */
    place: ts.Expression | undefined;
    replaces: boolean;
    anytime: boolean;
  }[] = [];
  const mentions: { name: string; node: ts.Node; anytime: boolean }[] = [];
  const calls: SharedObject[] = [];
  const declared = new Map<string, ts.Node>();
  // The object a name is a second name of: `const q = p`, `let b = f(a)`, and the array a
  // `for (const q of ps)` names an element of. A write through the name writes that object.
  const namedFrom = new Map<string, Set<string>>();
  const nameFrom = (name: string, root: string): void => {
    const roots = namedFrom.get(name) ?? new Set<string>();
    roots.add(root);
    namedFrom.set(name, roots);
  };
  const through = (name: string): { name: string; derived: boolean }[] => {
    // Two variables of one name in two blocks are read as one, which names every object either
    // may name.
    const all = [{ name, derived: false }];
    const seen = new Set([name]);
    for (const at of all) {
      for (const root of namedFrom.get(at.name) ?? []) {
        if (seen.has(root)) continue;
        seen.add(root);
        all.push({ name: root, derived: true });
      }
    }
    return all;
  };
  const noteWrite = (
    place: ts.Expression,
    node: ts.Node,
    replaces: boolean,
    anytime: boolean,
    deepAlways = false,
  ): void => {
    // A write to a field of `this` is a write of the method's own object.
    let rootName = rootOf(place)?.name.text;
    if (rootName === undefined) {
      let end = bare(place);
      while (ts.isPropertyAccessExpression(end) || ts.isElementAccessExpression(end))
        end = bare(end.expression);
      if (end.kind === ts.SyntaxKind.ThisKeyword && end !== bare(place)) rootName = 'this';
    }
    if (rootName === undefined) return;
    // The object written is the one that holds the last field or element: a part of what the
    // name holds when a field or an element that is an object stands between them.
    let deep = deepAlways;
    let at = bare(place);
    while (!deep && (ts.isPropertyAccessExpression(at) || ts.isElementAccessExpression(at))) {
      at = bare(at.expression);
      if (!ts.isIdentifier(at) && reader.isObject(at)) deep = true;
    }
    for (const via of through(rootName)) {
      writes.push({
        name: via.name,
        node,
        deep: deep || via.derived,
        place: via.derived || !isPlainPlace(place, sourceFile) ? undefined : place,
        replaces: via.derived ? false : replaces,
        anytime,
      });
    }
  };
  const names = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) {
      if (!declared.has(n.name.text)) declared.set(n.name.text, n);
      if (n.initializer !== undefined) {
        const init = bare(n.initializer);
        const from = ts.isIdentifier(init) ? init : aliasedCall(n, sourceFile)?.argument;
        if (from !== undefined && reader.isObject(from)) nameFrom(n.name.text, from.text);
      }
    }
    if (ts.isForOfStatement(n) && ts.isVariableDeclarationList(n.initializer)) {
      const d = n.initializer.declarations[0];
      const root = rootOf(n.expression);
      if (
        d !== undefined &&
        ts.isIdentifier(d.name) &&
        root !== undefined &&
        reader.isObject(d.name)
      )
        nameFrom(d.name.text, root.name.text);
    }
    ts.forEachChild(n, names);
  };
  names(body);
  const collect = (n: ts.Node, anytime: boolean): void => {
    const inner = anytime || (n !== body && ts.isFunctionLike(n));
    if (ts.isIdentifier(n)) {
      for (const via of through(n.text)) mentions.push({ name: via.name, node: n, anytime: inner });
    }
    for (const target of writeTargets(n)) {
      const root = rootOf(target);
      if (root === undefined || !root.whole) noteWrite(target, n, true, inner);
    }
    if (ts.isCallExpression(n)) {
      if (ts.isPropertyAccessExpression(n.expression)) {
        const method = n.expression.name.text;
        const object = n.expression.expression;
        if (ARRAY_MUTATORS.has(method))
          noteWrite(object, n, false, inner, !ts.isIdentifier(bare(object)));
        else if (methodWritesThis(method, sourceFile)) noteWrite(object, n, false, inner, true);
      }
      const callee = fileFunction(n, sourceFile);
      if (callee !== undefined) {
        n.arguments.forEach((a, i) => {
          const q = callee.parameters[i];
          if (q !== undefined && takesThePlace(q, sourceFile)) noteWrite(a, n, false, inner, true);
        });
        // One object handed twice, where the callee writes one of the two and one argument is
        // no plain place (`w(a, id(a))`, `w(k.c, k.get())`, `g(a, [a])`): the check of two
        // places of one root (`TS8074`) does not see it.
        const namesOf = (a: ts.Expression): Set<string> => {
          const all = new Set(reader.shares(a).keys());
          const root = rootOf(a);
          if (root !== undefined) all.add(root.name.text);
          return all;
        };
        n.arguments.forEach((a, i) => {
          const q = callee.parameters[i];
          if (q === undefined || !takesThePlace(q, sourceFile)) return;
          const mine = namesOf(a);
          n.arguments.forEach((b, j) => {
            if (j === i) return;
            // Two plain places of one root are `TS8074`'s to pair on the lowered call, but for a
            // parameter that may be absent, whose argument the lowering wraps.
            const absent = (t: ts.TypeNode | undefined): boolean =>
              t !== undefined && ts.isUnionTypeNode(t);
            if (
              isPlainPlace(a, sourceFile) &&
              isPlainPlace(b, sourceFile) &&
              !absent(q.type) &&
              !absent(callee.parameters[j]?.type)
            )
              return;
            const shared = [...namesOf(b)].find((name) => mine.has(name));
            if (shared === undefined) return;
            calls.push({
              node: n,
              held: shared,
              dest: undefined,
              written: shared,
              whole: true,
              text:
                `This call hands the object "${shared}" names to "${callee.name?.text ?? ''}" ` +
                `twice, and "${callee.name?.text ?? ''}" writes one of the two: one object ` +
                `under two names, which is not supported yet (change 0142, stage 2). Pass two ` +
                `objects, or give the function one parameter for it.`,
            });
          });
        });
      }
    }
    ts.forEachChild(n, (c) => collect(c, inner));
  };
  collect(body, false);
  const said = new Set<ts.Node>();
  for (const c of calls) {
    if (said.has(c.node)) continue;
    said.add(c.node);
    out.push(c);
  }
  // What each name holds, through every store of the body: a name that holds a name that holds
  // an object holds that object.
  const holds = new Map<string, Set<string>>();
  for (const s of stores) {
    if (s.dest === undefined) continue;
    const h = holds.get(s.dest) ?? new Set<string>();
    for (const k of s.shares.keys()) h.add(k);
    holds.set(s.dest, h);
  }
  const heldBy = (first: Iterable<string>): string[] => {
    const all = new Set(first);
    for (const name of all) {
      for (const inner of holds.get(name) ?? []) all.add(inner);
      for (const root of namedFrom.get(name) ?? []) all.add(root);
    }
    return [...all];
  };
  /** Whether `node` runs after the store `at` while both names still hold the object: it is
   *  written after the store, or a loop holds both and each of `names` lives across its turns. A
   *  name declared in the loop is a new variable at each turn. */
  const after = (
    node: ts.Node,
    anytime: boolean,
    at: ts.Node,
    ...living: (string | undefined)[]
  ): boolean => {
    // The store's own write is the store. Any other write inside the storing statement may run
    // after the object is taken: `new B(a, bump(a))`.
    if (node === at) return false;
    if (within(node, at)) return true;
    if (anytime || node.getStart() >= at.end) return true;
    const lives = (loop: ts.Node): boolean =>
      living.every((name) => {
        const decl = name === undefined ? undefined : declared.get(name);
        return decl === undefined || !within(decl, loop);
      });
    return loopsAround(at, body).some((loop) => within(node, loop) && lives(loop));
  };
  /** Whether the second name of the store reads, after the write, the part the write changes.
   *  `const p = ps[i]; ps[i].pos = v; … p.tag` reads a field the write left as it was, so a copy
   *  has JavaScript's result. A name used whole, or a write whose place is not known, reads it. */
  const readsWhatIsWritten = (
    s: Store,
    place: ts.Expression | undefined,
    w: (typeof writes)[number],
  ): boolean => {
    if (!s.whole || s.dest === undefined || place === undefined || w.place === undefined)
      return true;
    if (!isPlainPlace(place, sourceFile) || !isPlainPlace(w.place, sourceFile)) return true;
    const suffix = stepsOf(w.place).slice(stepsOf(place).length);
    if (suffix.length === 0) return true;
    return mentions.some((m) => {
      if (m.name !== s.dest || m.node === s.node) return false;
      if (within(m.node, s.node)) return false;
      // A read inside the writing statement itself runs before the write.
      if (within(m.node, w.node)) return false;
      if (!after(m.node, m.anytime, w.node, s.dest)) return false;
      // The place read through the name: `p.tag` for the `p` of `p.tag`.
      let read: ts.Node = m.node;
      while (
        (ts.isPropertyAccessExpression(read.parent) || ts.isElementAccessExpression(read.parent)) &&
        read.parent.expression === read
      ) {
        // A getter, a method and a builtin's member read the object whole.
        if (
          ts.isPropertyAccessExpression(read.parent) &&
          !isField(read.parent.name.text, sourceFile)
        )
          return true;
        read = read.parent;
      }
      const steps = stepsOf(read as ts.Expression);
      for (let i = 0; i < Math.min(steps.length, suffix.length); i++) {
        const a = steps[i];
        const b = suffix[i];
        if (typeof a === 'string' || typeof b === 'string') {
          if (a !== b) return false;
        } else if (a !== undefined && b !== undefined && a !== b) return false;
      }
      return true;
    });
  };
  for (const s of stores) {
    // `const q = p`, `let q = p`: the lowering binds `q` as a second name, or refuses it.
    const named = ts.isVariableDeclaration(s.node) && ts.isIdentifier(s.node.name);
    if (named && ts.isIdentifier(bare((s.node as ts.VariableDeclaration).initializer!))) continue;
    if (named && aliasedCall(s.node as ts.VariableDeclaration, sourceFile) !== undefined) continue;
    const direct = new Set(s.shares.keys());
    for (const held of heldBy(direct)) {
      if (held === s.dest && !direct.has(held)) continue;
      const place = direct.has(held) ? s.shares.get(held)?.place : undefined;
      const heldWrite = writes.find(
        (w) =>
          w.name === held &&
          after(w.node, w.anytime, s.node, held, s.dest) &&
          (w.place === undefined || mayChange(w.place, place, w.replaces)) &&
          readsWhatIsWritten(s, place, w),
      );
      if (heldWrite !== undefined) {
        out.push({ node: s.node, held, dest: s.dest, written: held, whole: s.whole });
        break;
      }
      // A write through a `const` that names the object itself is Rule 6.10's to refuse; a
      // `const` that holds the object in a field or an element is written like any holder.
      if (s.dest === undefined || (s.isConst && s.whole)) continue;
      const dest = s.dest;
      const destWrite = writes.find(
        (w) =>
          w.name === dest && (s.whole || w.deep) && after(w.node, w.anytime, s.node, held, dest),
      );
      if (destWrite === undefined) continue;
      // Another name that holds the same object sees the write too: `let [p, q] = [a, a]`.
      const others = stores.flatMap((o) =>
        o.dest !== undefined && o.dest !== dest && o.shares.has(held) ? [o.dest] : [],
      );
      // An object one value holds at two places, or one that another holder keeps, is seen
      // through the other place whether or not a name of it is written again.
      const seen =
        params.has(held) ||
        held === 'this' ||
        s.shares.get(held)?.twice === true ||
        others.length > 0 ||
        mentions.some(
          (m) =>
            (m.name === held || others.includes(m.name)) &&
            after(m.node, m.anytime, s.node, held, dest),
        );
      if (seen) {
        out.push({ node: s.node, held, dest, written: dest, whole: s.whole });
        break;
      }
    }
  }
  return out;
}
const SHARED = new WeakMap<Fn, SharedObject[]>();

/** `let b = f(a)` where `f` returns its parameter and `a` is a name: the argument `b` is a second
 *  name of, and the call. */
export function aliasedCall(
  decl: ts.VariableDeclaration,
  sourceFile: ts.SourceFile,
): { readonly argument: ts.Identifier; readonly call: ts.CallExpression } | undefined {
  if (decl.initializer === undefined) return undefined;
  const call = bare(decl.initializer);
  if (!ts.isCallExpression(call)) return undefined;
  const callee = fileFunction(call, sourceFile);
  if (callee === undefined) return undefined;
  const exact = summaryOf(callee, sourceFile).exact;
  const a = exact === undefined ? undefined : call.arguments[exact];
  if (a === undefined) return undefined;
  const argument = bare(a);
  return ts.isIdentifier(argument) ? { argument, call } : undefined;
}

/** The names whose object the value of `e` may be or may hold, read in the function `fn`. */
export function namesShared(
  e: ts.Expression,
  fn: ts.SignatureDeclaration | undefined,
  sourceFile: ts.SourceFile,
): string[] {
  const owner = fn !== undefined && ts.isFunctionLike(fn) ? (fn as Fn) : undefined;
  return [...new Reader(owner, sourceFile).shares(e).keys()];
}

/** A name that stops naming the caller's object: `node` assigns the object parameter or the loop
 *  name `name` whole after the body wrote the object it named until then. From that assignment
 *  on the name is a local (Rule 8.8), which the compiler does not yet keep apart from the
 *  caller's object before it. */
export interface ReassignedObject {
  readonly node: ts.Node;
  readonly name: string;
  /** For a loop name: the array the loop reads, which `node` writes inside the loop. */
  readonly array?: string;
}

export function reassignedObjects(fn: Fn, sourceFile: ts.SourceFile): ReassignedObject[] {
  const cached = REASSIGNED.get(fn);
  if (cached !== undefined) return cached;
  const out: ReassignedObject[] = [];
  REASSIGNED.set(fn, out);
  const body = fn.body;
  if (body === undefined) return out;
  const reader = new Reader(fn, sourceFile);
  const candidates: { name: string; scope: ts.Node }[] = [];
  for (const p of fn.parameters) {
    if (ts.isIdentifier(p.name) && writesAnObject(p.type, sourceFile))
      candidates.push({ name: p.name.text, scope: body });
  }
  eachOwn(body, (n) => {
    if (ts.isForOfStatement(n) && ts.isVariableDeclarationList(n.initializer)) {
      const d = n.initializer.declarations[0];
      if (d !== undefined && ts.isIdentifier(d.name) && reader.isObject(d.name))
        candidates.push({ name: d.name.text, scope: n.statement });
    }
  });
  // `for (const e of xs)` reads `xs` once, and names each element as the loop finds it. A body
  // that assigns the array or a holder of it (`xs = …`, `h.ps = …` in a loop over `h.ps`)
  // changes which array the loop should read. Over objects, a body that puts another object at
  // an element, or hands the array to a function or a method that writes it, changes which
  // object the name should be. The compiler follows neither.
  const rootNameOf = (e: ts.Expression): string | undefined => {
    let at = bare(e);
    while (ts.isPropertyAccessExpression(at) || ts.isElementAccessExpression(at))
      at = bare(at.expression);
    if (at.kind === ts.SyntaxKind.ThisKeyword) return 'this';
    return ts.isIdentifier(at) ? at.text : undefined;
  };
  eachOwn(body, (n) => {
    if (!ts.isForOfStatement(n) || !ts.isVariableDeclarationList(n.initializer)) return;
    const d = n.initializer.declarations[0];
    const array = rootNameOf(n.expression);
    if (d === undefined || !ts.isIdentifier(d.name) || array === undefined) return;
    const objects = reader.isObject(d.name);
    const path = stepsOf(n.expression);
    let replaced: ts.Node | undefined;
    const scan = (m: ts.Node): void => {
      if (replaced !== undefined) return;
      if (ts.isBinaryExpression(m) && m.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        for (const target of writeTargets(m)) {
          if (rootNameOf(target) !== array) continue;
          const steps = stepsOf(target);
          // The array itself, or a holder on the way to it: the target's steps begin the
          // array's steps.
          const holder =
            steps.length <= path.length &&
            steps.every(
              (step, k) => step === undefined || path[k] === undefined || step === path[k],
            );
          // An element of the array, whole.
          const element = objects && steps.length === path.length + 1;
          if (holder || element) replaced = m;
        }
      }
      if (ts.isCallExpression(m)) {
        const callee = fileFunction(m, sourceFile);
        m.arguments.forEach((a, i) => {
          const q = callee?.parameters[i];
          if (q !== undefined && takesThePlace(q, sourceFile) && rootNameOf(a) === array)
            replaced = m;
        });
        // A method that writes its object, called on the array's holder.
        if (
          ts.isPropertyAccessExpression(m.expression) &&
          rootNameOf(m.expression.expression) === array &&
          methodWritesThis(m.expression.name.text, sourceFile) &&
          (objects || path.length > 0)
        )
          replaced = m;
      }
      ts.forEachChild(m, scan);
    };
    scan(n.statement);
    if (replaced !== undefined)
      out.push({ node: replaced, name: d.name.text, array: n.expression.getText(sourceFile) });
  });
  for (const { name, scope } of candidates) {
    const w = objectWrites(name, scope, sourceFile);
    for (const whole of w.wholeAt) {
      const before = w.memberAt.some(
        (m) =>
          m.getStart() < whole.getStart() ||
          loopsAround(whole, scope).some((loop) => within(m, loop)),
      );
      if (before) out.push({ node: whole, name });
    }
  }
  return out;
}
const REASSIGNED = new WeakMap<Fn, ReassignedObject[]>();

/** Whether every `return` of `callee` gives an object the function built: no parameter, no part
 *  of one, and no object of a variable outside it. */
export function returnsWhatItBuilt(
  callee: ts.FunctionDeclaration,
  sourceFile: ts.SourceFile,
): boolean {
  const s = summaryOf(callee, sourceFile);
  return s.result.size === 0 && !s.outer;
}
