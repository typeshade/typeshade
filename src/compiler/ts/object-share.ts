// Implements: Rule 8.8, Rule 8.25 (docs/language-design.md; traced in reqs/).

import ts from 'typescript';
import {
  ARRAY_MUTATORS,
  bare,
  fileFunction,
  methodWritesThis,
  namesOfOneObject,
  rootOf,
} from './object-reference.js';
import { takesThePlace } from './object-reference/written.js';
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
import {
  Fn,
  Step,
  stepsOf,
  usesOfDeclared,
  accessorReceiver,
  eachRunBy,
  ASSIGNS,
  ownerOf,
} from './object-share/uses.js';

export interface SharedObject {
  readonly node: ts.Node;
  readonly text: string;
  readonly pairing?: true;
  readonly store?: { readonly type: ShaderType | undefined };
}

export function sharedObjects(
  fn: Fn,
  sourceFile: ts.SourceFile,
  typeOf: (e: ts.Expression) => ShaderType | undefined = () => undefined,
  readSource = true,
): SharedObject[] {
  const out: SharedObject[] = [];
  const body = fn.body;
  if (body === undefined) return out;
  const reader = new Reader(sourceFile, typeOf);
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

  const usedAfter = (id: ts.Identifier, d: ts.Node, stored: ts.Node): boolean => {
    const names = namesOfOneObject(id.text, body, sourceFile);
    const loops = loopsAround(stored, body).filter((l) => !within(d, l));
    if (loops.length > 0) return true;
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
    if (v.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(v) && v.text === 'undefined'))
      return;
    if (!objectLike(v) || newObject(v, reader)) return;
    const d = ts.isIdentifier(v) ? localOf(v, intoThis) : undefined;
    if (d !== undefined && !usedAfter(v as ts.Identifier, d, value)) return;
    out.push({
      node: value,
      store: { type: typeOf(v) },
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
        if (n.expression.name.text === 'fill' && n.arguments[0] !== undefined) {
          const v = bare(n.arguments[0]);
          if (objectLike(v) && newObject(v, reader))
            out.push({
              node: n,
              store: { type: typeOf(v) },
              text:
                `"${text(n)}" puts one object in every element, and the elements are then one ` +
                `object. One object under two names is not supported yet (change 0142, stage ` +
                `3). Build each element in a loop.`,
            });
        }
      }
    }
  });

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
    const check = (t: ts.Node, at: ts.Node): void => {
      if (ts.isBinaryExpression(t) && ASSIGNS.has(t.operatorToken.kind)) {
        const left = bare(t.left);
        const targets = ts.isArrayLiteralExpression(left) ? left.elements : [left];
        const own = (x: ts.Expression): boolean => {
          const id = bare(x);
          return ts.isIdentifier(id) && id.text === n.name.getText(sourceFile) && uses.includes(id);
        };
        if (targets.some((x) => !ts.isOmittedExpression(x) && !own(x) && holds(x, place, true)))
          put(at);
      } else if (ts.isCallExpression(t)) {
        if (ts.isPropertyAccessExpression(t.expression)) {
          const m = t.expression.name.text;
          if (
            (m === 'fill' || methodWritesThis(m, sourceFile)) &&
            holds(t.expression.expression, place, false)
          )
            put(at);
        }
        const callee = fileFunction(t, sourceFile);
        t.arguments.forEach((a, i) => {
          const q = callee?.parameters[i];
          if (q !== undefined && takesThePlace(q, sourceFile) && holds(a, place, false)) put(at);
        });
      }
      const receiver = accessorReceiver(t, sourceFile);
      if (receiver !== undefined && holds(receiver, place, false)) put(at);
    };
    eachOwn(body, (t) => {
      check(t, t);
      eachRunBy(t, reader, (u) => check(u, t));
    });
  });
  return out;
}
