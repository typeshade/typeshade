// Implements: Rule 8.23 (docs/language-design.md; traced in reqs/).
import ts from 'typescript';
import type { Expr } from '../../../../core/ir/nodes.js';
import { typeEq, type ShaderType } from '../../../../core/ir/types.js';
import { authorTypeText } from '../../context.js';
import { shortText } from '../array-constructor/form.js';
import { MADE_ADMITS, MADE_ELEMENTS } from './candidate.js';
import { loopText } from './capacity.js';
import { bindMade, refusedPlace, say, type GrownUse, type MadeAt } from './lower.js';
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
      const loop = innermostLoop(p.parent, body);
      const remedy = `Push onto it inside a for loop at the top level of "${fn}".`;
      if (loop === undefined) {
        sayOnceAt(at.scope.owner()!, p.parent);
        say(
          at,
          p.parent,
          `"${call}" pushes onto "${name}", the array "${fn}" grows and returns, outside every ` +
            `loop, and that is not supported yet. ${remedy}`,
        );
        return 'refused';
      }
      if (loop.parent !== body || !(ts.isForStatement(loop) || ts.isForOfStatement(loop))) {
        say(
          at,
          p.parent,
          `"${call}" pushes onto "${name}" inside "${loopText(loop, at.sourceFile)}", which is ` +
            `no for loop at the top level of "${fn}", and that is not supported yet. ${remedy}`,
        );
        return 'refused';
      }
      return 'fine';
    }
    if (ts.isElementAccessExpression(p) && p.expression === use) {
      say(
        at,
        p,
        `"${shortText(p)}" ${written(p) ? 'writes' : 'reads'} an element of "${name}", the ` +
          `array "${fn}" grows with push, and that is not supported yet. Push onto it in a ` +
          `loop, read its length, and return it.`,
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
  const bound = bindMade(decl, stub, target, at);
  setMadeLowering(stub, {
    decl,
    param: bound.param,
    element: elem,
    length: { op: 'lit', type: { kind: 'scalar', scalar: 'u32' }, value: 0 },
    lengthNode: form,
    grown: true,
    form: shortText(decl),
    lengthText: '',
  });
  return bound.ref;
}
