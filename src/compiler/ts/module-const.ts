// Top-level `const` → ModuleDecl.consts (foldable scalars).
//
// Implements: Rule 6.3, Rule 7.4 (docs/language-design.md; traced in reqs/).

import ts from 'typescript';
import type { ConstDecl, Expr, StructDecl } from '../../core/ir/nodes.js';
import type { ShaderType } from '../../core/ir/types.js';
import { i32T, typeKey } from '../../core/ir/types.js';
import type { TsCompilerDiagnostic } from './source-file.js';
import { LoweringScope } from './context.js';
import type { DeclaredSymbolSink } from './symbols.js';
import { mapTsTypeToShaderType } from './type-map.js';
import { foldConstComponents, foldConstValue } from './loop-bound.js';
import { isConstEvaluableMathFn } from './math-alias.js';
import { lowerExpression } from './lower/expression.js';
import { lowerArrayLiteral } from './lower/expression-array.js';
import { eachNamespaceStatement, namespaceMemberName } from './namespaces.js';
import { isResourceCall } from './bindings.js';
import { isOverrideType } from './overrides.js';
import { moduleVarSpace } from './module-vars.js';
import { TS_CODES } from './codes.js';
import { makeDiagnostic } from './diagnostic.js';
import { localFunctionOf } from './lower/local-functions.js';
import { isMixinApplication } from './mixins.js';
import {
  emittedMemberName,
  holdsFunction,
  isStaticMember,
  shadowedStaticFields,
  writtenMemberName,
  writtenStaticFields,
} from './class-names.js';

/** The module-constant name a class's static field or an enum's member takes: `K.PI` is
 *  `K_PI` and `Mode.Shaded` is `Mode_Shaded`, the same joining a method takes (`K_half`), so
 *  one owner's members share one prefix in the emitted text. */
export const staticConstName = (owner: string, member: string): string => `${owner}_${member}`;

/** One `enum`'s members, as the module constants they are (T1, #92).
 *
 *  A numeric member takes its initializer's value, or one more than the member before it, or
 *  zero when it is the first: TypeScript's own rule, computed here so the emitted constants
 *  carry the same numbers the editor shows. The values are `i32`, which is the type the enum's
 *  name has wherever a type stands.
 *
 *  What is refused says why: a string member has no GPU representation, and a member whose
 *  initializer this cannot fold to an integer has no constant to emit. A `declare enum` has no
 *  members to emit at all. */
function collectEnum(
  stmt: ts.EnumDeclaration,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
  out: ConstDecl[],
): void {
  const owner = stmt.name.text;
  if (stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword)) {
    diagnostics.push(
      makeDiagnostic(
        sourceFile,
        stmt.name,
        `"declare enum ${owner}" has no members to emit; declare the enum in this file.`,
        TS_CODES.TOP_LEVEL,
      ),
    );
    return;
  }
  let next = 0;
  // The values so far, under their BARE names, which is how TypeScript lets a member name one
  // declared before it (`B = A * 3`). They are defined in a frame of their own for the fold
  // and popped again, so a bare `A` means nothing outside the enum body, as in TypeScript.
  const seen = new Map<string, number>();
  for (const member of stmt.members) {
    if (!ts.isIdentifier(member.name)) {
      diagnostics.push(
        makeDiagnostic(
          sourceFile,
          member.name,
          `Enum member "${owner}.${member.name.getText(sourceFile)}" must be a simple name.`,
          TS_CODES.TOP_LEVEL,
        ),
      );
      continue;
    }
    const shown = `${owner}.${member.name.text}`;
    const name = staticConstName(owner, member.name.text);
    let value = next;
    if (member.initializer !== undefined) {
      if (ts.isStringLiteralLike(member.initializer)) {
        diagnostics.push(
          makeDiagnostic(
            sourceFile,
            member,
            `Enum member "${shown}" has a string value, which no GPU type holds. A numeric ` +
              `enum member is an i32 constant; give it a number, or drop the value and take ` +
              `the position.`,
            TS_CODES.TYPE_MISMATCH,
          ),
        );
        continue;
      }
      scope.push();
      for (const [bare, v] of seen) {
        scope.define({ kind: 'module', name: bare, type: i32T, mutable: false, constValue: v });
      }
      const init = lowerExpression(member.initializer, sourceFile, scope, diagnostics);
      const folded = init === undefined ? undefined : foldConstValue(init, scope);
      scope.pop();
      if (!init) continue;
      if (typeof folded !== 'number' || !Number.isInteger(folded)) {
        diagnostics.push(
          makeDiagnostic(
            sourceFile,
            member,
            `Enum member "${shown}" needs a value this can compute: a whole number, or ` +
              `arithmetic over numbers and members declared before it.`,
            TS_CODES.TYPE_MISMATCH,
          ),
        );
        continue;
      }
      value = folded;
    }
    if (value < -2147483648 || value > 2147483647) {
      diagnostics.push(
        makeDiagnostic(
          sourceFile,
          member,
          `Enum member "${shown}" is ${value}, which is outside an i32's [-2147483648, 2147483647].`,
          TS_CODES.TYPE_MISMATCH,
        ),
      );
      continue;
    }
    next = value + 1;
    seen.set(member.name.text, value);
    if (scope.hasInCurrent(name)) {
      diagnostics.push(
        makeDiagnostic(
          sourceFile,
          member.name,
          `Enum member "${shown}" collides with "${name}", which the file already declares.`,
          TS_CODES.DUPLICATE_SYMBOL,
        ),
      );
      continue;
    }
    scope.define({ kind: 'module', name, type: i32T, mutable: false, constValue: value });
    scope.recordDeclaration(sourceFile, member.name, { name, kind: 'const', type: i32T });
    out.push({ name, type: i32T, wgslValue: value, cpuValue: value });
  }
}

function isTopLevelConst(stmt: ts.Statement): stmt is ts.VariableStatement {
  return ts.isVariableStatement(stmt) && (stmt.declarationList.flags & ts.NodeFlags.Const) !== 0;
}

export function collectModuleConsts(
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  symbols?: DeclaredSymbolSink,
  /** The file's structs, so a const of a struct type can resolve the object literal its
   *  annotation names (roadmap 0.3 item T7, #92). Without them this scope had no struct
   *  table at all, and `const O: P = { x: 0., y: 0. }` was "does not match a known struct"
   *  even though the annotation said which one. */
  structs: readonly StructDecl[] = [],
): ConstDecl[] {
  const scope = new LoweringScope(undefined, symbols);
  scope.setStructs(structs);
  const out: ConstDecl[] = [];
  // The value EXPRESSION of each non-scalar const declared so far, by name. A scalar const's
  // value reaches `foldConstNumber` through the scope binding, but a vector or array one is
  // carried by `valueExpr` alone and defines its binding WITHOUT a constValue — so without
  // this map a later `A / Z` could not see the zero component inside `Z`.
  const valueExprs = new Map<string, Expr>();
  // Every statement of the file and of every namespace, with the prefix its members take
  // (T4, #92): a const inside `namespace Palette` is `Palette_WARM`. The walk reports nothing
  // itself; `lower/function.ts` owns the refusal of a statement a namespace cannot hold, so
  // this one passes over what is not its own.
  const sites: { stmt: ts.Statement; prefix: string }[] = [];
  eachNamespaceStatement(sourceFile.statements, sourceFile, [], (stmt, prefix) => {
    sites.push({ stmt, prefix });
  });
  for (const { stmt, prefix } of sites) {
    // A class's `static` fields are module constants named `Cls_Field` (T3, #92): ordinary
    // TypeScript for "a constant that belongs to this class", and the shape a developer
    // writes before reaching for a top-level const. Collected in source order with the
    // top-level ones, so either may name the other by the rules already in force here.
    if (ts.isClassDeclaration(stmt) && stmt.name) {
      const written = writtenStaticFields(sourceFile);
      const shadowed = shadowedStaticFields(stmt);
      for (const member of stmt.members) {
        if (!ts.isPropertyDeclaration(member) || !isStaticMember(member)) continue;
        // A static field that holds a function is a static method, and structs.ts says so.
        if (holdsFunction(member)) continue;
        if (shadowed.has(member)) continue;
        // `static #SCALE = 2.` is the constant `Cls_SCALE`: a private name is emitted without
        // its `#`, and only the class's own body may read it (Rule 8.12).
        const name = writtenMemberName(member.name);
        if (name === undefined) continue;
        // A static field the file writes is a module variable, module-vars.ts's (Rule 8.13).
        if (written.has(`${stmt.name.text}.${name}`)) continue;
        if (!member.initializer) {
          diagnostics.push(
            makeDiagnostic(
              sourceFile,
              member,
              `Static field "${stmt.name.text}.${name}" needs an initializer: it ` +
                `is a module constant, and a constant has a value.`,
              TS_CODES.TOP_LEVEL,
            ),
          );
          continue;
        }
        // `this` in a static initializer is the class (Rule 8.13): `static B = this.A * 2.`.
        scope.setStaticClass(stmt.name.text);
        const c = lowerOne(
          member,
          sourceFile,
          scope,
          diagnostics,
          valueExprs,
          staticConstName(stmt.name.text, emittedMemberName(name)),
        );
        scope.setStaticClass(undefined);
        if (!c) continue;
        out.push(c);
        if (c.valueExpr) valueExprs.set(c.name, c.valueExpr);
      }
      continue;
    }
    // A numeric `enum` is a set of named integer constants (roadmap 0.3 item T1, #92): each
    // member is the module constant `Enum_Member`, an i32, and `Mode.Shaded` reads it through
    // the same constref a top-level const does.
    if (ts.isEnumDeclaration(stmt)) {
      collectEnum(stmt, sourceFile, scope, diagnostics, out);
      continue;
    }
    if (!isTopLevelConst(stmt)) continue;
    if (stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword)) continue;
    for (const decl of stmt.declarationList.declarations) {
      // `const q: override<f32> = 1.` is a specialization constant, not a module constant:
      // its value is the DEFAULT a pipeline may replace, so overrides.ts owns it and folding
      // it here would bake in a value the pipeline is allowed to change (#8 A7).
      if (isOverrideType(decl.type)) continue;
      // A `const` with a module-variable wrapper is module-vars.ts's to refuse, with the fix
      // (`let`), not this collector's to fold.
      if (moduleVarSpace(decl.type) !== undefined) continue;
      // `const f = (x: f32): f32 => ...` at the top level is a FUNCTION of the module, which
      // local-functions.ts collects (roadmap 0.3 item T7, #92), not a constant to fold.
      if (localFunctionOf(decl) !== undefined) continue;
      // `const AgedParticle = Aged(Particle)` names a mixin APPLICATION (T8, #92): a class,
      // decided when the file is compiled, not a value to fold. structs.ts reads it where a
      // class extends it.
      if (isMixinApplication(decl, sourceFile)) continue;
      const c = lowerOne(
        decl,
        sourceFile,
        scope,
        diagnostics,
        valueExprs,
        prefix === '' || !ts.isIdentifier(decl.name)
          ? undefined
          : namespaceMemberName(prefix, decl.name.text),
      );
      if (!c) continue;
      out.push(c);
      if (c.valueExpr) valueExprs.set(c.name, c.valueExpr);
    }
  }
  return out;
}

/** The shapes {@link ConstDecl.valueExpr} documents as constant-foldable: a literal, a
 *  WHOLE constant declared earlier in the file, a constructor over those, and arithmetic
 *  over those. Anything reading a binding, a parameter or a runtime input is not one, and
 *  neither is a call, a swizzle, a member, an index or a conditional — a module constant is
 *  folded once at emit, not evaluated.
 *
 *  Division is the one arm that looks at a value rather than a shape. The scalar path gets
 *  that for free — `foldConstNumber` returns `undefined` for `/ 0`, so `const K: f32 = 1. / 0.`
 *  never becomes a constant — but this path only asked whether the operands were foldable, so
 *  `const Y = vec3(1. / ZERO, 0., 0.)` compiled with no diagnostic at all: Tint refuses the
 *  WGSL it produces, and GLSL and the CPU oracle disagree about the value. A divisor this can
 *  prove is zero is refused here instead. */
/** Whether `e` is a constant by the measure a non-scalar module const is held to: literals,
 *  module consts, constructors, arithmetic and const-evaluable math over those, with a divisor
 *  this can prove is zero refused. What a module variable's array or struct initializer has to
 *  be (§24), since the componentwise folder stops at vectors. */
export function isFoldableConstExpr(e: Expr, scope: LoweringScope): boolean {
  return isFoldableValueExpr(e, scope, new Map());
}

function isFoldableValueExpr(
  e: Expr,
  scope: LoweringScope,
  valueExprs: ReadonlyMap<string, Expr>,
): boolean {
  switch (e.op) {
    case 'lit':
    case 'constref':
      return true;
    case 'unop':
      return isFoldableValueExpr(e.a, scope, valueExprs);
    case 'binop':
      if ((e.bop === '/' || e.bop === '%') && foldsToZero(e.b, scope, valueExprs)) return false;
      return (
        isFoldableValueExpr(e.a, scope, valueExprs) && isFoldableValueExpr(e.b, scope, valueExprs)
      );
    case 'construct':
      return e.args.every((a) => isFoldableValueExpr(a, scope, valueExprs));
    // A math builtin over constant arguments (issue #73): `normalize(vec3(1., 1., 0.))`. Not
    // a declared function of the same name, and not a derivative, which has no value outside
    // a fragment invocation. The call is emitted as written, so the GPU computes it.
    case 'call':
      return (
        e.declRef === undefined &&
        isConstEvaluableMathFn(e.fn) &&
        e.args.every((a) => isFoldableValueExpr(a, scope, valueExprs))
      );
    default:
      return false;
  }
}

/** Whether `e` is a divisor this can PROVE is zero: a scalar that folds to 0, or a vector
 *  constructor with a component that does (`v / vec3(1., 0., 1.)` divides componentwise, so
 *  one zero is enough). A divisor that does not fold is not proven anything and passes — the
 *  point is to refuse what is certainly undefined, not to demand a proof of safety. */
function foldsToZero(
  e: Expr,
  scope: LoweringScope,
  valueExprs: ReadonlyMap<string, Expr>,
): boolean {
  // The componentwise folder (loop-bound.ts) follows a reference to an earlier vector const
  // through `valueExprs` (`const Z = vec3(1., 0., 1.); const Y = A / Z`), negates (`A / -Z`) and
  // folds vector arithmetic (`const STEP = SIZE * 0.5; X / STEP`), the three shapes #68 found
  // the earlier construct-or-scalar walk missing. One zero component is enough: the division
  // is componentwise, and Tint refuses the module for the one component it cannot represent.
  const parts = foldConstComponents(e, scope, valueExprs);
  return parts !== undefined && parts.some((v) => v === 0);
}

/** The kinds a `valueExpr` constant may have, as {@link ConstDecl.valueExpr} documents them.
 *  `struct` and `mat` are listed because the field carries them and every backend emits them,
 *  but neither is reachable from this surface today — a module-scope object literal has no
 *  struct table to match against here, and there is no matrix constructor — so the diagnostic
 *  below names only the vector and the array. A vec64 is not listed either, and there is no
 *  way to build one at module scope to test the refusal with: `vec3f64(...)` is not a
 *  constructor this surface has, so the exclusion is a statement of intent, not a live arm. */
function isValueExprType(t: ShaderType): boolean {
  // An array OF arrays is refused: the GLSL ES 3.00 writer spells the element type inline and
  // the nested form it produces is not something ANGLE accepts, so allowing it here would ship
  // a declaration that compiles on one backend and not the other.
  if (t.kind === 'array') return t.elem.kind !== 'array';
  return t.kind === 'vec' || t.kind === 'struct' || t.kind === 'mat';
}

/** `const UP = vec3(0., 1., 0.)` and friends: a module constant whose value is a whole
 *  vector, array, struct or matrix rather than a scalar. It is emitted from
 *  {@link ConstDecl.valueExpr}, the field the EDSL's `constExpr(name, type, node)` fills, so
 *  the two surfaces produce the same declaration and the WGSL writer, the GLSL writer and
 *  both CPU backends all take the path they already had for it. */
function valueExprConst(
  name: string,
  decl: ConstSite,
  init: Expr,
  annotated: ShaderType | undefined,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
  valueExprs: ReadonlyMap<string, Expr>,
): ConstDecl | undefined {
  const type = annotated ?? init.type;
  if (annotated && typeKey(annotated) !== typeKey(init.type)) {
    diagnostics.push(
      makeDiagnostic(
        sourceFile,
        decl,
        `Module const "${name}" is declared ${typeKey(annotated)} but its value is ${typeKey(init.type)}.`,
        TS_CODES.TYPE_MISMATCH,
      ),
    );
    return undefined;
  }
  // Constant-ness first, TYPE second. The other order answered `const K: f32 = sin(1.)` with
  // "f32 is neither a foldable scalar nor a whole vector or array", which is untrue of f32 —
  // the problem was never the type. Now the type message fires only for a value that IS
  // constant and whose type this surface cannot carry.
  if (!isFoldableValueExpr(init, scope, valueExprs)) {
    diagnostics.push(
      makeDiagnostic(
        sourceFile,
        decl,
        `Module const "${name}" must be constant: a literal, a whole earlier module const, ` +
          `a constructor over those, or arithmetic over those with a non-zero divisor. ` +
          `It may call a math builtin over those, but not a declared function or a derivative, ` +
          `and it cannot read a resource or take a component, field or element.`,
        TS_CODES.TYPE_MISMATCH,
      ),
    );
    return undefined;
  }
  if (!isValueExprType(type)) {
    diagnostics.push(
      makeDiagnostic(
        sourceFile,
        decl,
        `Module const "${name}" must be a foldable scalar (literal or const expression), ` +
          `or a whole vector or array built from them; ${typeKey(type)} is neither.`,
        TS_CODES.TYPE_MISMATCH,
      ),
    );
    return undefined;
  }
  // The initializer rides on the binding so a later const's divisor that names this one
  // (`A / -Z`) is folded componentwise where the division is lowered, with the sentence that
  // names the divisor (#68).
  scope.define({ kind: 'module', name, type, mutable: false, valueExpr: init });
  return { name, type, wgslValue: 0, cpuValue: 0, valueExpr: init };
}

/** A declaration this collector folds: a top-level `const`, or a class's `static` field,
 *  which is the module constant `Cls_Field` (roadmap 0.3 item T3, #92). Both carry the three
 *  things folding needs: a name, an optional annotation and an initializer. */
type ConstSite = ts.VariableDeclaration | ts.PropertyDeclaration;

function lowerOne(
  decl: ConstSite,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
  valueExprs: ReadonlyMap<string, Expr>,
  /** The name the constant takes in the IR when it is not the name it was written under: a
   *  static field `PI` of a class `K` is the module constant `K_PI`. */
  irName?: string,
): ConstDecl | undefined {
  // A static field's private name is the one other name a constant may take here; it arrives
  // with the name it is emitted as (Rule 8.12).
  if (!ts.isIdentifier(decl.name) && !(ts.isPrivateIdentifier(decl.name) && irName !== undefined)) {
    diagnostics.push(
      makeDiagnostic(
        sourceFile,
        decl.name,
        'Module const must be a simple name.',
        TS_CODES.TOP_LEVEL,
      ),
    );
    return undefined;
  }
  const name = irName ?? (decl.name as ts.Identifier).text;
  if (scope.hasInCurrent(name)) {
    diagnostics.push(
      makeDiagnostic(
        sourceFile,
        decl.name,
        `Duplicate module const "${name}".`,
        TS_CODES.DUPLICATE_SYMBOL,
      ),
    );
    return undefined;
  }
  if (decl.initializer && isResourceCall(decl.initializer)) return undefined;
  if (!decl.initializer) {
    diagnostics.push(
      makeDiagnostic(
        sourceFile,
        decl,
        `Module const "${name}" needs an initializer.`,
        TS_CODES.TOP_LEVEL,
      ),
    );
    return undefined;
  }
  const annotated = decl.type
    ? mapTsTypeToShaderType(decl.type, sourceFile, diagnostics)
    : undefined;
  // A list is lowered AGAINST the annotation, at module scope for the same reason as in a
  // function body (#8 A16): it carries no type of its own. The node it produces is the array
  // `construct` that `array<f32, 3>(...)` already produced here, which `valueExprConst` has
  // carried since #8 A9, so this reaches no new path. Without it the list fell through to the
  // generic "a list is only an initializer" refusal and then a second `Unknown identifier` for
  // a name that never got defined, neither of which says what to write.
  let init: Expr | undefined;
  if (ts.isArrayLiteralExpression(decl.initializer)) {
    if (!annotated) {
      diagnostics.push(
        makeDiagnostic(
          sourceFile,
          decl,
          `Module const "${name}" needs an array type annotation to take a list, e.g. const ${name}: array<f32, ${decl.initializer.elements.length}> = [...].`,
          TS_CODES.UNKNOWN_TYPE,
        ),
      );
      return undefined;
    }
    init = lowerArrayLiteral(decl.initializer, annotated, sourceFile, scope, diagnostics);
  } else {
    // The annotation is the contextual type, which is how a body's `const p: P = { ... }`
    // already knows which struct the object literal builds (§16). Before this a module const
    // of a struct type was "Object literal { x, y } does not match a known struct" whenever
    // the field names alone did not name one (roadmap 0.3 item T7, #92).
    init = lowerExpression(decl.initializer, sourceFile, scope, diagnostics, annotated);
  }
  if (!init) return undefined;
  const folded = foldConstValue(init, scope);
  if (typeof folded !== 'number' && typeof folded !== 'boolean') {
    // A non-scalar constant — a vector, an array, a struct, a matrix — is carried by
    // ConstDecl.valueExpr instead of the wgslValue/cpuValue pair, which is what the EDSL's
    // constExpr fills: both writers emit the expression and the CPU backend evaluates it.
    return valueExprConst(name, decl, init, annotated, sourceFile, scope, diagnostics, valueExprs);
  }
  const type = annotated ?? init.type;
  const k = typeKey(type);
  // A scalar whose initializer calls a math builtin (issue #73): its value is known here, so
  // it can bound a loop, but the emit carries the CALL as `valueExpr` and the GPU computes
  // it, the way `const K: f32 = sin(1.0);` is a constant expression in WGSL and in GLSL ES
  // 3.00. Folding it here instead would spell a JS `Math.sin` where the driver's own `sin`
  // was written. The annotation has to agree with the call's type, since the emitted line
  // carries both: `const K: i32 = floor(2.7);` is not a program.
  const called = containsCall(init);
  if (called && annotated && typeKey(init.type) !== k) {
    diagnostics.push(
      makeDiagnostic(
        sourceFile,
        decl,
        `Module const "${name}" is ${k}, but its initializer is ${typeKey(init.type)}. Cast it, e.g. ${k}(...), or change the annotation.`,
        TS_CODES.TYPE_MISMATCH,
      ),
    );
    return undefined;
  }
  if (k !== 'f32' && k !== 'i32' && k !== 'u32' && k !== 'bool') {
    diagnostics.push(
      makeDiagnostic(
        sourceFile,
        decl,
        `Module const "${name}" must be f32, i32, u32, or bool for now.`,
        TS_CODES.TYPE_MISMATCH,
      ),
    );
    return undefined;
  }
  const numeric = typeof folded === 'boolean' ? (folded ? 1 : 0) : folded;
  // An integer const is range- and integrality-checked HERE rather than left to the
  // backend's `intLit`. Two reasons. Truncating silently (`const K: i32 = 1.5` became 1) hid
  // an author error; and once `emitConst` spells an integer const through `intLit`, an
  // out-of-range value throws SD0017 from inside `emitModule` — which the caller cannot
  // attribute to a line, and which leaves `compile()` reporting no diagnostic at all. A
  // diagnostic here keeps `wgsl` undefined and names the cause.
  if (k === 'i32' || k === 'u32') {
    const lo = k === 'i32' ? -2147483648 : 0;
    const hi = k === 'i32' ? 2147483647 : 4294967295;
    if (!Number.isInteger(numeric)) {
      diagnostics.push(
        makeDiagnostic(
          sourceFile,
          decl,
          `Module const "${name}" is ${k}, but ${numeric} is not an integer.`,
          TS_CODES.TYPE_MISMATCH,
        ),
      );
      return undefined;
    }
    if (numeric < lo || numeric > hi) {
      diagnostics.push(
        makeDiagnostic(
          sourceFile,
          decl,
          `Module const "${name}" is ${k}, but ${numeric} is outside [${lo}, ${hi}].`,
          TS_CODES.TYPE_MISMATCH,
        ),
      );
      return undefined;
    }
  }
  // A bool const is checked here for the same reason (#64). `true`, `false`, `1` and `0` all
  // spell; anything else reached the fail-closed bool arm of each writer's `literal`
  // (`wgsl.ts`, `glsl.ts`) as SD0017 thrown from inside `emitModule`, which `source-file.ts`
  // wraps as TS8015 anchored on the file's `"use typeshade"` directive — the one line that has
  // nothing to do with the declaration. This arm costs the same spurious TS8022 per use the
  // integer arms above already cost, since the binding is never defined; the anchor on the
  // declaration is what the author needs first, and the writers' arms stay for the `fn()`
  // EDSL surface, where a hand-built ConstDecl can carry anything.
  if (k === 'bool' && numeric !== 0 && numeric !== 1) {
    diagnostics.push(
      makeDiagnostic(
        sourceFile,
        decl,
        `Module const "${name}" is bool, but ${numeric} is neither true nor false. Write true, false, 1 or 0.`,
        TS_CODES.TYPE_MISMATCH,
      ),
    );
    return undefined;
  }
  const value = k === 'f32' ? numeric : k === 'bool' ? numeric : Math.trunc(numeric);
  scope.define({
    kind: 'module',
    name,
    type,
    mutable: false,
    constValue: typeof folded === 'boolean' ? folded : value,
  });
  scope.recordDeclaration(sourceFile, decl.name, { name, kind: 'const', type });
  return called
    ? { name, type, wgslValue: value, cpuValue: value, valueExpr: init }
    : { name, type, wgslValue: value, cpuValue: value };
}

/** Whether an expression calls anything, at any depth. */
function containsCall(e: Expr): boolean {
  switch (e.op) {
    case 'call':
      return true;
    case 'binop':
    case 'compare':
    case 'logical':
      return containsCall(e.a) || containsCall(e.b);
    case 'unop':
      return containsCall(e.a);
    case 'construct':
      return e.args.some(containsCall);
    case 'select':
      return containsCall(e.cond) || containsCall(e.ifTrue) || containsCall(e.ifFalse);
    case 'member':
      return containsCall(e.base);
    case 'index':
      return containsCall(e.base) || containsCall(e.idx);
    default:
      return false;
  }
}
