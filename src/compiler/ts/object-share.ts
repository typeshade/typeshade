// ═══ One object under two names (change 0142, Tables 1 and 3) ═══
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
  rootOf,
  takesThePlace,
  writeTarget,
  writesAnObject,
} from './object-reference.js';

type Fn = ts.FunctionLikeDeclaration;

/** The names whose object a value may be or may hold, each with whether the value only holds it
 *  (`part`: a part of a new aggregate) or may be the object itself, and the place that is the
 *  object where the value is exactly one place of the name. */
interface Share {
  readonly part: boolean;
  readonly place: ts.Expression | undefined;
}
type Shares = Map<string, Share>;

const add = (into: Shares, from: Shares, asPart = false, keepPlace = true): void => {
  for (const [k, share] of from) {
    const part = share.part || asPart;
    const had = into.get(k);
    into.set(
      k,
      had === undefined
        ? { part, place: asPart || !keepPlace ? undefined : share.place }
        : { part: had.part && part, place: undefined },
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

/** The element type an array type is written with. */
function elementType(type: ts.TypeNode | undefined): ts.TypeNode | undefined {
  let at = type;
  while (at !== undefined && ts.isParenthesizedTypeNode(at)) at = at.type;
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

  /** The declaration of the variable or parameter `name` in the function, or in the file. */
  private declOf(
    name: string,
  ): ts.ParameterDeclaration | ts.VariableDeclaration | ts.BindingElement | undefined {
    let found: ts.ParameterDeclaration | ts.VariableDeclaration | ts.BindingElement | undefined;
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
      const d = this.declOf(x.text);
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
      const d = this.declOf(x.text);
      // A name the function and the file do not declare as a variable is no object variable: a
      // builtin, a namespace, an enum.
      if (d === undefined || ts.isBindingElement(d)) return false;
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
      if (ts.isPropertyAccessExpression(x.expression)) {
        const methods = membersNamed(x.expression.name.text, this.sourceFile).filter(
          (m) => ts.isMethodDeclaration(m) || ts.isMethodSignature(m),
        ) as ts.MethodDeclaration[];
        return methods.some((m) => m.type === undefined || writesAnObject(m.type, this.sourceFile));
      }
      return false;
    }
    return false;
  }

  /** The names whose object the value of `e` may be or may hold. */
  shares(e: ts.Expression): Shares {
    const out: Shares = new Map();
    const x = bare(e);
    if (ts.isIdentifier(x)) {
      if (this.isObject(x)) out.set(x.text, { part: false, place: x });
      return out;
    }
    if (ts.isPropertyAccessExpression(x) || ts.isElementAccessExpression(x)) {
      if (!this.isObject(x)) return out;
      const root = rootOf(x);
      if (root !== undefined) {
        if (this.declOf(root.name.text) !== undefined)
          out.set(root.name.text, { part: false, place: x });
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
        for (const [i, part] of s.result) {
          const a = x.arguments[i];
          // The result is the argument's own object only where every `return` names it.
          if (a !== undefined) add(out, this.shares(a), part, s.exact === i);
        }
        return out;
      }
      // A method that returns an object may return its own object, a part of it, or an argument.
      if (ts.isPropertyAccessExpression(x.expression)) {
        const method = x.expression.name.text;
        // `xs.slice()` is a new array of the same elements (Table 3).
        const fresh = method === 'slice' && membersNamed(method, this.sourceFile).length === 0;
        if (fresh) {
          const elem = elementType(this.typeOf(x.expression.expression));
          if (elem !== undefined && !writesAnObject(elem, this.sourceFile)) return out;
        }
        add(out, this.shares(x.expression.expression), fresh, false);
      }
      for (const a of x.arguments) add(out, this.shares(a), false, false);
      return out;
    }
    return out;
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
}
const SUMMARY = new WeakMap<ts.FunctionDeclaration, Summary>();
const SUMMING = new Set<ts.FunctionDeclaration>();
const NOTHING: Summary = { result: new Map(), into: [], exact: undefined };

function storesOf(fn: Fn, reader: Reader): Store[] {
  const out: Store[] = [];
  if (fn.body === undefined) return out;
  const sourceFile = reader.sourceFile;
  eachOwn(fn.body, (n) => {
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
      if (i < 0) continue;
      const had = result.get(i);
      result.set(i, had === undefined ? share.part : had && share.part);
    }
  });
  if (exact !== undefined && exactly && returns > 0) {
    // A parameter the body assigns whole, or declares again, names another object by then.
    const name = params[exact]!;
    eachOwn(fn.body, (n) => {
      const target = writeTarget(n);
      const root = target === undefined ? undefined : rootOf(target);
      if (root !== undefined && root.whole && root.name.text === name) exactly = false;
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
  if (stores.length === 0) return out;
  const params = new Set(
    fn.parameters.flatMap((p) => (ts.isIdentifier(p.name) ? [p.name.text] : [])),
  );
  // Every write of a field or an element in the body, by the name at its root, with whether the
  // object written is a part of what the name holds; and every mention of a name.
  const writes: {
    name: string;
    node: ts.Node;
    deep: boolean;
    /** The place written, and whether the write puts another value there (an assignment) or
     *  changes the object at the place (a method, a function that writes its parameter). */
    place: ts.Expression;
    replaces: boolean;
  }[] = [];
  const mentions: { name: string; node: ts.Node }[] = [];
  const declared = new Map<string, ts.Node>();
  const noteWrite = (
    place: ts.Expression,
    node: ts.Node,
    replaces: boolean,
    deepAlways = false,
  ): void => {
    const root = rootOf(place);
    if (root === undefined) return;
    // The object written is the one that holds the last field or element: a part of what the
    // name holds when a field or an element that is an object stands between them.
    let deep = deepAlways;
    let at = bare(place);
    while (!deep && (ts.isPropertyAccessExpression(at) || ts.isElementAccessExpression(at))) {
      at = bare(at.expression);
      if (!ts.isIdentifier(at) && reader.isObject(at)) deep = true;
    }
    writes.push({ name: root.name.text, node, deep, place, replaces });
  };
  eachOwn(body, (n) => {
    if (ts.isIdentifier(n)) mentions.push({ name: n.text, node: n });
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && !declared.has(n.name.text))
      declared.set(n.name.text, n);
    const target = writeTarget(n);
    if (target !== undefined) {
      const root = rootOf(target);
      if (root !== undefined && !root.whole) noteWrite(target, n, true);
    }
    if (ts.isCallExpression(n)) {
      if (ts.isPropertyAccessExpression(n.expression)) {
        const method = n.expression.name.text;
        const object = n.expression.expression;
        if (ARRAY_MUTATORS.has(method)) noteWrite(object, n, false, !ts.isIdentifier(bare(object)));
        else if (methodWritesThis(method, sourceFile)) noteWrite(object, n, false, true);
      }
      const callee = fileFunction(n, sourceFile);
      if (callee !== undefined) {
        n.arguments.forEach((a, i) => {
          const q = callee.parameters[i];
          if (q !== undefined && takesThePlace(q, sourceFile) && rootOf(a) !== undefined) {
            noteWrite(a, n, false, true);
          }
        });
      }
    }
  });
  /** Whether `node` runs after the store `at` while both names still hold the object: it is
   *  written after the store, or a loop holds both and each of `names` lives across its turns. A
   *  name declared in the loop is a new variable at each turn. */
  const after = (node: ts.Node, at: ts.Node, ...names: (string | undefined)[]): boolean => {
    if (within(node, at)) return false;
    if (node.getStart() >= at.end) return true;
    const lives = (loop: ts.Node): boolean =>
      names.every((name) => {
        const decl = name === undefined ? undefined : declared.get(name);
        return decl === undefined || !within(decl, loop);
      });
    return loopsAround(at, body).some((loop) => within(node, loop) && lives(loop));
  };
  for (const s of stores) {
    // `const q = p`, `let q = p`: the lowering binds `q` as a second name, or refuses it.
    if (ts.isVariableDeclaration(s.node) && ts.isIdentifier(bare(s.node.initializer!))) continue;
    if (ts.isVariableDeclaration(s.node) && aliasedCall(s.node, sourceFile) !== undefined) continue;
    for (const held of s.shares.keys()) {
      const place = s.shares.get(held)?.place;
      const heldWrite = writes.find(
        (w) =>
          w.name === held &&
          after(w.node, s.node, held, s.dest) &&
          mayChange(w.place, place, w.replaces),
      );
      if (heldWrite !== undefined) {
        out.push({ node: s.node, held, dest: s.dest, written: held, whole: s.whole });
        break;
      }
      if (s.dest === undefined || s.isConst) continue;
      const dest = s.dest;
      const destWrite = writes.find(
        (w) => w.name === dest && (s.whole || w.deep) && after(w.node, s.node, held, dest),
      );
      if (destWrite === undefined) continue;
      const seen =
        params.has(held) ||
        held === 'this' ||
        mentions.some((m) => m.name === held && after(m.node, s.node, held, dest));
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
