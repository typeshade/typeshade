// Implements: Rule 8.23 (docs/language-design.md; traced in reqs/).
import ts from 'typescript';
import type { Expr } from '../../../../core/ir/nodes.js';
import { typeEq, type ShaderType } from '../../../../core/ir/types.js';
import { authorTypeText } from '../../context.js';
import { shortText } from '../array-constructor/form.js';
import { MADE_ADMITS, MADE_ELEMENTS } from './candidate.js';
import { bindMade, ownBody, refusedPlace, say, type GrownUse, type MadeAt } from './lower.js';
import { refuseSharedStores } from './identity.js';
import { sayOnceAt, setMadeLowering } from './registry.js';

function innermostLoop(n: ts.Node, body: ts.Block): ts.IterationStatement | undefined {
  for (let at = n.parent; at !== body && !ts.isFunctionLike(at); at = at.parent)
    if (ts.isIterationStatement(at, false)) return at;
  return undefined;
}

function written(access: ts.ElementAccessExpression): boolean {
  const p = access.parent;
  if (ts.isBinaryExpression(p) && p.left === access)
    return (
      p.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      p.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    );
  return ts.isPrefixUnaryExpression(p) || ts.isPostfixUnaryExpression(p);
}

function isPlainAssignment(e: ts.BinaryExpression): boolean {
  return e.operatorToken.kind === ts.SyntaxKind.EqualsToken;
}

function beforeFirstLoop(access: ts.Node, body: ts.Block, sf: ts.SourceFile): boolean {
  if (innermostLoop(access, body) !== undefined) return false;
  let first: number | undefined;
  const visit = (n: ts.Node): void => {
    if (first !== undefined || ts.isFunctionLike(n)) return;
    if (ts.isIterationStatement(n, false)) first = n.getStart(sf);
    else ts.forEachChild(n, visit);
  };
  ts.forEachChild(body, visit);
  return first === undefined || access.getStart(sf) < first;
}

function grownUse(name: string, fn: string, at: MadeAt): GrownUse {
  return (use, body) => {
    const p = use.parent;
    if (
      ts.isPropertyAccessExpression(p) &&
      p.expression === use &&
      p.name.text === 'push' &&
      ts.isCallExpression(p.parent) &&
      p.parent.expression === p
    ) {
      const call = shortText(p.parent);
      if (innermostLoop(p.parent, body) === undefined) {
        sayOnceAt(at.scope.owner()!, p.parent);
        say(
          at,
          p.parent,
          `"${call}" pushes onto "${name}", the array "${fn}" grows and returns, outside every ` +
            `loop, and that is not supported yet. Push onto it inside a loop of "${fn}".`,
        );
        return 'refused';
      }
      return 'fine';
    }
    if (ts.isElementAccessExpression(p) && p.expression === use) {
      if (!beforeFirstLoop(p, body, at.sourceFile)) return 'fine';
      const plain = written(p) && ts.isBinaryExpression(p.parent) && isPlainAssignment(p.parent);
      say(
        at,
        p,
        plain
          ? `"${shortText(p.parent)}" writes an element of "${name}", the array "${fn}" grows ` +
              `with push, before its first loop, which adds an element outside every loop, and ` +
              `that is not supported yet. Push onto it inside a loop of "${fn}".`
          : `"${shortText(p)}" reads an element of "${name}", the array "${fn}" grows with ` +
              `push, before anything is pushed onto it; a read past its length is not supported ` +
              `yet. Read it after the loop that pushes onto it.`,
      );
      return 'refused';
    }
    return 'other';
  };
}

export function lowerGrown(
  decl: ts.VariableDeclaration,
  form: ts.ArrayLiteralExpression,
  target: ShaderType & { kind: 'array' },
  at: MadeAt,
): Expr {
  const stub = at.scope.owner()!;
  const fn = stub.name;
  const name = (decl.name as ts.Identifier).text;
  const elem = target.elem;
  const refused = (): Expr => bindMade(decl, stub, target, at).ref;
  const ret = stub.ret.kind === 'array' ? stub.ret.elem : undefined;
  if (
    elem.kind === 'scalar'
      ? !MADE_ELEMENTS.has(elem.scalar)
      : ret === undefined || !typeEq(elem, ret)
  ) {
    say(
      at,
      decl,
      `"${name}" grows an array of ${authorTypeText(elem)} with push, and that is not ` +
        `supported yet; ${MADE_ADMITS}.`,
    );
    return refused();
  }
  if (refusedPlace(decl, stub, fn, at, grownUse(name, fn, at))) return refused();
  const pushed = elem.kind === 'struct' ? refuseSharedStores(decl, ownBody(at), fn, at) : 'own';
  if (pushed === undefined) return refused();
  const bound = bindMade(decl, stub, target, at);
  setMadeLowering(stub, {
    decl,
    param: bound.param,
    element: elem,
    length: { op: 'lit', type: { kind: 'scalar', scalar: 'u32' }, value: 0 },
    lengthNode: form,
    grown: true,
    ...(pushed === 'one' ? { pushedOne: true as const } : {}),
    form: shortText(decl),
    lengthText: '',
  });
  return bound.ref;
}
