// Implements: Rule 8.23 (docs/language-design.md; traced in reqs/).
import ts from 'typescript';
import type { StructDecl } from '../../../../core/ir/nodes.js';
import type { ShaderType } from '../../../../core/ir/types.js';
import type { TsCompilerDiagnostic } from '../../source-file.js';
import { TS_CODES } from '../../codes.js';
import { makeDiagnostic } from '../../diagnostic.js';
import { authorTypeText } from '../../context.js';
import { refuseRuntimeArraySignature } from '../runtime-array.js';
import {
  fillFormOf,
  fromFormOf,
  isFloat32ArrayNew,
  unparenthesized,
} from '../array-constructor/form.js';

export const MADE_ELEMENTS: ReadonlySet<string> = new Set(['f32', 'i32', 'u32']);

export function isMadeForm(e: ts.Expression): boolean {
  const x = unparenthesized(e);
  if (ts.isNewExpression(x)) return isFloat32ArrayNew(x);
  return ts.isCallExpression(x) && (fillFormOf(x) !== undefined || fromFormOf(x) !== undefined);
}

function returnsName(body: ts.Node, name: string): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found || ts.isFunctionLike(n)) return;
    if (ts.isReturnStatement(n) && n.expression !== undefined) {
      const e = unparenthesized(n.expression);
      if (ts.isIdentifier(e) && e.text === name) found = true;
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(body, visit);
  return found;
}

export type MadeResult =
  | { readonly kind: 'kernel'; readonly decl: ts.VariableDeclaration }
  | { readonly kind: 'elsewhere'; readonly decl: ts.VariableDeclaration };

export function madeCandidate(
  node: ts.FunctionDeclaration,
  mayBeKernel: boolean,
): MadeResult | undefined {
  const body = node.body;
  if (body === undefined) return undefined;
  let found: ts.VariableDeclaration | undefined;
  const visit = (n: ts.Node): void => {
    if (found !== undefined || ts.isFunctionLike(n)) return;
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer !== undefined &&
      ts.isVariableDeclarationList(n.parent) &&
      (n.parent.flags & ts.NodeFlags.Const) !== 0 &&
      isMadeForm(n.initializer) &&
      returnsName(body, n.name.text)
    )
      found = n;
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(body, visit);
  if (found === undefined) return undefined;
  return { kind: mayBeKernel ? 'kernel' : 'elsewhere', decl: found };
}

export function refuseResultArray(
  mapped: ShaderType | undefined,
  typeNode: ts.TypeNode,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  structByName: (name: string) => StructDecl | undefined,
  made: MadeResult['kind'] | undefined,
): boolean {
  if (made === 'elsewhere' && mapped?.kind === 'array' && mapped.size === undefined) {
    diagnostics.push(
      makeDiagnostic(
        sourceFile,
        typeNode,
        `This function makes and returns ${authorTypeText(mapped)}, an array whose length the ` +
          `call gives. Only an exported kernel function makes such an array; in a helper or ` +
          `an entry it is not supported yet.`,
        TS_CODES.UNSUPPORTED,
      ),
    );
    return true;
  }
  if (made === 'kernel' && mapped?.kind === 'array' && mapped.size === undefined) {
    const elem = mapped.elem;
    if (elem.kind === 'scalar' && MADE_ELEMENTS.has(elem.scalar)) return false;
    diagnostics.push(
      makeDiagnostic(
        sourceFile,
        typeNode,
        `This function makes and returns ${authorTypeText(mapped)}, an array of ` +
          `${authorTypeText(elem)} whose length the call gives. An array of ` +
          `${authorTypeText(elem)} made this way is not supported yet; an array of f32, i32 or ` +
          `u32 is.`,
        TS_CODES.UNSUPPORTED,
      ),
    );
    return true;
  }
  return refuseRuntimeArraySignature(
    mapped,
    { kind: 'result' },
    typeNode,
    sourceFile,
    diagnostics,
    structByName,
  );
}
