// Implements: Rule 8.23 (docs/language-design.md; traced in reqs/).
import ts from 'typescript';
import type { Expr, FuncDecl } from '../../../../core/ir/nodes.js';
import { typeEq, type ShaderType } from '../../../../core/ir/types.js';
import { authorTypeText, type LoweringScope } from '../../context.js';
import type { TsCompilerDiagnostic } from '../../source-file.js';
import { TS_CODES } from '../../codes.js';
import { makeDiagnostic } from '../../diagnostic.js';
import { isIntegerLiteralTree, retargetDeclaredIntLit } from '../../lit-coerce.js';
import { declarationOf } from '../closures.js';
import { lowerExpression } from '../expression.js';
import { shortText, unparenthesized } from '../array-constructor/form.js';
import { MADE_ADMITS, MADE_ELEMENTS } from './candidate.js';
import { madeCandidateOf, madeLoweringOf, setMadeCandidate, setMadeLowering } from './registry.js';
import { refuseSharedStores } from './identity.js';

export interface MadeAt {
  readonly sourceFile: ts.SourceFile;
  readonly scope: LoweringScope;
  readonly diagnostics: TsCompilerDiagnostic[];
}

export function markMadeResult(fn: FuncDecl, decl: ts.VariableDeclaration): void {
  (fn as { kernel?: boolean }).kernel = true;
  setMadeCandidate(fn, decl);
}

export function madeDeclarationAt(
  form: ts.Expression,
  scope: LoweringScope,
): ts.VariableDeclaration | undefined {
  const decl = madeCandidateOf(scope.owner());
  if (decl?.initializer === undefined) return undefined;
  return unparenthesized(decl.initializer) === form ? decl : undefined;
}

export const say = (at: MadeAt, node: ts.Node, message: string): undefined => {
  at.diagnostics.push(makeDiagnostic(at.sourceFile, node, message, TS_CODES.UNSUPPORTED));
  return undefined;
};

function storesOrLoops(st: ts.Statement): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found || ts.isFunctionLike(n)) return;
    if (ts.isIterationStatement(n, false)) found = true;
    if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      n.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
      ts.isElementAccessExpression(unparenthesized(n.left))
    )
      found = true;
    ts.forEachChild(n, visit);
  };
  visit(st);
  return found;
}

export type GrownUse = (use: ts.Expression, body: ts.Block) => 'fine' | 'refused' | 'other';

function refuseUses(
  decl: ts.VariableDeclaration,
  body: ts.Block,
  fn: string,
  at: MadeAt,
  grown?: GrownUse,
): boolean {
  const name = (decl.name as ts.Identifier).text;
  let refused = false;
  const visit = (n: ts.Node): void => {
    if (refused) return;
    if (ts.isIdentifier(n) && n !== decl.name && n.text === name && declarationOf(n) === decl) {
      let use: ts.Expression = n;
      while (ts.isParenthesizedExpression(use.parent)) use = use.parent;
      const p = use.parent;
      const own = grown?.(use, body);
      if (own === 'refused') {
        refused = true;
        return;
      }
      const fine =
        own === 'fine' ||
        (own === undefined && ts.isElementAccessExpression(p) && p.expression === use) ||
        (ts.isPropertyAccessExpression(p) && p.expression === use && p.name.text === 'length') ||
        ts.isReturnStatement(p);
      if (!fine) {
        const shown =
          ts.isPropertyAccessExpression(p) && ts.isCallExpression(p.parent) ? p.parent : p;
        say(
          at,
          shown,
          `"${shortText(shown)}" uses "${name}", the array "${fn}" ${grown ? 'grows' : 'makes'} ` +
            `and returns, as a value, and that is not supported yet. ` +
            (grown
              ? `Push onto it in a loop, read its length, and return it.`
              : `Read and write its elements, read its length, and return it.`),
        );
        refused = true;
        return;
      }
    }
    if (ts.isReturnStatement(n) && n.expression !== undefined) {
      const e = unparenthesized(n.expression);
      if (!ts.isIdentifier(e) || declarationOf(e) !== decl) {
        say(
          at,
          n,
          `"${shortText(n)}" returns another value than "${name}", the array "${fn}" makes. A ` +
            `function that makes the array it returns returns it on every path; any other ` +
            `return is not supported yet.`,
        );
        refused = true;
        return;
      }
    }
    if (ts.isFunctionLike(n)) return;
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(body, visit);
  return refused;
}

export function ownBody(at: MadeAt): ts.Block {
  return (at.scope.ownerNode() as ts.FunctionDeclaration).body!;
}

export function refusedPlace(
  decl: ts.VariableDeclaration,
  stub: FuncDecl,
  fn: string,
  at: MadeAt,
  grown?: GrownUse,
): boolean {
  const statement = decl.parent.parent;
  const owner = at.scope.ownerNode();
  const body = owner !== undefined && ts.isFunctionDeclaration(owner) ? owner.body : undefined;
  const name = (decl.name as ts.Identifier).text;
  if (body === undefined || statement.parent !== body) {
    say(
      at,
      decl,
      `"${name}" is made inside a loop or under a branch of "${fn}", and that is not ` +
        `supported yet: make the array it returns in a const at the top of its body.`,
    );
    return true;
  }
  if (stub.params.some((p) => p.type.kind === 'storage-texture')) {
    say(
      at,
      decl,
      `"${fn}" takes a 2D storage texture and makes the array it returns, "${name}"; a ` +
        `kernel function that does both is not supported yet.`,
    );
    return true;
  }
  const before = body.statements.slice(0, body.statements.indexOf(statement as ts.Statement));
  if (before.some(storesOrLoops)) {
    say(
      at,
      decl,
      `"${name}" is made after a loop or a store of "${fn}", and that is not supported yet: ` +
        `make the array it returns before its first loop and its first store.`,
    );
    return true;
  }
  return refuseUses(decl, body, fn, at, grown);
}

function fillValue(arg: ts.Expression, want: ShaderType | undefined, at: MadeAt): Expr | undefined {
  const lowered = lowerExpression(arg, at.sourceFile, at.scope, at.diagnostics, want);
  if (lowered === undefined) return undefined;
  return want === undefined || !isIntegerLiteralTree(arg)
    ? lowered
    : retargetDeclaredIntLit(lowered, arg, want);
}

export function bindMade(
  decl: ts.VariableDeclaration,
  stub: FuncDecl,
  type: ShaderType,
  at: MadeAt,
): { readonly param: string; readonly ref: Expr } {
  const name = (decl.name as ts.Identifier).text;
  const earlier = madeLoweringOf(stub)?.param;
  const param = earlier ?? (at.scope.resolveIr(name) === undefined ? name : `${name}_made`);
  at.scope.push();
  const entry = at.scope.define({
    kind: 'param',
    name,
    irName: param,
    type,
    mutable: true,
    space: 'storage',
  });
  at.scope.pop();
  if (!stub.params.some((p) => p.name === param))
    (stub.params as FuncDecl['params'][number][]).push({ name: param, type, mode: 'inout' });
  return { param, ref: { op: 'varref', name: entry.irName ?? entry.name, type } };
}

export function lowerMade(
  decl: ts.VariableDeclaration,
  form: ts.Expression,
  length: ts.Expression | undefined,
  fillArg: ts.Expression | undefined,
  at: MadeAt,
): Expr {
  const stub = at.scope.owner()!;
  const fn = stub.name;
  const refused = (): Expr => bindMade(decl, stub, stub.ret, at).ref;
  if (length === undefined) {
    say(
      at,
      form,
      `"${shortText(form)}" makes the array "${fn}" returns with a length the call gives, and ` +
        `Array.from is not supported yet there. Write new Array(n).fill(v) or ` +
        `new Float32Array(n), and a loop that stores each element.`,
    );
    return refused();
  }
  if (refusedPlace(decl, stub, fn, at)) return refused();
  const n = lowerExpression(length, at.sourceFile, at.scope, at.diagnostics);
  if (n === undefined) return refused();
  if (n.type.kind !== 'scalar' || !MADE_ELEMENTS.has(n.type.scalar)) {
    at.diagnostics.push(
      makeDiagnostic(
        at.sourceFile,
        length,
        `"${shortText(form)}" takes its length from "${shortText(length)}", which is no number.`,
        TS_CODES.TYPE_MISMATCH,
      ),
    );
    return refused();
  }
  const want = stub.ret.kind === 'array' ? stub.ret.elem : undefined;
  const fill = fillArg === undefined ? undefined : fillValue(fillArg, want, at);
  if (fillArg !== undefined && fill === undefined) return refused();
  const elemType = fill?.type ?? { kind: 'scalar' as const, scalar: 'f32' as const };
  const admitted =
    elemType.kind === 'scalar'
      ? MADE_ELEMENTS.has(elemType.scalar) && (want === undefined || want.kind === 'scalar')
      : want !== undefined && typeEq(elemType, want);
  if (!admitted) {
    say(
      at,
      fillArg ?? form,
      `"${shortText(form)}" makes an array of ${authorTypeText(elemType)} whose length the call ` +
        `gives, and that is not supported yet; ${MADE_ADMITS}.`,
    );
    return refused();
  }
  if (elemType.kind === 'struct' && refuseSharedStores(decl, ownBody(at), fn, at) === undefined)
    return refused();
  const bound = bindMade(decl, stub, { kind: 'array', elem: elemType }, at);
  setMadeLowering(stub, {
    decl,
    param: bound.param,
    element: elemType,
    length: n,
    ...(fill !== undefined ? { fill } : {}),
    lengthNode: length,
    ...(fillArg !== undefined ? { fillNode: fillArg } : {}),
    form: shortText(form),
    lengthText: shortText(length),
  });
  return bound.ref;
}
