// Top-level `override` declarations — specialization constants (#8 A7).
//
//   declare const quality: override<f32>          // default 0, the pipeline supplies the rest
//   const quality: override<f32> = 1.             // declared default
//
// An override is NOT a binding and NOT a module const: it occupies no bind slot, and its
// value is unknown until a pipeline is built, so the optimizer must not fold it. `ModuleDecl`
// has carried an `overrides` array and `Expr.overrideref` all along — this is the EDSL's
// `overrideConst(name, type, default)` given a source spelling.

import ts from 'typescript';
import type { OverrideDecl } from '../../core/ir/nodes.js';
import type { ShaderType } from '../../core/ir/types.js';
import { typeKey } from '../../core/ir/types.js';
import type { TsCompilerDiagnostic } from './source-file.js';
import { mapTsTypeToShaderType } from './type-map.js';
import { recordDeclaration, type DeclaredSymbolSink } from './symbols.js';
import { TS_CODES } from './codes.js';
import { makeDiagnostic } from './diagnostic.js';

/** Whether a declaration's type annotation is `override<T>`. Read by the binding and module
 *  const collectors, which both walk the same top-level statements and must leave this one
 *  to {@link collectOverrides}. */
export function isOverrideType(type: ts.TypeNode | undefined): boolean {
  return (
    type !== undefined &&
    ts.isTypeReferenceNode(type) &&
    ts.isIdentifier(type.typeName) &&
    type.typeName.text === 'override'
  );
}

/** Every `override<T>` declared at the top level, in source order.
 *
 *  @param sourceFile - the parsed module.
 *  @param diagnostics - collected diagnostics, appended to.
 *  @param symbols - the editor's declaration sink.
 *  @returns the `OverrideDecl` list for `ModuleDecl.overrides`.
 */
export function collectOverrides(
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  symbols?: DeclaredSymbolSink,
  glslNames: ReadonlySet<string> = new Set(),
): OverrideDecl[] {
  const out: OverrideDecl[] = [];
  const seen = new Set<string>();
  for (const stmt of sourceFile.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    const isConst = (stmt.declarationList.flags & ts.NodeFlags.Const) !== 0;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !isOverrideType(decl.type)) continue;
      const one = lowerOne(decl, isConst, sourceFile, diagnostics);
      if (!one) continue;
      // The check `collectModuleConsts` already had. Without it a repeated name reached
      // `scope.define` and threw out of `compile()` rather than being reported.
      if (seen.has(one.name)) {
        diagnostics.push(diag(sourceFile, decl, `Duplicate override "${one.name}".`));
        continue;
      }
      // On GLSL ES 3.00 an override is a `#define`, and a #define rewrites every later
      // occurrence of its name — including a declaration. `const uv: override<f32> = 0.85`
      // beside a `@location(0) uv` varying emitted `#define uv 0.85` above `in vec2 uv;`,
      // which ANGLE reads as `in vec2 0.85;` and refuses, while WGSL was fine and nothing said
      // so. The names it can capture are the ones the GLSL writer spells from source: a struct
      // field (a varying, a fragment output, a uniform block member) and a binding.
      if (glslNames.has(one.name)) {
        diagnostics.push(
          diag(
            sourceFile,
            decl,
            `override "${one.name}" collides with a struct field or resource of that name. ` +
              `On GLSL ES 3.00 an override is a #define, so it would rewrite that declaration; ` +
              `rename the override.`,
          ),
        );
        continue;
      }
      seen.add(one.name);
      out.push(one);
      recordDeclaration(symbols, sourceFile, decl.name, {
        name: one.name,
        kind: 'override',
        type: one.type,
        mutable: false,
      });
    }
  }
  return out;
}

function lowerOne(
  decl: ts.VariableDeclaration,
  isConst: boolean,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): OverrideDecl | undefined {
  const name = (decl.name as ts.Identifier).text;
  if (!isConst) {
    diagnostics.push(diag(sourceFile, decl, `override "${name}" must be const, not let.`));
    return undefined;
  }
  const inner = (decl.type as ts.TypeReferenceNode).typeArguments?.[0];
  if (!inner) {
    diagnostics.push(diag(sourceFile, decl, `override<T> needs a type argument.`));
    return undefined;
  }
  const type = mapTsTypeToShaderType(inner, sourceFile, diagnostics);
  if (!type) return undefined;
  const k = typeKey(type);
  if (k !== 'f32' && k !== 'i32' && k !== 'u32' && k !== 'bool') {
    // WGSL's own rule: an override is a scalar. A vector or a struct has no `override`
    // spelling to emit, and GLSL's `#define` stand-in has nothing to substitute either.
    diagnostics.push(
      diag(sourceFile, decl, `override "${name}" must be f32, i32, u32 or bool, not ${k}.`),
    );
    return undefined;
  }
  const dflt = defaultValue(decl, type, sourceFile, diagnostics);
  if (dflt === undefined) return undefined;
  return { name, type, default: dflt };
}

/** The value the override takes when the pipeline supplies none.
 *
 *  `const q: override<f32> = 1.` states it. `declare const q: override<f32>` does not, and
 *  takes the type's zero — which is what an unset specialization constant is worth, and is
 *  spelled out in the surface document rather than left to be discovered. Only a literal is
 *  accepted: the default is baked into the declaration both backends emit, so it has to be
 *  known here, not folded later.
 *
 *  The literal has to MATCH the declared type, and this checked only that it was a literal:
 *  `const fancy: override<bool> = 1` emitted `override fancy: bool = 1.0;`, which Tint refuses
 *  (`cannot convert value of type 'abstract-float' to type 'bool'`) and ANGLE answers with
 *  `boolean expression expected`. Nothing downstream could catch it — `OverrideDecl.default` is
 *  a `number | boolean`, so both spellings fit the field and both backends print what they are
 *  given. */
function defaultValue(
  decl: ts.VariableDeclaration,
  type: ShaderType,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): number | boolean | undefined {
  const init = decl.initializer;
  const k = typeKey(type);
  if (!init) return k === 'bool' ? false : 0;
  const name = (decl.name as ts.Identifier).text;
  const unwrapped = ts.isPrefixUnaryExpression(init) ? init.operand : init;
  const negated = ts.isPrefixUnaryExpression(init) && init.operator === ts.SyntaxKind.MinusToken;
  const isBool =
    init.kind === ts.SyntaxKind.TrueKeyword || init.kind === ts.SyntaxKind.FalseKeyword;
  if (k === 'bool') {
    if (isBool) return init.kind === ts.SyntaxKind.TrueKeyword;
    diagnostics.push(
      diag(sourceFile, init, `override "${name}" is bool; its default must be true or false.`),
    );
    return undefined;
  }
  if (isBool) {
    diagnostics.push(
      diag(sourceFile, init, `override "${name}" is ${k}; its default must be a number.`),
    );
    return undefined;
  }
  if (ts.isNumericLiteral(unwrapped)) {
    const v = negated ? -Number(unwrapped.text) : Number(unwrapped.text);
    // An integer override takes an integer, in range. `override<u32> = -1` and
    // `override<i32> = 1.5` reach the backend's literal spelling otherwise, which refuses them
    // as SD0017 with no line of source to point at.
    if (k !== 'f32' && !Number.isInteger(v)) {
      diagnostics.push(
        diag(sourceFile, init, `override "${name}" is ${k}; its default must be a whole number.`),
      );
      return undefined;
    }
    if (k === 'u32' && v < 0) {
      diagnostics.push(
        diag(sourceFile, init, `override "${name}" is u32; its default cannot be negative.`),
      );
      return undefined;
    }
    return v;
  }
  diagnostics.push(
    diag(
      sourceFile,
      init,
      `override "${name}" default must be a literal; ` +
        `the declaration each backend emits carries it.`,
    ),
  );
  return undefined;
}

function diag(sf: ts.SourceFile, node: ts.Node, message: string): TsCompilerDiagnostic {
  return makeDiagnostic(sf, node, message, TS_CODES.TOP_LEVEL);
}
