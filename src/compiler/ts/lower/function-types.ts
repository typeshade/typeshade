// ═══ A parameter of function type (Rule 8.18) ═══
//
// `function apply(f: (x: f32) => f32, x: f32)` takes a function, and neither target has a
// function value to take. It needs none. Every call of `apply` names the function it hands over,
// as a function's name or as an arrow function written in the call, so each function a call
// hands it makes one more copy of `apply` in which `f(x)` calls that function: `apply_sq`,
// `apply_run_f`. That is how a generic function is made once per set of type arguments (Rule
// 8.9), and what TypeScript's own `f(x)` means for every call that could reach it.
//
// This file answers the questions that need only the source: which parameters take a function,
// and what a function type says of the function it takes.

import ts from 'typescript';
import type { ShaderType } from '../../../core/ir/types.js';
import { typeKey, voidT } from '../../../core/ir/types.js';
import type { TsCompilerDiagnostic } from '../source-file.js';
import { mapTsTypeToShaderType } from '../type-map.js';
import { makeDiagnostic } from '../diagnostic.js';
import { TS_CODES } from '../codes.js';

/** The `type X = …` declaration `name` names, found from `at` outward through the blocks,
 *  namespaces and the file around it, as TypeScript finds it. */
function typeAliasNamed(name: string, at: ts.Node): ts.TypeAliasDeclaration | undefined {
  for (let n: ts.Node | undefined = at.parent; n !== undefined; n = n.parent) {
    if (ts.isSourceFile(n) || ts.isModuleBlock(n) || ts.isBlock(n)) {
      for (const st of n.statements) {
        if (ts.isTypeAliasDeclaration(st) && st.name.text === name) return st;
      }
    }
  }
  return undefined;
}

/** The function type `type` spells: written out, in parentheses, or through a type alias of
 *  one that takes no type arguments. Undefined for any other type. */
export function functionTypeOf(type: ts.TypeNode | undefined): ts.FunctionTypeNode | undefined {
  const seen = new Set<ts.Node>();
  let t = type;
  while (t !== undefined && !seen.has(t)) {
    seen.add(t);
    if (ts.isParenthesizedTypeNode(t)) {
      t = t.type;
      continue;
    }
    if (ts.isFunctionTypeNode(t)) return t;
    if (ts.isTypeReferenceNode(t) && ts.isIdentifier(t.typeName) && t.typeArguments === undefined) {
      const alias = typeAliasNamed(t.typeName.text, t);
      if (alias === undefined || alias.typeParameters !== undefined) return undefined;
      t = alias.type;
      continue;
    }
    return undefined;
  }
  return undefined;
}

/** The indexes of the parameters of `fn` whose type is a function type. */
export function functionParams(fn: ts.SignatureDeclarationBase): ReadonlySet<number> {
  const out = new Set<number>();
  fn.parameters.forEach((p, i) => {
    if (functionTypeOf(p.type) !== undefined) out.add(i);
  });
  return out;
}

/** What a function type says of the function a parameter takes, its types read where the call
 *  is lowered: inside a generic function's instance, under its type arguments. */
export interface FunctionShape {
  readonly params: readonly ShaderType[];
  /** `void` takes a function of any return type, whose value is not used: TypeScript's rule.
   *  Undefined where the function's own return says what it returns: the function a fold like
   *  `zip` builds its elements with. */
  readonly ret: ShaderType | undefined;
  /** The type as written, for messages: `(x: f32) => f32`. */
  readonly text: string;
}

/** The shape of `t`, or undefined, having said why, when a type in it names no shader type. */
export function shapeOf(
  t: ts.FunctionTypeNode,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): FunctionShape | undefined {
  const text = t.getText(sourceFile);
  const params: ShaderType[] = [];
  for (const p of t.parameters) {
    if (p.type === undefined || functionTypeOf(p.type) !== undefined) {
      diagnostics.push(
        makeDiagnostic(
          sourceFile,
          p,
          p.type === undefined
            ? `The function type "${text}" names each parameter's type: write "${p.name.getText(sourceFile)}: f32".`
            : `The function type "${text}" takes a function, and a function may take one only as a parameter of its own (Rule 8.18).`,
          TS_CODES.FUNCTION_SHAPE,
        ),
      );
      return undefined;
    }
    const mapped = mapTsTypeToShaderType(p.type, sourceFile, diagnostics);
    if (mapped === undefined) return undefined;
    params.push(mapped);
  }
  if (t.type.kind === ts.SyntaxKind.VoidKeyword) return { params, ret: voidT, text };
  const ret = mapTsTypeToShaderType(t.type, sourceFile, diagnostics);
  if (ret === undefined) return undefined;
  return { params, ret, text };
}

/** Why a function whose own parameters are `params` and which returns `ret` cannot be handed
 *  to a parameter of type `shape`, or undefined when it can. TypeScript's rules, less one: it
 *  lets a function take fewer parameters than the type passes, which a named function here may
 *  not, since each call of it passes them all; an arrow function written in the call is given
 *  the rest. */
export function misfit(
  params: readonly ShaderType[],
  ret: ShaderType,
  shape: FunctionShape,
): string | undefined {
  if (params.length !== shape.params.length) {
    return `takes ${String(params.length)} argument(s), and "${shape.text}" passes ${String(shape.params.length)}`;
  }
  for (const [i, t] of params.entries()) {
    if (typeKey(t) !== typeKey(shape.params[i]!)) {
      return `takes ${typeKey(t)} for argument ${String(i + 1)}, where "${shape.text}" passes ${typeKey(shape.params[i]!)}`;
    }
  }
  if (
    shape.ret !== undefined &&
    typeKey(shape.ret) !== 'void' &&
    typeKey(ret) !== typeKey(shape.ret)
  ) {
    return `returns ${typeKey(ret)}, where "${shape.text}" returns ${typeKey(shape.ret)}`;
  }
  return undefined;
}
