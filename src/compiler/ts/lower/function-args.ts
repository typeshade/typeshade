// ═══ The function a call hands to a parameter of function type (Rule 8.18) ═══
//
// A call of `apply(f: (x: f32) => f32, x: f32)` hands `f` over as a function the file declares,
// named (`apply(sq, 2.)`, `apply(scale, 2.)` for a local one, `apply(g, x)` inside a function that
// itself took `g`), or as an arrow function written in the call (`apply((x) => x * k, 2.)`),
// which is lifted out as a local function of the body the call is in. Either way the argument is
// a function of the module, and which one is known where the call is written. Anything else, a
// `?:` between two functions or a function a call returns, would choose one at run time, and a
// shader has no function value to choose with.

import ts from 'typescript';
import type { FuncDecl } from '../../../core/ir/nodes.js';
import type { ShaderType } from '../../../core/ir/types.js';
import { typeKey, voidT } from '../../../core/ir/types.js';
import { mapTsTypeToShaderType } from '../type-map.js';
import type { TsCompilerDiagnostic } from '../source-file.js';
import { THIS_CAPTURE, fileFunctionsOf, type CaptureKey, type LoweringScope } from '../context.js';
import { makeDiagnostic } from '../diagnostic.js';
import { TS_CODES, type TsCode } from '../codes.js';
import { closureUse } from './closures.js';
import { declaresFunction } from './local-functions.js';
import { misfit, type FunctionShape } from './function-types.js';

function push(
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
  node: ts.Node,
  message: string,
  code: TsCode,
): void {
  diagnostics.push(makeDiagnostic(sourceFile, node, message, code));
}

/** `e` without the parentheses around it. */
function bare(e: ts.Expression): ts.Expression {
  let x = e;
  while (ts.isParenthesizedExpression(x)) x = x.expression;
  return x;
}

/** The function `decl` (a local function, or a parameter of function type) names where `scope`
 *  is: found by its name, which is how a call of it resolves too. */
function functionOfDeclaration(decl: ts.Node, scope: LoweringScope): FuncDecl | undefined {
  const name = (decl as { name?: ts.Node }).name;
  return name !== undefined && ts.isIdentifier(name) ? scope.resolveCallee(name.text) : undefined;
}

/** What a function written at `node`, in the body `scope` lowers, captures (Rule 8.17): the
 *  variables of the functions around it that it reads, `this` when it is an arrow function that
 *  reads it inside a method, and whatever the functions it names capture in turn. */
export function capturesOfArgument(
  node: ts.ArrowFunction | ts.FunctionExpression,
  scope: LoweringScope,
): CaptureKey[] {
  const use = closureUse(node, declaresFunction);
  const keys: CaptureKey[] = use.captures.map((c) => c.decl);
  const add = (k: CaptureKey): void => {
    if (keys.includes(k)) return;
    if (k === THIS_CAPTURE) keys.unshift(k);
    else keys.push(k);
  };
  if (use.usesThis && ts.isArrowFunction(node) && scope.resolve('this') !== undefined) {
    add(THIS_CAPTURE);
  }
  const file = fileFunctionsOf(scope.calleeTable());
  for (const d of use.calls) {
    const called = functionOfDeclaration(d, scope);
    for (const k of called === undefined ? [] : (file.captures.get(called.name) ?? [])) add(k);
  }
  return keys;
}

/** The function the call `node` hands to its parameter `index`, `param` of `owner`, whose type
 *  is `shape`: one the file declares, by its name, or an arrow function written in the call,
 *  lifted out of the calling body. Undefined, having said why, for anything else. */
export function functionArgument(
  node: ts.CallExpression,
  index: number,
  param: ts.ParameterDeclaration,
  shape: FunctionShape,
  owner: string,
  scope: LoweringScope,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): FuncDecl | undefined {
  const pname = ts.isIdentifier(param.name) ? param.name.text : `#${String(index + 1)}`;
  const arg = node.arguments[index];
  if (arg === undefined) {
    push(
      diagnostics,
      sourceFile,
      node,
      `"${owner}" takes a function for "${pname}", "${shape.text}": hand one over by its name, ` +
        `or write it here as an arrow function.`,
      TS_CODES.ARITY_MISMATCH,
    );
    return undefined;
  }
  const x = bare(arg);
  if (ts.isArrowFunction(x) || ts.isFunctionExpression(x)) {
    return scope.liftArgument(x, shape, pname, sourceFile, diagnostics);
  }
  if (ts.isIdentifier(x)) {
    const decl = scope.resolveCallee(x.text);
    if (decl !== undefined) {
      if (decl.stage !== undefined) {
        push(
          diagnostics,
          sourceFile,
          x,
          `"${x.text}" is a ${decl.stage} entry point, which the pipeline invokes and no call ` +
            `may; move its body into a function both can call.`,
          TS_CODES.UNSUPPORTED,
        );
        return undefined;
      }
      const captured = fileFunctionsOf(scope.calleeTable()).captures.get(decl.name)?.length ?? 0;
      const own = decl.params.slice(captured).map((p) => p.type);
      const why = misfit(own, decl.ret, shape);
      if (why !== undefined) {
        push(
          diagnostics,
          sourceFile,
          x,
          `"${x.text}" ${why}, so it cannot be "${pname}" of "${owner}".`,
          TS_CODES.TYPE_MISMATCH,
        );
        return undefined;
      }
      return decl;
    }
    // A declaration that was refused already said why.
    if (scope.declarationRefused(x.text)) return undefined;
    const message = scope.isGenericFunction(x.text)
      ? `"${x.text}" is generic, and which of its instances to hand over as "${pname}" of ` +
        `"${owner}" is written nowhere; write an arrow function that calls it here: ` +
        `"(…) => ${x.text}(…)".`
      : scope.resolve(x.text) !== undefined
        ? `"${x.text}" is a value, and "${pname}" of "${owner}" takes a function: hand one ` +
          `over by its name, or write it here as an arrow function.`
        : `"${x.text}" is no function this file declares, and "${pname}" of "${owner}" takes ` +
          `one: hand over one the file declares, or write an arrow function that calls it ` +
          `here, "(…) => ${x.text}(…)".`;
    push(diagnostics, sourceFile, x, message, TS_CODES.TYPE_MISMATCH);
    return undefined;
  }
  push(
    diagnostics,
    sourceFile,
    arg,
    `"${pname}" of "${owner}" takes a function, which a call hands over by its name or as an ` +
      `arrow function written there; "${arg.getText(sourceFile)}" would choose one at run time, ` +
      `and a shader has no function value to choose with.`,
    TS_CODES.UNSUPPORTED,
  );
  return undefined;
}

/** The parameters and return type of a function written as an argument: its own where it writes
 *  them, the parameter's type's where it does not, as TypeScript types it from where it is
 *  written, and one it leaves off at the end taken with no name, since every call passes it.
 *  `written` is the declaration of each of its own parameters, or undefined for one it left off.
 *  Undefined, having said why, when a type it writes disagrees with the parameter's type. */
export function argumentSignature(
  node: ts.ArrowFunction | ts.FunctionExpression,
  shape: FunctionShape,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
):
  | {
      readonly params: FuncDecl['params'][number][];
      /** Undefined when neither the function nor the parameter's type says: its body does. */
      readonly ret: ShaderType | undefined;
      readonly written: readonly (ts.ParameterDeclaration | undefined)[];
    }
  | undefined {
  const refuse = (at: ts.Node, message: string, code: TsCode): undefined => {
    push(diagnostics, sourceFile, at, message, code);
    return undefined;
  };
  if (node.asteriskToken || node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) {
    return refuse(
      node,
      'A function written as an argument is a plain function: no async, no generator.',
      TS_CODES.FUNCTION_SHAPE,
    );
  }
  if (node.typeParameters !== undefined) {
    return refuse(
      node.typeParameters[0]!,
      `A function written as an argument takes its types from "${shape.text}", and has no type parameters of its own.`,
      TS_CODES.FUNCTION_SHAPE,
    );
  }
  if (node.parameters.length > shape.params.length) {
    return refuse(
      node,
      `This function takes ${String(node.parameters.length)} parameter(s), and "${shape.text}" passes ${String(shape.params.length)}.`,
      TS_CODES.ARITY_MISMATCH,
    );
  }
  const names = new Set(
    node.parameters.flatMap((p) => (ts.isIdentifier(p.name) ? [p.name.text] : [])),
  );
  const params: FuncDecl['params'][number][] = [];
  const written: (ts.ParameterDeclaration | undefined)[] = [];
  for (const [i, want] of shape.params.entries()) {
    const p = node.parameters[i];
    if (p === undefined) {
      let name = `_${String(i + 1)}`;
      while (names.has(name)) name = `${name}_`;
      names.add(name);
      params.push({ name, type: want });
      written.push(undefined);
      continue;
    }
    if (!ts.isIdentifier(p.name) || p.dotDotDotToken || p.questionToken || p.initializer) {
      return refuse(
        p,
        'A parameter of a function written as an argument is a plain name, with no default, rest or destructuring.',
        TS_CODES.FUNCTION_SHAPE,
      );
    }
    let type = want;
    if (p.type !== undefined) {
      const mapped = mapTsTypeToShaderType(p.type, sourceFile, diagnostics);
      if (mapped === undefined) return undefined;
      if (typeKey(mapped) !== typeKey(want)) {
        return refuse(
          p.type,
          `"${p.name.text}" is written ${typeKey(mapped)}, and "${shape.text}" passes ${typeKey(want)}.`,
          TS_CODES.TYPE_MISMATCH,
        );
      }
      type = mapped;
    }
    params.push({ name: p.name.text, type });
    written.push(p);
  }
  let ret = shape.ret;
  if (node.type !== undefined) {
    if (node.type.kind === ts.SyntaxKind.VoidKeyword) ret = voidT;
    else {
      const mapped = mapTsTypeToShaderType(node.type, sourceFile, diagnostics);
      if (mapped === undefined) return undefined;
      if (
        shape.ret !== undefined &&
        typeKey(shape.ret) !== 'void' &&
        typeKey(mapped) !== typeKey(shape.ret)
      ) {
        return refuse(
          node.type,
          `This function returns ${typeKey(mapped)}, and "${shape.text}" returns ${typeKey(shape.ret!)}.`,
          TS_CODES.TYPE_MISMATCH,
        );
      }
      ret = mapped;
    }
  }
  return { params, ret, written };
}
