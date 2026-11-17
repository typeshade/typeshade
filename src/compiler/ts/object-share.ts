// ═══ One object under two names (change 0142, Amendment A3) ═══
//
// Implements: Rule 8.8, Rule 8.25 (docs/language-design.md; traced in reqs/).
//
// An object has the identity a JavaScript object has. Two rules of Amendment A3 are read here, on
// the source of one function, because one statement does not show them:
//
//   2. A store is a move. A statement that puts an object that has a name into another holder is
//      accepted only where the object is a local of the function that the function does not use
//      after the statement (`sharedObjects`).
//   5. A place that a second name names must stay that place while the name is read
//      (`sharedObjects`).
//
// Rule 4 reads the function around a declaration (`objectWrittenAround`). Rule 1 is the lowering's
// (`lower/second-name.ts`), and rule 3 is `new-object.ts`. A type is read as the lowering gave it,
// where it lowered the expression, and as the source writes it elsewhere (`source-types.ts`): a
// name whose type the source does not show is read as an object, so these rules refuse more than
// they must and never less (Rule 12.7).

import ts from 'typescript';
import {
  ARRAY_MUTATORS,
  bare,
  fileFunction,
  methodWritesThis,
  namesOfOneObject,
  objectWrites,
  rootOf,
  takesThePlace,
  writeTargets,
  writesAnObject,
} from './object-reference.js';
import type { ShaderType } from '../../core/ir/types.js';
import { aliasedCall, isObjectType, newObject } from './new-object.js';
import {
  Reader,
  eachOwn,
  isPlainPlace,
  isPropertyName,
  isStatement,
  loopsAround,
  membersNamed,
  within,
} from './source-types.js';

type Fn = ts.FunctionLikeDeclaration;

/** A step of a place from its root: a field's name, an element's literal index, or `undefined`
 *  for an index that is no literal. */
type Step = string | number | undefined;

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

/** The identifiers in `region` that read or write the variable `decl` declares. */
export function usesOfDeclared(
  decl: ts.VariableDeclaration,
  region: ts.Node,
  sourceFile: ts.SourceFile,
): ts.Identifier[] {
  const out: ts.Identifier[] = [];
  const reader = new Reader(sourceFile);
  const name = (decl.name as ts.Identifier).text;
  const walk = (n: ts.Node): void => {
    if (
      ts.isIdentifier(n) &&
      n.text === name &&
      !isPropertyName(n) &&
      reader.declOf(name, n) === decl
    )
      out.push(n);
    ts.forEachChild(n, walk);
  };
  walk(region);
  return out;
}

// ─── Rule 4: a write of an object around a declaration ───

/** Whether the function around `decl` writes an object after it, or in a loop that holds it, or
 *  in a function inside it (rule 4): an assignment or an increment through a field or an element
 *  of an object, a `push` or a `fill`, a method that writes its object, and a call that hands an
 *  object to a parameter its function writes. */
export function objectWrittenAround(decl: ts.Node, sourceFile: ts.SourceFile): boolean {
  let owner: ts.Node = decl;
  while (owner.parent !== undefined && !ts.isFunctionLike(owner)) owner = owner.parent;
  const reader = new Reader(sourceFile);
  const loops: ts.Node[] = [];
  for (let at = decl.parent; at !== undefined && at !== owner; at = at.parent)
    if (ts.isIterationStatement(at, false)) loops.push(at);
  const intoObject = (t: ts.Expression): boolean => {
    for (let at = bare(t); ts.isPropertyAccessExpression(at) || ts.isElementAccessExpression(at);) {
      at = bare(at.expression);
      if (reader.isObject(at)) return true;
    }
    return false;
  };
  let found = false;
  const visit = (n: ts.Node, inner: boolean): void => {
    const within1 = inner || (n !== owner && ts.isFunctionLike(n));
    if (within1 || n.getStart(sourceFile) >= decl.end || loops.some((l) => within(n, l))) {
      if (writeTargets(n).some(intoObject)) found = true;
      if (ts.isCallExpression(n)) {
        if (ts.isPropertyAccessExpression(n.expression)) {
          const method = n.expression.name.text;
          if (ARRAY_MUTATORS.has(method) || methodWritesThis(method, sourceFile)) found = true;
        }
        const callee = fileFunction(n, sourceFile);
        n.arguments.forEach((a, i) => {
          const q = callee?.parameters[i];
          if (q !== undefined && takesThePlace(q, sourceFile) && reader.isObject(a)) found = true;
        });
      }
    }
    ts.forEachChild(n, (c) => visit(c, within1));
  };
  visit(owner, false);
  return found;
}

// ─── Rules 2 and 5: stores and places that must stay ───

/** A statement the compiler refuses, with the sentence that says why (`TS8099`). */
export interface SharedObject {
  readonly node: ts.Node;
  readonly text: string;
  /** `TS8074` for one object handed twice to a call; `TS8099` otherwise. */
  readonly pairing?: true;
}

const ASSIGNS = new Set([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
]);

/** How the use `id` of a name writes the whole name: `'assign'` for `q = r` and `[q, r] = list`,
 *  `'compound'` for `q += r` and `q++`. */
export function wholeWrite(id: ts.Identifier): 'assign' | 'compound' | undefined {
  let at: ts.Node = id.parent;
  while (ts.isParenthesizedExpression(at) || ts.isArrayLiteralExpression(at)) at = at.parent;
  const targets = writeTargets(at);
  if (!targets.some((t) => bare(t) === id)) return undefined;
  return ts.isBinaryExpression(at) && ASSIGNS.has(at.operatorToken.kind) ? 'assign' : 'compound';
}

/** The nearest function around `n`. */
const ownerOf = (n: ts.Node): ts.Node | undefined => {
  let at = n.parent;
  while (at !== undefined && !ts.isFunctionLike(at)) at = at.parent;
  return at;
};

/** The statements of `fn` that store an object that has a name in a second place (rule 2), and
 *  the statements that put another object where a second name still names (rule 5). */
export function sharedObjects(
  fn: Fn,
  sourceFile: ts.SourceFile,
  /** What the lowering found an expression to be, where it lowered it. */
  typeOf: (e: ts.Expression) => ShaderType | undefined = () => undefined,
  /** Whether the source may say what the lowering did not: nothing was refused so far. */
  readSource = true,
): SharedObject[] {
  const out: SharedObject[] = [];
  const body = fn.body;
  if (body === undefined) return out;
  const reader = new Reader(sourceFile, typeOf);
  // What the lowering found; else what the source says, except in a generic body, whose copies
  // are each lowered and read by their own types, and in a body that a refusal cut short. A function inside this one that was not lowered
  // yet is read by its own pass, when it is.
  const generic =
    fn.typeParameters !== undefined ||
    (ts.isClassLike(fn.parent) && fn.parent.typeParameters !== undefined);
  const objectLike = (e: ts.Expression): boolean => {
    const t = typeOf(bare(e));
    if (t !== undefined) return isObjectType(t);
    return readSource && ownerOf(e) === fn && !generic ? reader.isObject(e) : false;
  };
  const isCtor = ts.isConstructorDeclaration(fn);
  const text = (e: ts.Node): string => e.getText(sourceFile).replace(/\s+/g, ' ');

  /** A local the function declares from a new object, or a parameter of a constructor that
   *  stores it in `this`, where the caller's `new` already moved it. */
  const localOf = (id: ts.Identifier, intoThis: boolean): ts.Node | undefined => {
    const d = reader.declOf(id.text, id);
    if (d === undefined) return undefined;
    if (isCtor && intoThis && ts.isParameter(d) && d.parent === fn) return d;
    if (!ts.isVariableDeclaration(d) || !ts.isIdentifier(d.name) || ownerOf(d) !== ownerOf(id))
      return undefined;
    const list = d.parent;
    if (ts.isVariableDeclarationList(list) && ts.isForOfStatement(list.parent)) return undefined;
    return d.initializer === undefined || newObject(d.initializer, reader) ? d : undefined;
  };

  /** Whether the object `id` names, or a name of it, is used after `stored`, or in a loop that
   *  holds the statement and not the declaration, or in a function inside the body. */
  const usedAfter = (id: ts.Identifier, d: ts.Node, stored: ts.Node): boolean => {
    const names = namesOfOneObject(id.text, body, sourceFile);
    const loops = loopsAround(stored, body).filter((l) => !within(d, l));
    if (loops.length > 0) return true;
    // The statement holds the call or the `new` that runs after its arguments: any mention in
    // it may run while the second place exists.
    let statement: ts.Node = stored;
    while (statement.parent !== undefined && !isStatement(statement)) statement = statement.parent;
    let hit = false;
    const walk = (n: ts.Node): void => {
      if (ts.isIdentifier(n) && names.has(n.text) && n !== id && !isPropertyName(n)) {
        if (n.getStart(sourceFile) >= stored.end || within(n, statement)) hit = true;
        for (let at = n.parent; at !== undefined && at !== body; at = at.parent)
          if (ts.isFunctionLike(at)) hit = true;
      }
      if (!hit) ts.forEachChild(n, walk);
    };
    walk(body);
    return hit;
  };

  const store = (value: ts.Expression, intoThis = false): void => {
    const v = bare(value);
    // Absence has no identity.
    if (v.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(v) && v.text === 'undefined'))
      return;
    if (!objectLike(v) || newObject(v, reader)) return;
    const d = ts.isIdentifier(v) ? localOf(v, intoThis) : undefined;
    if (d !== undefined && !usedAfter(v as ts.Identifier, d, value)) return;
    out.push({
      node: value,
      text:
        d !== undefined
          ? `"${text(value)}" is stored in a second place here, and it is used after that. One ` +
            `object under two names is not supported yet (change 0142, stage 3). Store it where ` +
            `it is last used, or build a new object for the second place.`
          : `"${text(value)}" already has a name, and this statement gives it a second place. ` +
            `One object under two names is not supported yet (change 0142, stage 3). Build a ` +
            `new object for the second place.`,
    });
  };
  const rootIsThis = (e: ts.Expression): boolean => {
    let at = bare(e);
    while (ts.isPropertyAccessExpression(at) || ts.isElementAccessExpression(at))
      at = bare(at.expression);
    return at.kind === ts.SyntaxKind.ThisKeyword;
  };

  const skip = new Set<ts.Node>();
  eachOwn(body, (n) => {
    if (ts.isBinaryExpression(n) && ASSIGNS.has(n.operatorToken.kind)) {
      const left = bare(n.left);
      if (!ts.isArrayLiteralExpression(left)) return store(n.right, rootIsThis(left));
      // `[a, b] = [b, a]`: each place takes the value at its position. A list that only puts the
      // same names in another order gives each name one object.
      const right = bare(n.right);
      const values = ts.isArrayLiteralExpression(right) ? right.elements : undefined;
      const key = (es: readonly ts.Expression[]): string => es.map(text).sort().join('\n');
      skip.add(left);
      if (values !== undefined) skip.add(right);
      if (
        values !== undefined &&
        values.length === left.elements.length &&
        new Set(values.map(text)).size === values.length &&
        key(values) === key(left.elements)
      )
        return;
      left.elements.forEach((p, i) => {
        if (ts.isOmittedExpression(p) || ts.isSpreadElement(p)) return;
        // The elements of one value, `[a, b] = f()`, are objects only where a place takes one.
        const value = values?.[i];
        if (value !== undefined) store(value, rootIsThis(p));
        else if (objectLike(p)) store(n.right, rootIsThis(p));
      });
    } else if (ts.isArrayLiteralExpression(n) && !skip.has(n)) {
      for (const el of n.elements) if (!ts.isSpreadElement(el)) store(el);
    } else if (ts.isObjectLiteralExpression(n)) {
      for (const prop of n.properties) {
        if (ts.isPropertyAssignment(prop)) store(prop.initializer);
        else if (ts.isShorthandPropertyAssignment(prop)) store(prop.name);
        else if (ts.isSpreadAssignment(prop) && reader.hasObjectField(prop.expression))
          store(prop.expression);
      }
    } else if (ts.isNewExpression(n)) {
      for (const a of n.arguments ?? []) store(a);
    } else if (ts.isCallExpression(n)) {
      if (n.expression.kind === ts.SyntaxKind.SuperKeyword) {
        for (const a of n.arguments) store(a, true);
      } else if (
        ts.isPropertyAccessExpression(n.expression) &&
        ARRAY_MUTATORS.has(n.expression.name.text) &&
        membersNamed(n.expression.name.text, sourceFile).length === 0
      ) {
        for (const a of n.arguments) store(a);
        // `xs.fill(v)` puts one object in every element, and the elements are then one object.
        if (n.expression.name.text === 'fill' && n.arguments[0] !== undefined) {
          const v = bare(n.arguments[0]);
          if (objectLike(v) && newObject(v, reader))
            out.push({
              node: n,
              text:
                `"${text(n)}" puts one object in every element, and the elements are then one ` +
                `object. One object under two names is not supported yet (change 0142, stage ` +
                `3). Build each element in a loop.`,
            });
        }
      }
    }
  });

  // One object handed twice, where the callee writes one of the two and one argument is no plain
  // place (`w(a, id(a))`, `w(k.c, k.get())`): the check of two places of one root (`TS8074`) does
  // not see it. An argument that is not new may be, or hold, any object a name of the first holds.
  const absent = (t: ts.TypeNode | undefined): boolean => t !== undefined && ts.isUnionTypeNode(t);
  eachOwn(body, (n) => {
    const callee = ts.isCallExpression(n) ? fileFunction(n, sourceFile) : undefined;
    if (!ts.isCallExpression(n) || callee === undefined) return;
    n.arguments.forEach((a, i) => {
      const q = callee.parameters[i];
      const root = rootOf(a);
      if (
        q === undefined ||
        !takesThePlace(q, sourceFile) ||
        (root === undefined && !rootIsThis(a))
      )
        return;
      const mine =
        root === undefined ? new Set(['this']) : namesOfOneObject(root.name.text, body, sourceFile);
      n.arguments.forEach((b, j) => {
        if (j === i || !objectLike(b) || newObject(b, reader)) return;
        if (
          isPlainPlace(a, sourceFile) &&
          isPlainPlace(b, sourceFile) &&
          !absent(q.type) &&
          !absent(callee.parameters[j]?.type)
        )
          return;
        const hit = (m: ts.Node): boolean =>
          (ts.isIdentifier(m) && mine.has(m.text)) ||
          (m.kind === ts.SyntaxKind.ThisKeyword && mine.has('this')) ||
          ts.forEachChild(m, hit) === true;
        const shown = callee.name?.text ?? '';
        if (hit(b) && !out.some((o) => o.node === n))
          out.push({
            node: n,
            pairing: true,
            text:
              `This call hands the object "${root?.name.text ?? 'this'}" names to "${shown}" twice, and ` +
              `"${shown}" writes one of the two: one object under two names, which is not ` +
              `supported yet (change 0142, stage 2). Pass two objects, or give the function one ` +
              `parameter for it.`,
          });
      });
    });
  });

  // Rule 5: a statement that puts another object at the place a second name names, where the name
  // is read after it.
  const placeOf = (e: ts.Expression, depth = 0): { root: string; steps: Step[] } | undefined => {
    const at = bare(e);
    const steps = stepsOf(at);
    let root: ts.Expression = at;
    while (ts.isPropertyAccessExpression(root) || ts.isElementAccessExpression(root))
      root = bare(root.expression);
    if (root.kind === ts.SyntaxKind.ThisKeyword) return { root: 'this', steps };
    if (!ts.isIdentifier(root)) return undefined;
    const d = depth < 8 ? reader.declOf(root.text, root) : undefined;
    if (d !== undefined && ts.isVariableDeclaration(d) && ts.isIdentifier(d.name)) {
      const list = d.parent;
      const forOf = ts.isVariableDeclarationList(list) && ts.isForOfStatement(list.parent);
      const from = forOf
        ? (list.parent as ts.ForOfStatement).expression
        : d.initializer === undefined
          ? undefined
          : (aliasedCall(d, sourceFile)?.argument ?? bare(d.initializer));
      if (from !== undefined && (forOf || (isPlainPlace(from, sourceFile) && objectLike(from)))) {
        const base = placeOf(from, depth + 1);
        if (base !== undefined)
          return {
            root: base.root,
            steps: [...base.steps, ...(forOf ? [undefined] : []), ...steps],
          };
      }
    }
    return { root: root.text, steps };
  };
  /** Whether `t` is `p` itself (`orSelf`) or a holder on the way to it. */
  const holds = (
    t: ts.Expression,
    p: { root: string; steps: Step[] },
    orSelf: boolean,
  ): boolean => {
    const w = placeOf(t);
    if (w === undefined || w.root !== p.root) return false;
    if (orSelf ? w.steps.length > p.steps.length : w.steps.length >= p.steps.length) return false;
    return w.steps.every((a, i) => {
      const b = p.steps[i];
      return typeof a === 'string' || typeof b === 'string'
        ? a === b
        : a === undefined || b === undefined || a === b;
    });
  };
  eachOwn(body, (n) => {
    if (!ts.isVariableDeclaration(n) || !ts.isIdentifier(n.name) || n.initializer === undefined)
      return;
    const list = n.parent;
    if (ts.isVariableDeclarationList(list) && ts.isForOfStatement(list.parent)) return;
    const from = aliasedCall(n, sourceFile)?.argument ?? bare(n.initializer);
    if (!isPlainPlace(from, sourceFile) || !objectLike(from)) return;
    const place = placeOf(from);
    let region: ts.Node = list.parent;
    if (ts.isVariableStatement(region)) region = region.parent;
    const uses = place === undefined ? [] : usesOfDeclared(n, region, sourceFile);
    if (place === undefined || uses.length === 0) return;
    const loops = (t: ts.Node): ts.Node[] => loopsAround(t, body).filter((l) => !within(n, l));
    const put = (t: ts.Node): void => {
      if (t.getStart(sourceFile) < n.end || out.some((o) => o.node === t)) return;
      const later = uses.some(
        (u) => u.getStart(sourceFile) >= t.end || loops(t).some((l) => within(u, l)),
      );
      if (!later) return;
      out.push({
        node: t,
        text:
          `"${n.name.getText(sourceFile)}" names "${text(from)}", and this statement puts another ` +
          `object there while "${n.name.getText(sourceFile)}" is still used. That is not ` +
          `supported yet (change 0142, stage 2). Read what you need from ` +
          `"${n.name.getText(sourceFile)}" before this statement.`,
      });
    };
    eachOwn(body, (t) => {
      if (ts.isBinaryExpression(t) && ASSIGNS.has(t.operatorToken.kind)) {
        const left = bare(t.left);
        const targets = ts.isArrayLiteralExpression(left) ? left.elements : [left];
        // The assignment of the name itself is refused where the name is declared.
        const own = (x: ts.Expression): boolean => {
          const id = bare(x);
          return ts.isIdentifier(id) && id.text === n.name.getText(sourceFile) && uses.includes(id);
        };
        if (targets.some((x) => !ts.isOmittedExpression(x) && !own(x) && holds(x, place, true)))
          put(t);
      } else if (ts.isCallExpression(t)) {
        if (ts.isPropertyAccessExpression(t.expression)) {
          const m = t.expression.name.text;
          if (
            (m === 'fill' || methodWritesThis(m, sourceFile)) &&
            holds(t.expression.expression, place, false)
          )
            put(t);
        }
        const callee = fileFunction(t, sourceFile);
        t.arguments.forEach((a, i) => {
          const q = callee?.parameters[i];
          if (q !== undefined && takesThePlace(q, sourceFile) && holds(a, place, false)) put(t);
        });
      }
    });
  });
  return out;
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
  const reader = new Reader(sourceFile);
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
