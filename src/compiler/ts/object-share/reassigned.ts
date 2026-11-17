import ts from 'typescript';
import {
  bare,
  fileFunction,
  methodWritesThis,
  writeTargets,
  writesAnObject,
} from '../object-reference.js';
import { objectWrites, takesThePlace } from '../object-reference/written.js';
import { Reader, eachOwn, loopsAround, within } from '../source-types.js';
import { Fn, stepsOf, accessorReceiver, eachRunBy } from './uses.js';

export interface ReassignedObject {
  readonly node: ts.Node;
  readonly name: string;
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
    const scan = (m: ts.Node, at: ts.Node = m): void => {
      if (replaced !== undefined) return;
      const receiver = accessorReceiver(m, sourceFile);
      if (receiver !== undefined && rootNameOf(receiver) === array) replaced = at;
      if (at === m) eachRunBy(m, reader, (u) => scan(u, m));
      if (ts.isBinaryExpression(m) && m.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        for (const target of writeTargets(m)) {
          if (rootNameOf(target) !== array) continue;
          const steps = stepsOf(target);
          const holder =
            steps.length <= path.length &&
            steps.every(
              (step, k) => step === undefined || path[k] === undefined || step === path[k],
            );
          const element = objects && steps.length === path.length + 1;
          if (holder || element) replaced = at;
        }
      }
      if (ts.isCallExpression(m)) {
        const callee = fileFunction(m, sourceFile);
        m.arguments.forEach((a, i) => {
          const q = callee?.parameters[i];
          if (q !== undefined && takesThePlace(q, sourceFile) && rootNameOf(a) === array)
            replaced = at;
        });
        if (
          ts.isPropertyAccessExpression(m.expression) &&
          rootNameOf(m.expression.expression) === array &&
          methodWritesThis(m.expression.name.text, sourceFile) &&
          (objects || path.length > 0)
        )
          replaced = at;
      }
      if (at === m) ts.forEachChild(m, (c) => scan(c));
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
