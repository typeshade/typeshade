// === Statement lowering ===
//
// Implements: Rule 7.4 (docs/language-design.md; traced in reqs/).

import ts from 'typescript';
import type { BinOp, Expr, Stmt } from '../../../core/ir/nodes.js';
import type { ShaderType } from '../../../core/ir/types.js';
import { isF64, isVec, isVec64, typeKey, u32T } from '../../../core/ir/types.js';
import type { TsCompilerDiagnostic } from '../source-file.js';
import {
  LoweringScope,
  irNameOf,
  readOnlyPhrase,
  writableRemedy,
  writeRules,
  type Binding,
} from '../context.js';
import { mapTsTypeToShaderType } from '../type-map.js';
import { parseSwizzle } from '../swizzle.js';
import { staticThisClass } from '../class-names.js';
import { refuseAtomicDeclaration } from './atomics.js';
import { lowerBarrierStatement } from './barriers.js';
import { classFunctionOf, lowerMutatingCall } from './class-methods.js';
import { lowerChainPrelude } from './chains.js';
import {
  checkFieldAccess,
  destructuredGetter,
  finishAccessorWrite,
  getterInChain,
  lowerAccessorTarget,
  lowerStaticFieldTarget,
  refuseReadonlyWrite,
  refuseWriteThroughGetter,
  inheritedPrivateStaticField,
  inheritedStaticWrite,
  staticConstantWrite,
  staticFieldRead,
  staticOwnerOf,
  visibleField,
  type AccessorTarget,
} from './class-access.js';
import { lowerUserCall } from './expression-misc.js';
import { localFunctionOf } from './local-functions.js';
import { declaringNode } from './closures.js';
import { isBarrierIntrinsic } from '../../../core/intrinsics.js';
import {
  broadcastResultType,
  f64WidenResultType,
  numericMismatch,
  retargetLit,
} from '../numeric.js';
import {
  retargetDeclaredIntLit,
  retargetIntLitCtx,
  reportIntLitRange,
  shiftAmountMessage,
} from '../lit-coerce.js';
import { lowerExpression, unknownIdentifierSentence } from './expression.js';
import { lowerCall } from './expression-call.js';
import { lowerArrayLiteral } from './expression-array.js';
import { lowerFor, lowerForOf, lowerSwitch, lowerUpdate, lowerWhile } from './control.js';
import { makeDiagnostic } from '../diagnostic.js';
import { withSpan } from '../span.js';
import { foldNumericLit } from '../lit-coerce.js';
import { constShiftAmountOutOfRange, foldConstComponents, foldConstValue } from '../loop-bound.js';
import { TS_CODES, type TsCode } from '../codes.js';
import { unknownNameAlreadyReported } from '../refused-names.js';
import { unknownNameSentence } from '../unknown-names.js';
import { publicFieldNames } from './expression-prop.js';

const ASSIGN_OP: Readonly<Record<number, BinOp>> = {
  [ts.SyntaxKind.PlusEqualsToken]: '+',
  [ts.SyntaxKind.MinusEqualsToken]: '-',
  [ts.SyntaxKind.AsteriskEqualsToken]: '*',
  [ts.SyntaxKind.SlashEqualsToken]: '/',
  [ts.SyntaxKind.PercentEqualsToken]: '%',
};

/** The bitwise compound assignments (#8 A10). Separate from {@link ASSIGN_OP} because they
 *  carry a rule the arithmetic five do not: the target must be an integer scalar. The
 *  `assignOp` IR node and both CPU backends have always taken them — the oracle's own
 *  comment names `x >>= y` on an i32 target — so this is the spelling catching up, not a
 *  new operation. */
const BITWISE_ASSIGN_OP: Readonly<Record<number, BinOp>> = {
  [ts.SyntaxKind.AmpersandEqualsToken]: '&',
  [ts.SyntaxKind.BarEqualsToken]: '|',
  [ts.SyntaxKind.CaretEqualsToken]: '^',
  [ts.SyntaxKind.LessThanLessThanEqualsToken]: '<<',
  [ts.SyntaxKind.GreaterThanGreaterThanEqualsToken]: '>>',
};

export function lowerStatements(
  statements: readonly ts.Statement[],
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt[] {
  const out: Stmt[] = [];
  for (const stmt of statements) {
    const lowered = lowerStatement(stmt, sourceFile, scope, diagnostics);
    if (lowered === undefined) continue;
    if (Array.isArray(lowered)) out.push(...lowered);
    else out.push(lowered);
  }
  return out;
}

/** Lowers one TypeScript statement, then stamps every IR statement it produced with `node`'s
 *  source span unless a finer capture site already stamped one (`withSpan` keeps the first).
 *  Doing it here, at the one place every statement kind passes through, is what makes span
 *  capture total: a new statement kind inherits it by being lowered, not by remembering to
 *  call something. A `ts.Block` lowers to its own inner statements, each of which already
 *  carries its own span, so the blanket stamp is a no-op there. */
export function lowerStatement(
  node: ts.Statement,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt | Stmt[] | undefined {
  const lowered = lowerStatementNode(node, sourceFile, scope, diagnostics);
  if (lowered === undefined) return undefined;
  if (Array.isArray(lowered)) {
    for (const s of lowered) withSpan(s, sourceFile, node);
    return lowered;
  }
  return withSpan(lowered, sourceFile, node);
}

function lowerStatementNode(
  node: ts.Statement,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt | Stmt[] | undefined {
  // A chain that is the whole of a call statement or of a `return` runs each call but the last
  // as a statement of its own, ahead of this one, on the object it started from (chains.ts).
  const whole =
    ts.isExpressionStatement(node) &&
    ts.isCallExpression(node.expression) &&
    node.expression.expression.kind !== ts.SyntaxKind.SuperKeyword
      ? node.expression
      : ts.isReturnStatement(node)
        ? node.expression
        : undefined;
  if (whole !== undefined) {
    const prelude = lowerChainPrelude(whole, sourceFile, scope, diagnostics);
    if (prelude === undefined) return undefined;
    if (prelude !== 'not-a-chain') {
      const rest = lowerStatementKind(node, sourceFile, scope, diagnostics);
      if (rest === undefined) return undefined;
      return [...prelude, ...(Array.isArray(rest) ? rest : [rest])];
    }
  }
  return lowerStatementKind(node, sourceFile, scope, diagnostics);
}

function lowerStatementKind(
  node: ts.Statement,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt | Stmt[] | undefined {
  if (ts.isBlock(node)) return lowerBlock(node, sourceFile, scope, diagnostics);
  if (
    ts.isExpressionStatement(node) &&
    ts.isCallExpression(node.expression) &&
    node.expression.expression.kind === ts.SyntaxKind.SuperKeyword
  ) {
    return lowerSuperCall(node.expression, sourceFile, scope, diagnostics);
  }
  if (ts.isReturnStatement(node)) {
    if (!node.expression) return { s: 'return' };
    // The declared return type is the context an object literal needs: `return { pos, uv }`
    // in a function declared VsOut builds a VsOut, even when another struct has the same
    // fields (#8 A11).
    const expr = lowerExpression(
      node.expression,
      sourceFile,
      scope,
      diagnostics,
      scope.returnType(),
    );
    if (!expr) return undefined;
    // `return g()` where `g` returns nothing calls it and returns nothing, as TypeScript does;
    // neither target has a value for it to hand back.
    if (typeKey(expr.type) === 'void' && expr.op === 'call') {
      return [withSpan({ s: 'call', expr }, sourceFile, node), { s: 'return' }];
    }
    // `return 0` takes the declared return type when that type is i32 or u32 (#8 A3).
    const ret = scope.returnType();
    if (!ret) {
      // In a function that writes no return type, the first `return` with a value says it, and
      // the ones after it are typed against it as against a written one (Rule 8.19).
      const into = scope.inferredReturn();
      if (into !== undefined) {
        (into as { ret: ShaderType }).ret = expr.type;
        scope.setReturnType(expr.type);
      }
      return { s: 'return', expr };
    }
    const retargeted = retargetIntLitCtx(expr, node.expression, ret);
    return {
      s: 'return',
      expr:
        reportIntLitRange(retargeted, node.expression, ret, sourceFile, diagnostics) ?? retargeted,
    };
  }
  if (ts.isIfStatement(node)) return lowerIf(node, sourceFile, scope, diagnostics);
  if (ts.isForStatement(node)) return lowerFor(node, sourceFile, scope, diagnostics);
  if (ts.isWhileStatement(node)) return lowerWhile(node, sourceFile, scope, diagnostics);
  if (ts.isForOfStatement(node)) return lowerForOf(node, sourceFile, scope, diagnostics);
  if (ts.isSwitchStatement(node)) return lowerSwitch(node, sourceFile, scope, diagnostics);
  if (ts.isBreakStatement(node)) {
    // The message has always said "loop or switch"; only the loop half was checked, so the
    // `break` every TypeScript author ends a `case` with was rejected by the very sentence
    // that said it was allowed (#8 A10). lowerSwitch drops a TRAILING break — the IR switch
    // has no fall-through and each backend writes its own case terminator — so this reaches
    // the IR only for a break that leaves the switch early, which is a real statement.
    if (!scope.inLoop() && !scope.inSwitch()) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        'break is only valid inside a loop or switch.',
        TS_CODES.BREAK_OUTSIDE,
      );
      return undefined;
    }
    return { s: 'break' };
  }
  if (ts.isContinueStatement(node)) {
    if (!scope.inLoop()) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        'continue is only valid inside a loop.',
        TS_CODES.BREAK_OUTSIDE,
      );
      return undefined;
    }
    return { s: 'continue' };
  }
  if (ts.isVariableStatement(node))
    return lowerVariableStatement(node, sourceFile, scope, diagnostics);
  if (ts.isExpressionStatement(node))
    return lowerExpressionStatement(node, sourceFile, scope, diagnostics);
  // Two shapes that deserve their own sentence rather than the catch-all below (§52). Both
  // are recorded deferrals, not oversights: the reason is in the message and in the docs.
  // `while (c)` is accepted and reads its bound from the CONDITION, not from a header
  // (`lowerWhile` lowers it into the one loop node the IR has, with a synthetic counter), so
  // "a do…while has no header" would not be the reason. The reason is the loop node itself:
  // the IR has a single top-tested `for`, and a do…while runs its body once BEFORE the test,
  // which that shape cannot express. WGSL spells it `loop { body; break if !(c); }`
  // (wgsl.txt:11554, 11872-11878) and GLSL ES 3.00 has `do…while` outright — so both targets
  // could carry it; what is missing is an IR node for a bottom-tested loop, and adding one
  // means a new `Stmt` kind through all three backends and the trip-count analysis. A
  // recorded deferral, not a target constraint.
  // A `function` declaration inside a body is a local function (Rule 8.17): lifted out as a
  // function of the module before the body is lowered, so the statement itself runs nothing.
  if (ts.isFunctionDeclaration(node) && node.body !== undefined) return [];
  if (ts.isDoStatement(node)) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `do…while is not supported: the IR has one loop shape, a top-tested "for", and a ` +
        `do…while runs its body before the first test. Write "while (c) { … }" with the ` +
        `body's first pass unrolled above it, or a counted "for".`,
      TS_CODES.UNSUPPORTED,
    );
    return undefined;
  }
  if (ts.isLabeledStatement(node)) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `A labelled statement is not supported: neither WGSL nor GLSL ES 3.00 has a label, so ` +
        `"${node.label.text}:" has nothing to name it for. Restructure with a flag, or hoist ` +
        `the inner loop into a function and return from it.`,
      TS_CODES.UNSUPPORTED,
    );
    return undefined;
  }
  pushDiag(
    diagnostics,
    sourceFile,
    node,
    `Unsupported statement "${truncate(node.getText(sourceFile))}".`,
    TS_CODES.UNSUPPORTED,
  );
  return undefined;
}

function lowerBlock(
  node: ts.Block,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt[] {
  scope.push();
  try {
    return lowerStatements(node.statements, sourceFile, scope, diagnostics);
  } finally {
    scope.pop();
  }
}

function lowerVariableStatement(
  node: ts.VariableStatement,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt | Stmt[] | undefined {
  const flags = node.declarationList.flags;
  const isConst = (flags & ts.NodeFlags.Const) !== 0;
  const isLet = (flags & ts.NodeFlags.Let) !== 0;
  if (!isConst && !isLet) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      'Use "const" or "let". The JS "var" keyword is not supported.',
      TS_CODES.UNSUPPORTED,
    );
    return undefined;
  }
  // One declarator is the overwhelmingly common case, and there the statement IS the
  // declaration: stamping the declarator alone gives a span starting after the `const`/`let`
  // keyword, so a breakpoint on that line points mid-statement. Several declarators genuinely
  // lower to several IR statements, and there each must span its own, or stepping through
  // `const a = 1, b = 2` highlights the whole line twice.
  const single = node.declarationList.declarations.length === 1;
  const results: Stmt[] = [];
  for (const decl of node.declarationList.declarations) {
    // The node whose span the lowered statement takes, decided here because only this level
    // knows how many declarators there are.
    const one = lowerVariableDeclaration(
      decl,
      isConst,
      sourceFile,
      scope,
      diagnostics,
      single ? node : decl,
    );
    if (Array.isArray(one)) results.push(...one);
    else if (one) results.push(one);
  }
  if (results.length === 0) return undefined;
  return results.length === 1 ? results[0] : results;
}

function lowerVariableDeclaration(
  decl: ts.VariableDeclaration,
  isConst: boolean,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
  spanNode: ts.Node = decl,
): Stmt | Stmt[] | undefined {
  // `const { x, y } = uv` is the field reads it stands for (roadmap 0.3 item T7, #92): one
  // declaration per name, in the order written. Before this it was "Destructuring is not
  // supported", which is a shape a TypeScript developer reaches for without thinking.
  // `const f = (x: f32): f32 => ...` declares a FUNCTION of the module, not a local
  // (roadmap 0.3 item T7, #92): local-functions.ts collected it, or said why it could not, so
  // the declaration itself emits nothing here either way.
  if (localFunctionOf(decl) !== undefined) return undefined;
  // A chain that is the whole initializer runs its calls ahead of the declaration (chains.ts).
  if (decl.initializer !== undefined) {
    const prelude = lowerChainPrelude(decl.initializer, sourceFile, scope, diagnostics);
    if (prelude === undefined) return undefined;
    if (prelude !== 'not-a-chain') {
      const rest = lowerDeclarationKind(decl, isConst, sourceFile, scope, diagnostics, spanNode);
      if (rest === undefined) return undefined;
      return [...prelude, ...(Array.isArray(rest) ? rest : [rest])];
    }
  }
  return lowerDeclarationKind(decl, isConst, sourceFile, scope, diagnostics, spanNode);
}

/** `let s: Shape = new this()` in a static that `Big` inherits: the body is lowered again for
 *  `Big` with `this` as `Big` (Rule 8.13), so what `new this()` builds is a `Big`, and the class
 *  the body names for it, its own, is the class the call names, as its return type is. */
function builtThisType(
  annotated: ShaderType,
  decl: ts.VariableDeclaration,
  scope: LoweringScope,
): ShaderType {
  const init = decl.initializer !== undefined ? unwrapParens(decl.initializer) : undefined;
  if (
    annotated.kind !== 'struct' ||
    init === undefined ||
    !ts.isNewExpression(init) ||
    init.expression.kind !== ts.SyntaxKind.ThisKeyword
  ) {
    return annotated;
  }
  const lexical = staticThisClass(init.expression)?.name?.text;
  const runsFor = scope.staticClass();
  return lexical === annotated.name && runsFor !== undefined && runsFor !== lexical
    ? { kind: 'struct', name: runsFor }
    : annotated;
}

function lowerDeclarationKind(
  decl: ts.VariableDeclaration,
  isConst: boolean,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
  spanNode: ts.Node,
): Stmt | Stmt[] | undefined {
  if (ts.isObjectBindingPattern(decl.name)) {
    return lowerObjectPattern(decl.name, decl, isConst, sourceFile, scope, diagnostics, spanNode);
  }
  if (!ts.isIdentifier(decl.name)) {
    pushDiag(
      diagnostics,
      sourceFile,
      decl.name,
      ts.isArrayBindingPattern(decl.name)
        ? 'A list is not destructured here: a vector is read by component (v.x, v.y) and an ' +
            'array by index (xs[0]). Write "const x = v.x" or "const a = xs[0]".'
        : 'Destructuring is not supported.',
      TS_CODES.UNSUPPORTED,
    );
    return undefined;
  }
  const name = decl.name.text;
  if (scope.hasInCurrent(name)) {
    pushDiag(
      diagnostics,
      sourceFile,
      decl.name,
      `Duplicate binding "${name}" in this scope.`,
      TS_CODES.DUPLICATE_SYMBOL,
    );
    return undefined;
  }
  let annotated: ShaderType | undefined;
  if (decl.type) {
    annotated = mapTsTypeToShaderType(decl.type, sourceFile, diagnostics);
    if (!annotated) return undefined;
    if (refuseAtomicDeclaration(annotated, decl.type, sourceFile, diagnostics, 'a local'))
      return undefined;
    annotated = builtThisType(annotated, decl, scope);
  }
  if (!decl.initializer) {
    // `let x: f32;` — declare now, assign later (#8 A10). WGSL's `var x: f32;` and GLSL's
    // `float x;` are the same statement, `Stmt.var.init` has always been optional, and the
    // EDSL spells it `Var(f32T)`; only this surface insisted on a value. A `const` has
    // nothing to assign later, and an unannotated `let` has no type to declare, so both
    // keep a refusal — now one that says which of the two is missing.
    if (isConst) {
      pushDiag(
        diagnostics,
        sourceFile,
        decl,
        `"const ${name}" requires an initializer.`,
        TS_CODES.UNSUPPORTED,
      );
      return undefined;
    }
    if (!annotated) {
      pushDiag(
        diagnostics,
        sourceFile,
        decl,
        `"let ${name}" without an initializer needs a type annotation, e.g. let ${name}: f32;`,
        TS_CODES.UNSUPPORTED,
      );
      return undefined;
    }
    const bound = defineLocal(
      name,
      annotated,
      true,
      undefined,
      decl,
      sourceFile,
      scope,
      diagnostics,
    );
    if (!bound) return undefined;
    return withSpan(
      { s: 'var', name: irNameOf(bound), type: annotated } as Stmt,
      sourceFile,
      spanNode,
    );
  }
  // `const xs: array<f32, 3> = [1., 2., 3.]` (#8 A16). A list carries no type of its own, so it
  // is lowered AGAINST the annotation instead of on its own, and refused where there is none.
  // From here it is the ordinary `construct` the `array<f32, 3>(...)` call builds, so the rest
  // of this function — the type check, the binding, the span — does not know the difference.
  // Every other initializer takes the annotation as its CONTEXT (#8 A11), which is the weaker
  // form of the same idea: an object literal reads it to pick its struct, a bare integer
  // literal to take its type, and everything else ignores it.
  let init: Expr | undefined;
  if (ts.isArrayLiteralExpression(decl.initializer)) {
    if (!annotated) {
      const kw = isConst ? 'const' : 'let';
      pushDiag(
        diagnostics,
        sourceFile,
        decl,
        `"${kw} ${name}" needs an array type annotation to take a list, e.g. ${kw} ${name}: array<f32, ${decl.initializer.elements.length}> = [...].`,
        TS_CODES.UNKNOWN_TYPE,
      );
      return undefined;
    }
    init = lowerArrayLiteral(decl.initializer, annotated, sourceFile, scope, diagnostics);
  } else {
    init = lowerExpression(decl.initializer, sourceFile, scope, diagnostics, annotated);
  }
  if (!init) return undefined;
  // A call that returns nothing has nothing to bind: `const x = store(1)` emitted
  // `let x = store(1u);`, which Tint refuses, with no diagnostic.
  if (init.type.kind === 'void') {
    pushDiag(
      diagnostics,
      sourceFile,
      decl.initializer,
      `"${truncate(decl.initializer.getText(sourceFile))}" returns nothing, so it cannot initialize "${name}"; call it on its own line.`,
      TS_CODES.TYPE_MISMATCH,
    );
    return undefined;
  }
  if (annotated) {
    if (init.op === 'lit' && typeof init.value === 'boolean' && typeKey(annotated) === 'bool') {
      init = { op: 'lit', type: annotated, value: init.value };
    } else {
      // `let j: i32 = -1` takes its declared type like any other position (#8 A3, issue #40).
      // A negative literal is a PrefixUnaryExpression, not a NumericLiteral, so the
      // `init.op === 'lit'` special case this replaces never fired for one and the author was
      // told to cast an integer they had already written. `retargetDeclaredIntLit` keeps that
      // old special case as its fallback — `let y: i32 = 0.` and `let y: i32 = 1e3` compiled
      // before this item and still do — while `let j: i32 = 1.5` stays refused, since the
      // fallback takes an integral value only and the type check below catches the rest.
      init = retargetDeclaredIntLit(init, decl.initializer, annotated);
      init = reportIntLitRange(init, decl.initializer, annotated, sourceFile, diagnostics) ?? init;
    }
  }
  if (annotated && typeKey(annotated) !== typeKey(init.type)) {
    pushDiag(
      diagnostics,
      sourceFile,
      decl,
      numericMismatch(`let/const ${name}`, annotated, init.type) +
        scope.inheritanceNote(annotated, init.type),
      TS_CODES.TYPE_MISMATCH,
    );
    return undefined;
  }
  const bindingType = annotated ?? init.type;
  // Folded through the SCOPE, not just `init.op === 'lit'` (#154). A negated literal is a unop,
  // an alias is a varref and `Math.floor(-1.5)` is a call, so all three used to leave the
  // binding with no compile-time value at all while the const-propagation pass substituted one
  // downstream regardless — which is how `u32(k)` reached a backend as a conversion nothing had
  // checked. `foldConstValue` is the folder every other compile-time rule already uses (loop
  // bounds, the zero-divisor proof), so a const binding now knows exactly what they know, with
  // the same integer wrap the emitted module carries.
  const constValue = foldConstValue(init, scope);
  // `const a = src` keeps the name it copies, so `a.length` on a storage array is answered the
  // way `src.length` is (#46). Only a bare name; an element or a field is a different value.
  const aliasOf = init.op === 'varref' ? init.name : undefined;
  const bound = defineLocal(
    name,
    bindingType,
    !isConst,
    constValue,
    decl,
    sourceFile,
    scope,
    diagnostics,
    aliasOf,
  );
  if (!bound) return undefined;
  // The statement carries the IR name, `p_1` for a `p` that shadows or follows another `p` in
  // the function (#38); the symbol table and every diagnostic keep the source name.
  const ir = irNameOf(bound);
  if (isConst) {
    const stmt = withSpan({ s: 'let', name: ir, expr: init } as Stmt, sourceFile, spanNode);
    // `const v = new V()` binds `v` once and leaves what it holds writable, as TypeScript's
    // `const` does (Rule 6.10). The declaration stays a `let` until something writes into
    // `v`, and becomes a `var` then: nothing else holds the value, so the copy is the object.
    if (isComposite(bindingType) && decl.initializer && buildsFreshValue(decl.initializer, init)) {
      (bound as { toVar?: () => void }).toVar = (): void => {
        const st = stmt as { s: string; type?: ShaderType; init?: Expr; expr?: Expr };
        if (st.s === 'var') return;
        st.s = 'var';
        st.type = bindingType;
        st.init = st.expr;
        delete st.expr;
        (bound as { mutable: boolean }).mutable = true;
      };
    }
    return stmt;
  }
  return withSpan({ s: 'var', name: ir, type: bindingType, init } as Stmt, sourceFile, spanNode);
}

/** A value a name can be written through: a struct, an array, a vector or a matrix. */
const isComposite = (t: ShaderType): boolean =>
  t.kind === 'struct' || t.kind === 'array' || t.kind === 'vec' || t.kind === 'mat';

/** Whether a `const`'s initializer builds a value nothing else holds (Rule 6.10): `new`, an
 *  object or an array literal, a type's constructor, or calls on one of those, which leave
 *  nothing else holding what they return. A name, a field, an element or a function's result
 *  may be a value something else holds, which TypeScript would share and a copy here would not. */
function buildsFreshValue(init: ts.Expression, lowered: Expr): boolean {
  if (lowered.op === 'construct') return true;
  let x = unwrapParens(init);
  while (ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression)) {
    x = unwrapParens(x.expression.expression);
  }
  return ts.isNewExpression(x) || ts.isObjectLiteralExpression(x) || ts.isArrayLiteralExpression(x);
}

/** Why a write through a `const` that holds a copy is refused (Rule 6.10). */
export function constCopyWrite(name: string): string {
  return (
    `"${name}" is a const whose value may be one something else holds, which TypeScript would ` +
    `change with it and a copy here would not. Declare it with let to write a copy, or write ` +
    `through the value itself.`
  );
}

/** `super(a, b)` in a derived class's constructor (roadmap 0.3 item T5, #92).
 *
 *  A struct here is flat: a derived one carries the base's fields, under the same names, ahead
 *  of its own. So the base's constructor is called as the function it already is, and what it
 *  returns is copied field by field into the object being built:
 *
 *      let _sup = Base_new(a, b);
 *      self_.x = _sup.x;
 *
 *  The call goes through {@link lowerUserCall}, so its arguments are checked, and its defaults
 *  filled, exactly as `new Base(a, b)` would be. A base whose chain declares no constructor
 *  has nothing to run, and a bare `super()` there lowers to nothing, which is what TypeScript's
 *  implicit constructor does.
 *
 *  Anywhere but a constructor of a class that extends one, `super(...)` is refused. */
function lowerSuperCall(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt[] | undefined {
  const self = scope.resolve('this');
  if (!self) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      '"super(...)" belongs in a constructor; there is no object being built here.',
      TS_CODES.UNSUPPORTED,
    );
    return undefined;
  }
  const sup = scope.superCtor();
  if (sup === undefined) {
    if (node.arguments.length === 0) return [];
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      '"super(...)" passes arguments to a base constructor, and nothing this class extends ' +
        'declares one. Assign the fields here instead.',
      TS_CODES.UNSUPPORTED,
    );
    return undefined;
  }
  const decl = scope.resolveCallee(sup.fn);
  if (!decl) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `"super(...)" calls "${sup.fn}", which this module does not emit.`,
      TS_CODES.UNKNOWN_NAME,
    );
    return undefined;
  }
  const call = lowerUserCall(node, decl, sourceFile, scope, diagnostics, { shown: 'super' });
  if (!call) return undefined;
  const ir = scope.defineTemp('_sup', sup.type);
  const out: Stmt[] = [{ s: 'let', name: ir, expr: call }];
  const base: Expr = { op: 'varref', type: sup.type, name: ir };
  const selfExpr: Expr =
    self.kind === 'param'
      ? { op: 'param', type: self.type, name: irNameOf(self) }
      : { op: 'varref', type: self.type, name: irNameOf(self) };
  for (const f of sup.fields) {
    out.push({
      s: 'assign',
      target: { op: 'member', type: f.type, base: selfExpr, field: f.name },
      expr: { op: 'member', type: f.type, base, field: f.name },
    });
  }
  // Then this class's parameter properties and field initializers, which TypeScript runs when
  // `super(...)` returns (Rule 8.14).
  out.push(...scope.takeAfterSuper());
  return out;
}

/** `const { x, y } = v`, and the renaming and nesting forms of it (roadmap 0.3 item T7, #92).
 *
 *  A destructuring declaration is the reads it stands for, so it lowers to one declaration per
 *  name, in the order written, each reading a field of the value on the right. The value is
 *  lowered ONCE: a bare name is read again for each field, since reading a name twice costs
 *  nothing and names no new local, and anything else is bound to a local of its own first so a
 *  call or an arithmetic expression on the right runs once.
 *
 *  What has no form here is refused with the read to write instead: a default (`{ x = 1 }`),
 *  which needs a value that may be absent; a rest (`{ ...r }`), which needs a type this surface
 *  does not build; and a computed name, which needs a field chosen at run time. */
function lowerObjectPattern(
  pattern: ts.ObjectBindingPattern,
  decl: ts.VariableDeclaration,
  isConst: boolean,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
  spanNode: ts.Node,
): Stmt[] | undefined {
  if (!decl.initializer) {
    pushDiag(
      diagnostics,
      sourceFile,
      decl,
      'A destructuring declaration needs a value to read from, e.g. const { x, y } = v.',
      TS_CODES.UNSUPPORTED,
    );
    return undefined;
  }
  if (decl.type) {
    pushDiag(
      diagnostics,
      sourceFile,
      decl.type,
      'A destructuring declaration takes no type annotation; each name takes the type of the ' +
        'field it reads.',
      TS_CODES.UNSUPPORTED,
    );
    return undefined;
  }
  const value = lowerExpression(decl.initializer, sourceFile, scope, diagnostics);
  if (!value) return undefined;
  const out: Stmt[] = [];
  let base = value;
  // A bare name costs nothing to read again; anything else runs once, into a local. The local
  // is internal, so it takes an IR name and no source name: the program may declare `_d` itself,
  // and one block may hold two of these.
  if (value.op !== 'varref' && value.op !== 'param' && value.op !== 'constref') {
    const ir = scope.defineTemp('_d', value.type);
    out.push(withSpan({ s: 'let', name: ir, expr: value } as Stmt, sourceFile, spanNode));
    base = { op: 'varref', type: value.type, name: ir };
  }
  return lowerPatternInto(
    pattern,
    base,
    isConst,
    decl,
    sourceFile,
    scope,
    diagnostics,
    spanNode,
    out,
  )
    ? out
    : undefined;
}

/** One binding pattern's elements, read off `base`. Recurses for a nested pattern, which reads
 *  off the field it names rather than binding a name of its own. */
function lowerPatternInto(
  pattern: ts.ObjectBindingPattern,
  base: Expr,
  isConst: boolean,
  decl: ts.VariableDeclaration,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
  spanNode: ts.Node,
  out: Stmt[],
): boolean {
  for (const element of pattern.elements) {
    if (element.dotDotDotToken) {
      pushDiag(
        diagnostics,
        sourceFile,
        element,
        'A rest element has no shader form: a struct is exactly its fields, so there is no ' +
          'remainder to name. Read the fields you need.',
        TS_CODES.UNSUPPORTED,
      );
      return false;
    }
    if (element.initializer) {
      pushDiag(
        diagnostics,
        sourceFile,
        element,
        'A default in a pattern has no shader form: every field of a struct is present, so ' +
          'there is nothing for it to stand in for.',
        TS_CODES.UNSUPPORTED,
      );
      return false;
    }
    // `{ x: a }` names the field in `propertyName` and the local in `name`; `{ x }` has only
    // the second, and the field is the same word.
    const fieldNode = element.propertyName ?? element.name;
    if (!ts.isIdentifier(fieldNode)) {
      pushDiag(
        diagnostics,
        sourceFile,
        fieldNode,
        'A field is named by a plain identifier here; a computed name would choose a field at ' +
          'run time, which no shader type does.',
        TS_CODES.UNSUPPORTED,
      );
      return false;
    }
    const field = fieldNode.text;
    const read = readField(base, field, element, sourceFile, scope, diagnostics);
    if (!read) return false;
    if (ts.isObjectBindingPattern(element.name)) {
      if (
        !lowerPatternInto(
          element.name,
          read,
          isConst,
          decl,
          sourceFile,
          scope,
          diagnostics,
          spanNode,
          out,
        )
      ) {
        return false;
      }
      continue;
    }
    if (!ts.isIdentifier(element.name)) {
      pushDiag(
        diagnostics,
        sourceFile,
        element.name,
        'A list is not destructured here: read a vector by component and an array by index.',
        TS_CODES.UNSUPPORTED,
      );
      return false;
    }
    const bound = defineLocal(
      element.name.text,
      read.type,
      !isConst,
      undefined,
      decl,
      sourceFile,
      scope,
      diagnostics,
    );
    if (!bound) return false;
    const ir = irNameOf(bound);
    out.push(
      withSpan(
        isConst
          ? ({ s: 'let', name: ir, expr: read } as Stmt)
          : ({ s: 'var', name: ir, type: read.type, init: read } as Stmt),
        sourceFile,
        spanNode,
      ),
    );
  }
  return true;
}

/** One field or component read off `base`, or undefined after a diagnostic. The two shapes a
 *  pattern can read from: a struct, by field, and a vector, by component. */
function readField(
  base: Expr,
  field: string,
  at: ts.Node,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  if (base.type.kind === 'struct') {
    // A pattern names public members only: `#x` is not a property to destructure, and `x` does
    // not reach it (Rule 8.12). A getter is read by calling it, as TypeScript's pattern does
    // (Rule 8.11).
    const type = visibleField(base.type.name, field, at, scope);
    if (type && !checkFieldAccess(base.type.name, field, at, sourceFile, scope, diagnostics)) {
      return undefined;
    }
    if (!type) {
      const read = destructuredGetter(
        base.type.name,
        field,
        base,
        at,
        sourceFile,
        scope,
        diagnostics,
      );
      if (read !== 'none') return read;
      pushDiag(
        diagnostics,
        sourceFile,
        at,
        unknownNameSentence(`"${base.type.name}" has no field "${field}".`, field, [
          publicFieldNames(base.type.name, scope),
        ]),
        TS_CODES.UNKNOWN_NAME,
      );
      return undefined;
    }
    return { op: 'member', type, base, field };
  }
  const sw = parseSwizzle(base.type, field);
  if (!sw.ok) {
    pushDiag(diagnostics, sourceFile, at, sw.message, TS_CODES.UNKNOWN_NAME);
    return undefined;
  }
  return { op: 'member', type: sw.type, base, field: sw.field };
}

/** Register a local binding, turning the scope's throw into a diagnostic on the declaration.
 *  Shared by the two declaration shapes — with an initializer and without.
 *
 *  @returns the binding as the scope stored it, with the IR name the statement must carry,
 *  or `undefined` after pushing a diagnostic. */
function defineLocal(
  name: string,
  type: ShaderType,
  mutable: boolean,
  constValue: number | boolean | undefined,
  decl: ts.VariableDeclaration,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
  aliasOf?: string,
): Binding | undefined {
  let bound: Binding;
  try {
    bound = scope.define({
      kind: 'local',
      name,
      type,
      mutable,
      constValue,
      ...(aliasOf !== undefined ? { aliasOf } : {}),
    });
  } catch (e) {
    pushDiag(
      diagnostics,
      sourceFile,
      decl.name,
      e instanceof Error ? e.message : String(e),
      TS_CODES.DUPLICATE_SYMBOL,
    );
    return undefined;
  }
  // #51 records the NAME's span with the declared type, for hover; the caller's `withSpan`
  // records the STATEMENT's, for stepping (#32). Complementary, and both wanted. This sits
  // here rather than at the one call site it had, so the declaration WITHOUT an initializer
  // (`let x: f32;`) is recorded too — the editor should know a name the language now accepts.
  scope.recordDeclaration(sourceFile, decl.name, { name, kind: 'local', type, mutable });
  // What a local function that captures it passes for it (Rule 8.17).
  scope.bindDeclaration(declaringNode(decl, name), bound);
  return bound;
}

function lowerExpressionStatement(
  node: ts.ExpressionStatement,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt | undefined {
  return lowerExpressionAsStatement(node.expression, node, sourceFile, scope, diagnostics);
}

/** The expression body of an arrow function that returns nothing (`() => n += k`, `(x) =>
 *  v.bump(x)`): the expression as a statement, whose value TypeScript drops, and a chain of
 *  `return this` calls run as a statement's is (Rule 8.10). A body that only computes a value
 *  is lowered for what it says and leaves nothing to run. */
export function lowerVoidArrowBody(
  body: ts.Expression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt[] {
  const expr = unwrapParens(body) as ts.Expression;
  const statement =
    ts.isCallExpression(expr) ||
    ts.isPrefixUnaryExpression(expr) ||
    ts.isPostfixUnaryExpression(expr) ||
    (ts.isBinaryExpression(expr) &&
      expr.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      expr.operatorToken.kind <= ts.SyntaxKind.LastAssignment);
  if (!statement) {
    lowerExpression(expr, sourceFile, scope, diagnostics);
    return [];
  }
  const out: Stmt[] = [];
  if (ts.isCallExpression(expr) && expr.expression.kind !== ts.SyntaxKind.SuperKeyword) {
    const prelude = lowerChainPrelude(expr, sourceFile, scope, diagnostics);
    if (prelude === undefined) return [];
    if (prelude !== 'not-a-chain') out.push(...prelude);
  }
  const lowered = lowerExpressionAsStatement(expr, body, sourceFile, scope, diagnostics);
  if (lowered === undefined) return out;
  out.push(withSpan(lowered, sourceFile, body));
  return out;
}

/** `expr` as a statement standing alone, `node` the source a message about it points at. */
function lowerExpressionAsStatement(
  expr: ts.Expression,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt | undefined {
  // `discard;` — WGSL's fragment kill, which the IR already carries as its own statement and
  // both writers spell (`discard;` in WGSL, `discard;` in GLSL ES 3.00). It reads to the TS
  // parser as an expression statement naming `discard`, so it is caught here, before the
  // identifier is looked up as a value and reported as unknown.
  if (ts.isIdentifier(expr) && expr.text === 'discard' && !scope.resolve('discard')) {
    return { s: 'discard' };
  }
  // `store(gid.x);` — a call whose value is dropped, kept for its effect (#47). It lowers
  // through the same path a call in an expression takes, so the callee, arity and argument
  // rules are the ones every call gets; only the statement form is new. A value-returning
  // builtin may stand alone too (`max(a, b);` is legal TypeScript), and the optimizer drops
  // it as the nothing it computes. What may not stand alone is a value that is not a call at
  // all: a vector constructor, a `select`, an array fold. Those build and drop, and TypeShade
  // says so rather than emitting a statement neither target has a use for.
  if (ts.isCallExpression(expr)) {
    // A barrier is a statement and nothing else (§25): lowered here, where it stands alone,
    // with its placement rules; in expression position `lowerCall` refuses it. A function the
    // file declares under the name keeps the call, as with every builtin name.
    if (
      ts.isIdentifier(expr.expression) &&
      isBarrierIntrinsic(expr.expression.text) &&
      scope.resolveCallee(expr.expression.text) === undefined
    ) {
      const barrier = lowerBarrierStatement(
        expr.expression.text,
        expr,
        sourceFile,
        scope,
        diagnostics,
      );
      return barrier ? { s: 'call', expr: barrier } : undefined;
    }
    // A method that changes its object, `r.advance(2.)`, is a call that writes through its
    // receiver, and a value it returns is dropped here (§26); anything else takes the ordinary
    // call path.
    const mutating = lowerMutatingCall(expr, sourceFile, scope, diagnostics);
    if (mutating !== 'not-a-mutating-call') return mutating;
    const call = lowerCall(expr, sourceFile, scope, diagnostics);
    if (!call) return undefined;
    if (call.op !== 'call') {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `"${truncate(node.getText(sourceFile))}" builds a value and drops it. Only a function call may stand alone as a statement; assign the value or remove the line.`,
        TS_CODES.UNSUPPORTED,
      );
      return undefined;
    }
    return { s: 'call', expr: call };
  }
  if (ts.isPrefixUnaryExpression(expr) || ts.isPostfixUnaryExpression(expr)) {
    return lowerUpdate(expr, sourceFile, scope, diagnostics);
  }
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    // `_ = f()`, WGSL's phony assignment (§52): call it and drop the result, explicitly. It
    // is what an author reaches for when a `@must_use` builtin's value is not wanted, and it
    // read as `Cannot assign to unknown name "_"` before. `_` is only phony when nothing
    // declares it, so a program with its own `_` keeps assigning to that.
    if (ts.isIdentifier(expr.left) && expr.left.text === '_' && scope.resolve('_') === undefined) {
      const dropped = lowerExpression(expr.right, sourceFile, scope, diagnostics);
      if (!dropped) return undefined;
      if (dropped.op !== 'call') {
        pushDiag(
          diagnostics,
          sourceFile,
          expr.right,
          `"_ = ..." drops the result of a call. "${truncate(expr.right.getText(sourceFile))}" ` +
            `is not one, so there is nothing to drop; remove the line.`,
          TS_CODES.UNSUPPORTED,
        );
        return undefined;
      }
      // The same IR a bare `f();` makes. The BACKEND decides whether the target needs the
      // `_ = ` spelling — WGSL writes it for a builtin whose result is `@must_use`, GLSL
      // never — so the author's `_` is a statement of intent, not a token to carry through.
      return { s: 'call', expr: dropped };
    }
    return lowerAssign(expr.left, expr.right, sourceFile, scope, diagnostics);
  }
  if (ts.isBinaryExpression(expr)) {
    const bop = ASSIGN_OP[expr.operatorToken.kind];
    if (bop !== undefined)
      return lowerAssignOp(expr.left, bop, expr.right, sourceFile, scope, diagnostics);
    const bit = BITWISE_ASSIGN_OP[expr.operatorToken.kind];
    if (bit !== undefined)
      return lowerBitwiseAssignOp(expr.left, bit, expr.right, sourceFile, scope, diagnostics);
    if (expr.operatorToken.kind === ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken) {
      // The same refusal `a >>> b` gets in lowerBinary, so the two spellings of an
      // unsupported operator do not disagree about why they are unsupported.
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        'Unsigned right shift >>>= is not supported.',
        TS_CODES.UNSUPPORTED,
      );
      return undefined;
    }
  }
  pushDiag(
    diagnostics,
    sourceFile,
    node,
    `Unsupported expression statement "${truncate(node.getText(sourceFile))}".`,
    TS_CODES.UNSUPPORTED,
  );
  return undefined;
}

function lowerAssign(
  left: ts.Expression,
  right: ts.Expression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt | undefined {
  // `o.x = v` where `x` is an accessor is a call of its setter (Rule 8.11).
  const accessor = lowerAccessorTarget(left, false, sourceFile, scope, diagnostics);
  if (accessor === undefined) return undefined;
  const target =
    accessor === 'not-an-accessor' ? lowerLValue(left, sourceFile, scope, diagnostics) : undefined;
  if (accessor === 'not-an-accessor' && !target) return undefined;
  if (target && refuseReadonlyWrite(target, left, sourceFile, scope, diagnostics)) return undefined;
  const want = target?.type ?? (accessor as AccessorTarget).type;
  // The target's type is the context for the right-hand side, so `o = { x: 1., y: 2. }` knows
  // which struct it builds the same way `const o: A = { … }` does (#8 A11). An assignment
  // target is a DECLARED position: the name was annotated where it was declared, and the
  // lvalue carries that type here. Without this the literal fell through to the
  // unique-struct fallback and a second struct of the same shape refused it.
  let value = lowerExpression(right, sourceFile, scope, diagnostics, want);
  if (!value) return undefined;
  // `x = 2` takes the target's type when it is i32 or u32 (#8 A3); the compound form already
  // did through lowerAssignOp.
  value = retargetIntLitCtx(value, right, want);
  value = reportIntLitRange(value, right, want, sourceFile, diagnostics) ?? value;
  if (typeKey(want) !== typeKey(value.type)) {
    pushDiag(
      diagnostics,
      sourceFile,
      right,
      numericMismatch(`assign to ${typeKey(want)}`, want, value.type),
      TS_CODES.TYPE_MISMATCH,
    );
    return undefined;
  }
  return target ? { s: 'assign', target, expr: value } : (accessor as AccessorTarget).write(value);
}

/**
 * Lower `y <<= 1` and its four siblings (`>>=`, `&=`, `|=`, `^=`) — #8 A10.
 *
 * Kept apart from {@link lowerAssignOp} for one reason: the bitwise operators are defined
 * on integers only, and this is a form nothing accepted before, so refusing a float target
 * here rejects no source that compiles today. (`a & b` as an EXPRESSION refuses a float
 * operand too, in `lowerBinary`, except two f32 whole numbers the front end folds: a module
 * constant, an enum member and a `case` label take `1 | 2` as 3, so that stays accepted.)
 *
 * @returns the `assignOp` statement, or `undefined` after pushing a diagnostic.
 */
function lowerBitwiseAssignOp(
  left: ts.Expression,
  bop: BinOp,
  right: ts.Expression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt | undefined {
  const accessor = lowerAccessorTarget(left, true, sourceFile, scope, diagnostics);
  if (accessor === undefined) return undefined;
  return finishAccessorWrite(
    lowerBitwiseAssignOpTo(accessor, left, bop, right, sourceFile, scope, diagnostics),
    accessor,
  );
}

/** {@link lowerBitwiseAssignOp} once the target is known: a place, or an accessor whose getter
 *  stands in for the read (Rule 8.11). */
function lowerBitwiseAssignOpTo(
  accessor: AccessorTarget | 'not-an-accessor',
  left: ts.Expression,
  bop: BinOp,
  right: ts.Expression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt | undefined {
  const target =
    accessor === 'not-an-accessor'
      ? lowerLValue(left, sourceFile, scope, diagnostics)
      : accessor.read;
  if (!target) return undefined;
  if (
    accessor === 'not-an-accessor' &&
    refuseReadonlyWrite(target, left, sourceFile, scope, diagnostics)
  ) {
    return undefined;
  }
  const k = typeKey(target.type);
  if (k !== 'i32' && k !== 'u32') {
    pushDiag(
      diagnostics,
      sourceFile,
      left,
      `Bitwise "${bop}=" needs an i32 or u32 target, got ${k}.`,
      TS_CODES.TYPE_MISMATCH,
    );
    return undefined;
  }
  let value = lowerExpression(right, sourceFile, scope, diagnostics);
  if (!value) return undefined;
  // A SHIFT amount is a u32 whatever the target is: WGSL's only scalar overload is
  // `e1 << e2` with `e2: u32`, so `y <<= k` with an i32 `k` on an i32 target emitted
  // `y <<= k;`, which Tint refuses (`no matching overload for 'operator <<= (i32, i32)'`),
  // while the one spelling it accepts — a u32 amount — was refused here by the equality rule.
  // An integer literal takes u32, an i32 amount goes through the `u32(...)` cast the surface
  // already has, and GLSL ES 3.00 allows the mixed signedness that produces. `&`, `|` and `^`
  // keep the equality rule: there both operands must be the one type on both targets.
  const isShift = bop === '<<' || bop === '>>';
  const want = isShift ? u32T : target.type;
  // Folded first, so a leading minus is part of the number: `y |= -2` reaches here as a unop
  // over a literal, which the `op === 'lit'` retype below never matched, and the author was
  // told their i32 target could not take an f32.
  const folded = foldNumericLit(value);
  if (folded.op === 'lit' && typeof folded.value === 'number' && Number.isInteger(folded.value)) {
    if (folded.value < 0 && (isShift || typeKey(want) === 'u32')) {
      pushDiag(
        diagnostics,
        sourceFile,
        right,
        isShift
          ? shiftAmountMessage(folded.value)
          : `Bitwise "${bop}=" on a u32 target needs a non-negative value, got ${String(folded.value)}.`,
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    }
    value = { op: 'lit', type: want, value: folded.value };
  }
  // A constant amount outside 0..31 has no bit to shift into: WGSL makes it a shader-creation
  // error and GLSL ES 3.00 leaves the result undefined, so it is refused here (#71). The fold
  // is the one the loop bound uses, so `16 + 16` and a module const are caught with the
  // literal; a runtime amount is left alone, since WGSL masks it. `shiftAmountMessage` is the
  // same sentence the binary path raises — one rule, one wording.
  const amount = isShift ? constShiftAmountOutOfRange(value, scope) : undefined;
  if (amount !== undefined) {
    pushDiag(diagnostics, sourceFile, right, shiftAmountMessage(amount), TS_CODES.TYPE_MISMATCH);
    return undefined;
  }
  if (isShift && typeKey(value.type) === 'i32') {
    value = { op: 'call', type: u32T, fn: 'u32', args: [value] };
  }
  if (typeKey(value.type) !== typeKey(want)) {
    pushDiag(
      diagnostics,
      sourceFile,
      right,
      isShift
        ? `Bitwise "${bop}=" needs an i32 or u32 shift amount, got ${typeKey(value.type)}.`
        : numericMismatch(`${bop}=`, target.type, value.type),
      TS_CODES.TYPE_MISMATCH,
    );
    return undefined;
  }
  return { s: 'assignOp', target, bop, expr: value };
}

function lowerAssignOp(
  left: ts.Expression,
  bop: BinOp,
  right: ts.Expression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt | undefined {
  // `o.x += v` where `x` is an accessor reads through its getter and writes through its setter
  // (Rule 8.11): the checks below run on the getter's call as they would on a field.
  const accessor = lowerAccessorTarget(left, true, sourceFile, scope, diagnostics);
  if (accessor === undefined) return undefined;
  return finishAccessorWrite(
    lowerAssignOpTo(accessor, left, bop, right, sourceFile, scope, diagnostics),
    accessor,
  );
}

/** {@link lowerAssignOp} once the target is known: a place, or an accessor whose getter stands
 *  in for the read (Rule 8.11). */
function lowerAssignOpTo(
  accessor: AccessorTarget | 'not-an-accessor',
  left: ts.Expression,
  bop: BinOp,
  right: ts.Expression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt | undefined {
  const target =
    accessor === 'not-an-accessor'
      ? lowerLValue(left, sourceFile, scope, diagnostics)
      : accessor.read;
  if (!target) return undefined;
  if (
    accessor === 'not-an-accessor' &&
    refuseReadonlyWrite(target, left, sourceFile, scope, diagnostics)
  ) {
    return undefined;
  }
  let value = lowerExpression(right, sourceFile, scope, diagnostics);
  if (!value) return undefined;
  // The same refusal `a / b` gets in lowerBinary (#68): a divisor proven zero is undefined on
  // every invocation, and `x /= 0.` is the same program as `x = x / 0.`.
  if ((bop === '/' || bop === '%') && foldConstComponents(value, scope)?.some((v) => v === 0)) {
    pushDiag(
      diagnostics,
      sourceFile,
      right,
      `Division by zero: "${right.getText(sourceFile)}" is 0 on every invocation. WGSL refuses it and GLSL ES 3.00 leaves it undefined.`,
      TS_CODES.TYPE_MISMATCH,
    );
    return undefined;
  }
  if (value.op === 'lit' && typeof value.value === 'number' && isNumericScalar(target.type)) {
    value = { op: 'lit', type: target.type, value: value.value };
  } else if (isVec(target.type) || isVec64(target.type) || isF64(target.type)) {
    // `v *= 2` with an integer vector target types the literal as the element kind; a
    // non-integer literal stays f32 and is diagnosed below instead of being truncated. A
    // vec64 or f64 target makes the literal an f64 so the full double reaches the fp64 pass.
    value = retargetLit(value, right, target.type);
  }
  if (typeKey(target.type) !== typeKey(value.type)) {
    // `v += s` with a vector target and a scalar of its element kind follows the same
    // broadcast rule as `v + s`; the result must still be the target's own type.
    // `x *= t` with an f64 target and an f32 value widens exactly, the same rule `x * t`
    // follows (#151 F64-02); the result is the f64 target's own type, so it fits.
    const broadcast =
      broadcastResultType(target.type, value.type, bop) ??
      f64WidenResultType(target.type, value.type, bop);
    if (!broadcast || typeKey(broadcast) !== typeKey(target.type)) {
      const message =
        broadcast !== undefined
          ? `Type mismatch: cannot ${bop}= ${typeKey(target.type)} and ${typeKey(value.type)}. ` +
            `The result would be ${typeKey(broadcast)}, which does not fit the ${typeKey(target.type)} ` +
            `target; assign it to a vector, or reduce the vector to a scalar first.`
          : numericMismatch(`${bop}=`, target.type, value.type);
      pushDiag(diagnostics, sourceFile, right, message, TS_CODES.TYPE_MISMATCH);
      return undefined;
    }
    if (isVec64(target.type)) {
      // The fp64 pass only lowers an assignOp on a vec64 target when the value is a vec64
      // too (it throws SD0041 for a scalar), while its binop arm widens a scalar operand. So
      // `w *= s` on a vec64 target is spelled as `w = w * s`, which emits and evaluates as
      // the binary form does.
      return {
        s: 'assign',
        target,
        expr: { op: 'binop', type: target.type, bop, a: target, b: value },
      };
    }
  }
  // `m *= n` is `m = m * n`, so WGSL's product rule decides it: `matKxR * matCxK -> matCxR`,
  // the left operand's columns against the right operand's rows. Two matrices of one
  // non-square shape have one type key, so the mismatch check above never saw the pair and
  // `c *= b` on two mat2x3 reached Tint as "no matching overload for 'operator *=
  // (mat2x3<f32>, mat2x3<f32>)'" — the compound spelling of the hole #169 reports in `a * b`.
  if (bop === '*' && target.type.kind === 'mat' && value.type.kind === 'mat') {
    if (target.type.cols !== value.type.rows) {
      pushDiag(
        diagnostics,
        sourceFile,
        right,
        `Type mismatch: cannot *= ${typeKey(target.type)} and ${typeKey(value.type)}. WGSL's ` +
          `matrix product is matKxR * matCxK -> matCxR: the target's ` +
          `${String(target.type.cols)} columns must meet the right operand's ` +
          `${String(value.type.rows)} rows, and the product must keep the target's own shape.`,
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    }
  }
  // The compound spelling of the refusal `m / n` gets in lowerBinary: WGSL gives a matrix
  // `+`, `-` and `*` and no `/` or `%` (GLSL ES 3.00 agrees), and the equal-key path here
  // never asked. `c /= b` on two mat3x3 emitted `c /= b`, which Tint answers "no matching
  // overload for 'operator /= (mat3x3<f32>, mat3x3<f32>)'" (#169, the same family).
  if ((bop === '/' || bop === '%') && target.type.kind === 'mat') {
    pushDiag(
      diagnostics,
      sourceFile,
      right,
      `Cannot ${bop}= ${typeKey(target.type)}: a matrix has + - and * on both targets and no ` +
        `${bop}. Divide the columns, or multiply by the inverse you computed.`,
      TS_CODES.TYPE_MISMATCH,
    );
    return undefined;
  }
  // `x %= y` on an emulated double, for the reason `x % y` is refused: there is no df64
  // remainder. A MISMATCHED pair (`w %= s` with a vec64 and an f32) is already reported above
  // by the ordinary numeric mismatch, which names both operand types and says the same thing;
  // this catches the same-typed pair, which passed every check and reached emit as a
  // span-less SD0041 (#151).
  if (bop === '%' && (isF64(target.type) || isVec64(target.type))) {
    pushDiag(
      diagnostics,
      sourceFile,
      right,
      `Cannot %= ${typeKey(target.type)}: the emulated double has no remainder — the fp64 ` +
        `pass has a df64 body for + - * / and the comparisons only.`,
      TS_CODES.TYPE_MISMATCH,
    );
    return undefined;
  }
  return { s: 'assignOp', target, bop, expr: value };
}

export function lowerLValue(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
  /** The write lands inside the place, as a method that changes its object does, and not on
   *  it: a static a base declares is then the base's (Rule 8.13). */
  into = false,
): Expr | undefined {
  // `(v) = a` and `(v).x = a` name the same targets `v = a` and `v.x = a` do, so the
  // parentheses come off once, here, rather than in each branch below (where only the member
  // walk looked through them, and the fallback message then denied its own input).
  const node = ts.isParenthesizedExpression(expression) ? unwrapParens(expression) : expression;
  // A call a chain already ran is the object it handed back, and that object is the place the
  // chain was started on: a variable, or the temporary a `new` at its root was put in.
  const alias = scope.chainAlias(node);
  if (alias !== undefined) return alias();
  if (ts.isPropertyAccessExpression(node)) {
    // `C.count = 1`, and `this.count += 1` in a static member: a static field the file writes
    // is a module variable, and it is the place (Rule 8.13).
    const statik = lowerStaticFieldTarget(node, sourceFile, scope, diagnostics, into);
    if (statik === 'refused') return undefined;
    if (statik !== undefined) return statik;
    return lowerMemberLValue(node, sourceFile, scope, diagnostics);
  }
  // `this` as a whole is a place inside a constructor or a method that changes its object,
  // where it is the local being built (§26); in a read-only method it is the parameter.
  if (node.kind === ts.SyntaxKind.ThisKeyword) {
    if (!checkRootWritable(node, sourceFile, scope, diagnostics)) return undefined;
    const b = scope.resolve('this')!;
    return withSpan({ op: 'varref', type: b.type, name: irNameOf(b) } as Expr, sourceFile, node);
  }
  if (ts.isElementAccessExpression(node)) {
    // The root of the chain decides writability, exactly as it does for a member target:
    // `cam.xs[i] = 1.` on a uniform and `p.xs[i] = 1.` on a parameter used to reach the
    // backend, because the binding was resolved only when the base was a bare identifier.
    //
    // THE ROOT'S ACCESS MODE IS CHECKED LAST, for the reason {@link lowerMemberLValue} checks
    // it last: the read-only refusal names the declaration that WOULD permit the write, and an
    // element that is not a place on ANY mode has no such declaration. Measured: `md[0] = …`
    // on `storage<mat3<f64>>` read `Cannot assign to "md" … Write "declare const md:
    // storage<mat3x3<f64>, "read_write">" to write to it.`, and with that declaration the
    // program is still refused, `TS8003 Cannot index mat3x3<f64>` — an f64 matrix is not
    // indexable on either mode. The root's IDENTITY is still checked first, so an unknown
    // name, a parameter and a `this` outside a method keep their sentences.
    if (!checkRootNamed(node, sourceFile, scope, diagnostics)) return undefined;
    const baseExpr = lowerExpression(node.expression, sourceFile, scope, diagnostics);
    if (
      baseExpr !== undefined &&
      refuseVec64LaneWrite(baseExpr.type, 'an indexed lane', node, sourceFile, diagnostics)
    ) {
      return undefined;
    }
    const idx = lowerExpression(node, sourceFile, scope, diagnostics);
    // A lowered element access that is not an `index` node has no place to write to. It used
    // to return here silently, which dropped the whole statement — no diagnostic, valid
    // shader text, wrong answer. Anything that reaches this point and is not covered above
    // says so.
    if (!idx) return undefined;
    if (idx.op !== 'index') {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `Cannot assign to "${truncate(node.getText(sourceFile))}" — it is not a place.`,
        TS_CODES.ASSIGN_TARGET,
      );
      return undefined;
    }
    const getter = getterInChain(idx);
    if (getter !== undefined) {
      refuseWriteThroughGetter(node, getter, sourceFile, diagnostics);
      return undefined;
    }
    if (!checkRootMutable(node, sourceFile, scope, diagnostics)) return undefined;
    // The lvalue carries its own span (docs/debugging.md §5 decision 3): a debugger stopped on
    // this statement can highlight what is about to change, not just the line it is on.
    return withSpan(idx, sourceFile, node);
  }
  if (!ts.isIdentifier(node)) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      'Assignment target must be a name, or a field, component or element of one.',
      TS_CODES.ASSIGN_TARGET,
    );
    return undefined;
  }
  const binding = scope.resolve(node.text);
  if (!binding) {
    // A refused declaration already said why the name is unbound (Rule 12.4, #171).
    if (unknownNameAlreadyReported(node, node.text, sourceFile, diagnostics)) return undefined;
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      // `gl_Position = …` is how a GLSL vertex shader ends; here it is a field of the entry's
      // return, which is what the remedy says (#218). A misspelled name names the one in scope
      // it is spelled like (Rule 12.1).
      unknownIdentifierSentence(node, `Cannot assign to unknown name "${node.text}".`),
      // UNKNOWN_NAME, not ASSIGN_TARGET: the name does not resolve, which is what every
      // other unresolved-identifier site in the lowerer reports (expression.ts, the property
      // and call lowerers). ASSIGN_TARGET is about the SHAPE of the target — "must be an
      // identifier" — and this target is a perfectly good identifier that names nothing.
      // `lowerUpdate` raises the same message, and now the same code, for `nope++`.
      TS_CODES.UNKNOWN_NAME,
    );
    return undefined;
  }
  // A local function's parameter for a variable it captures keeps the variable's rules, and a
  // write that stands makes it a reference to the variable (Rule 8.17).
  const rules = writeRules(binding);
  if (!rules.mutable && into && rules.toVar !== undefined) rules.toVar();
  if (!rules.mutable) {
    const ro = readOnlyPhrase(rules.kind);
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      into && rules.kind === 'local' && isComposite(rules.type)
        ? constCopyWrite(node.text)
        : `Cannot assign to "${node.text}" — it is ${ro}.${writableRemedy(rules, sourceFile)}`,
      TS_CODES.CONST_ASSIGN,
    );
    return undefined;
  }
  if (rules.kind === 'param') {
    refuseParamWrite(node, node.text, sourceFile, diagnostics);
    return undefined;
  }
  binding.capture?.byRef();
  return withSpan(
    {
      op: binding.kind === 'param' ? 'param' : 'varref',
      type: binding.type,
      name: irNameOf(binding),
    } as Expr,
    sourceFile,
    node,
  );
}

/** A write through `v.x`, `ps[i].a` or `o.pos` lands on the binding at the root of the
 *  chain, so that is the binding whose writability decides it: the same parameter and const
 *  checks the identifier and element-access targets already make, made on the root instead
 *  of on the chain. Returns the root identifier, or undefined for a chain rooted in
 *  something that is not a name (a call result, a constructor). */
function rootLValueName(node: ts.Expression): ts.Identifier | ts.ThisExpression | undefined {
  if (ts.isIdentifier(node)) return node;
  if (node.kind === ts.SyntaxKind.ThisKeyword) return node as ts.ThisExpression;
  if (ts.isParenthesizedExpression(node)) return rootLValueName(node.expression);
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    return rootLValueName(node.expression);
  }
  return undefined;
}

/** The static field at the root of a member or element chain, `C.v` in `C.v.x = 1.` or `this.v`
 *  in a static member, with how a message names it; undefined for a chain rooted in a value. */
function staticRootOf(
  node: ts.Expression,
  scope: LoweringScope,
  sourceFile: ts.SourceFile,
  into = false,
):
  | { binding: Binding; owner: string; written: string; whole: boolean }
  | { refused: string }
  | undefined {
  const target = unwrapParens(node);
  let at = target;
  for (;;) {
    if (ts.isPropertyAccessExpression(at)) {
      const owner = staticOwnerOf(at.expression, scope);
      if (owner !== undefined) {
        const binding = staticFieldRead(owner, at.name.text, scope, sourceFile)?.binding;
        // `whole`: the write is to the static itself, not into what it holds.
        if (binding !== undefined) {
          return { binding, owner, written: at.name.text, whole: at === target && !into };
        }
        // `this.#n += 1.` in a static body a class inherits, `#n` being the declaring class's.
        const refused = inheritedPrivateStaticField(owner, at.name.text, scope, sourceFile);
        return refused === undefined ? undefined : { refused };
      }
      at = unwrapParens(at.expression);
      continue;
    }
    if (ts.isElementAccessExpression(at)) {
      at = unwrapParens(at.expression);
      continue;
    }
    return undefined;
  }
}

/** Lowers `v.x`, `o.pos`, `ps[i].a` and `o.pos.x` as an assignment target. The IR `assign`
 *  target already takes a `member` — the EDSL spells the same write `o.pos.assign(v)`, and
 *  WGSL, GLSL ES 3.00 and the CPU oracle all assign a struct field or a single vector
 *  component in place — so the member expression `lowerExpression` already builds for the
 *  read is the target verbatim. Two things are checked that a read does not care about: the
 *  root binding must be writable, and a swizzle target must name exactly one component,
 *  which is what WGSL allows (`v.xy = …` is rejected there too). */
function unwrapParens(node: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(node) ? unwrapParens(node.expression) : node;
}

/** The writability of the binding at the root of a member or element chain, diagnosed. Shared
 *  by both branches of {@link lowerLValue} so a write through a field and a write through an
 *  element answer the same way: a write lands on the root, so the root is what has to accept
 *  it. Returns false having pushed a diagnostic.
 *
 *  It is the two halves below run in order. The member and element branches run them APART,
 *  with the "is this a place at all" check between: see {@link lowerMemberLValue} and the
 *  element arm of {@link lowerLValue}. */
function checkRootWritable(
  node: ts.Expression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
  /** The write lands inside `node`, on a field or an element of it, and not on `node`. */
  into = false,
): boolean {
  return (
    checkRootNamed(node, sourceFile, scope, diagnostics, into) &&
    checkRootMutable(node, sourceFile, scope, diagnostics, into)
  );
}

/** The first half: the root of the chain names something that could be written — not a
 *  parenthesised expression, not an unknown name, not a parameter, not a `this` outside a
 *  method. Returns false having pushed a diagnostic. */
function checkRootNamed(
  node: ts.Expression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
  /** The write lands inside `node`, on a field or an element of it, and not on `node`. */
  into = false,
): boolean {
  const root = rootLValueName(node);
  if (!root) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      'Assignment target must be a name, or a field, component or element of one.',
      TS_CODES.ASSIGN_TARGET,
    );
    return false;
  }
  const rootName = ts.isIdentifier(root) ? root.text : 'this';
  // A chain rooted in a static field, `C.v.x` or `this.v.x` in a static member: the static is
  // the root that has to take the write (Rule 8.13).
  const statik = staticRootOf(node, scope, sourceFile, into);
  if (statik !== undefined && 'refused' in statik) {
    pushDiag(diagnostics, sourceFile, node, statik.refused, TS_CODES.CLASS_MEMBER);
    return false;
  }
  if (statik !== undefined) {
    // A static a base declares is written through the base's name (Rule 8.13). A write INTO
    // it, `Derived.origin.y = 5.`, changes the one object both classes read, as in TypeScript.
    const inherited = statik.whole
      ? inheritedStaticWrite(statik.owner, statik.written, scope, sourceFile)
      : undefined;
    if (inherited !== undefined) {
      pushDiag(diagnostics, sourceFile, node, inherited, TS_CODES.CONST_ASSIGN);
      return false;
    }
    if (statik.binding.kind === 'modvar') return true;
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      staticConstantWrite(statik.owner, statik.written, sourceFile),
      TS_CODES.CONST_ASSIGN,
    );
    return false;
  }
  const binding = scope.resolve(rootName);
  if (!binding) {
    // A refused declaration already said why the root is unbound (Rule 12.4, #171).
    if (rootName !== 'this' && unknownNameAlreadyReported(node, rootName, sourceFile, diagnostics))
      return false;
    pushDiag(
      diagnostics,
      sourceFile,
      // On the root, the name that names nothing, as a bare target's refusal is.
      ts.isIdentifier(root) ? root : node,
      ts.isIdentifier(root)
        ? unknownIdentifierSentence(root, `Cannot assign to unknown name "${rootName}".`)
        : '"this" names a method\'s object; a static function and a top-level function have none.',
      // The same code as the bare-identifier arm above, for the same sentence: the root of a
      // chain that names nothing is an unresolved identifier, not a target of the wrong shape.
      TS_CODES.UNKNOWN_NAME,
    );
    return false;
  }
  if (binding.kind === 'param' && rootName === 'this') {
    // Every method that writes `this` takes it by reference (§26), whatever it returns, so
    // the object is a read-only parameter only in a body reached through `super`: the base's
    // body lowered once more against this class, with no receiver of its own to write
    // through. The write is inside the BASE's method, so the message names the `super` call
    // that brought it here. This read "A method that changes its object returns nothing"
    // until a method that changes its object could return a value.
    const owner = scope.owner();
    const shown = owner === undefined ? undefined : classFunctionOf(owner)?.shown;
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      shown?.startsWith('super.')
        ? `"${shown}" runs the base's body on an object it can only read, so the body cannot ` +
            `write "this" (§26). Move the write into a method no class overrides and call that ` +
            `on "this" instead.`
        : `${shown === undefined ? 'This body' : `"${shown}"`} reads its object only, so it ` +
            `cannot write "this" (§26).`,
      TS_CODES.CLASS_MEMBER,
    );
    return false;
  }
  // A captured variable's parameter keeps the variable's rules (Rule 8.17).
  const rules = writeRules(binding);
  if (rules.kind === 'param') {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `Cannot write through parameter "${rootName}" — parameters are not writable. Use a local or storage.`,
      TS_CODES.ASSIGN_TARGET,
    );
    return false;
  }
  return true;
}

/** The second half: the binding at the root accepts a write. Returns false having pushed a
 *  diagnostic. Run only after {@link checkRootNamed}, which is what guarantees the root
 *  resolves. */
function checkRootMutable(
  node: ts.Expression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
  /** The write lands inside `node`, on a field or an element of it, and not on `node`. */
  into = false,
): boolean {
  const root = rootLValueName(node);
  if (!root) return true;
  // A static root was judged whole by {@link checkRootNamed} (Rule 8.13).
  if (staticRootOf(node, scope, sourceFile, into) !== undefined) return true;
  const rootName = ts.isIdentifier(root) ? root.text : 'this';
  const binding = scope.resolve(rootName);
  if (!binding) return true;
  // A captured variable's parameter keeps the variable's rules (Rule 8.17).
  const rules = writeRules(binding);
  if (!rules.mutable) {
    // A write INTO a local `const`, not to the name: TypeScript allows it (Rule 6.10).
    const through = into || !ts.isIdentifier(unwrapParens(node));
    if (through && rules.toVar !== undefined) {
      rules.toVar();
      binding.capture?.byRef();
      return true;
    }
    // readOnlyPhrase, not a local ternary: #18 gave a binding its own BindingKind, so the
    // message can say WHICH of the two a name is — and the root of a chain deserves the same
    // sentence a bare name gets.
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      through && rules.kind === 'local' && isComposite(rules.type)
        ? constCopyWrite(rootName)
        : `Cannot assign to "${rootName}" — it is ${readOnlyPhrase(rules.kind)}.` +
            writableRemedy(rules, sourceFile),
      TS_CODES.CONST_ASSIGN,
    );
    return false;
  }
  binding.capture?.byRef();
  return true;
}

/** True, having reported it, when the assignment target is a LANE of an emulated-double
 *  vector — `v.x = …`, `v.xy = …`, `v[0] = …`, `v[0] += …`, `v[0]++`.
 *
 *  Reading a lane is a swizzle of the hi and lo planes the fp64 pass lowers the vector into
 *  (`laneSwizzle`), which is a CONSTRUCTOR, and a constructor is not assignable: the emit was
 *  `vec2<f32>(v.hi.x, v.lo.x) = …`, which Tint answers with "expected '=' for assignment" and
 *  ANGLE with "'assign' : l-value required". The element-access form was worse — the lowered
 *  lane is a `member` and not an `index`, so the assignment fell out of `lowerLValue` with no
 *  diagnostic at all and the write simply vanished from the program.
 *
 *  So a lane is READ-ONLY, and the remedy is to rebuild the vector, which the pass does lower
 *  (#151, #149 review). */
function refuseVec64LaneWrite(
  base: ShaderType,
  what: string,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): boolean {
  if (!isVec64(base)) return false;
  pushDiag(
    diagnostics,
    sourceFile,
    node,
    `Cannot assign to ${what} of a ${typeKey(base)}: an emulated-double vector is a pair of ` +
      `hi/lo planes after lowering, so a lane of it is a read, not a place. Rebuild the ` +
      `vector instead, e.g. v = vec${(base as { n: number }).n}f64(x, …).`,
    TS_CODES.ASSIGN_TARGET,
  );
  return true;
}

function lowerMemberLValue(
  node: ts.PropertyAccessExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  // THE ROOT'S ACCESS MODE IS CHECKED LAST, after the target is known to be a place at all,
  // because the read-only refusal now names the declaration that WOULD permit the write
  // (design rule 6.2) and that declaration does not permit a write to something no access mode
  // makes assignable. Measured: `src.length = 2` on a read binding read `Cannot assign to
  // "src" … Write "declare const src: storage<array<f32>, "read_write">" to write to it.`, and
  // with that declaration the program is still refused, `TS8018 Cannot assign to "src.length"`.
  // "Last" is the bottom of this function, not the middle of it: the lane and swizzle refusals
  // below are the same kind of thing as the one above.
  // The root's IDENTITY is still checked first, so an unknown name, a parameter and a `this`
  // outside a method keep the sentences they had, in the order they had them.
  if (!checkRootNamed(node.expression, sourceFile, scope, diagnostics, true)) return undefined;
  const target = lowerExpression(node, sourceFile, scope, diagnostics);
  if (!target) return undefined;
  // A write through what a getter returns lands on a copy (Rule 8.11): `o.pos.x = 1.` with
  // `pos` an accessor, and `o.pos` itself as the receiver of a method that writes.
  const getter = getterInChain(target);
  if (getter !== undefined) {
    refuseWriteThroughGetter(node, getter, sourceFile, diagnostics);
    return undefined;
  }
  if (target.op !== 'member') {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `Cannot assign to "${truncate(node.getText(sourceFile))}" — it is not a field, component or element.`,
      TS_CODES.ASSIGN_TARGET,
    );
    return undefined;
  }
  const base = target.base.type;
  // A lane of an emulated-double vector is a read, never a place.
  if (refuseVec64LaneWrite(base, `the lane ".${target.field}"`, node, sourceFile, diagnostics))
    return undefined;
  if (isVec(base) && target.field.length > 1) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `Cannot assign to the swizzle ".${target.field}" — WGSL writes one component at a time. ` +
        `Assign each component (e.g. v.x = …; v.y = …), or build a whole ${typeKey(base)} and assign that.`,
      TS_CODES.ASSIGN_TARGET,
    );
    return undefined;
  }
  // LAST, once every "this is no place" refusal above has had its turn: all three of them —
  // `.length`, an emulated-double lane and a multi-component swizzle — hold on either access
  // mode, so a read-only sentence naming the writable declaration would name a line the next
  // compile refuses. Measured: `dv[0].x = f64(1.)` and `v.xy = vec2(1., 2.)` on a read binding
  // each drew `TS8005 … Write "declare const … "read_write">"`, and with that declaration each
  // is `TS8018`.
  if (!checkRootMutable(node.expression, sourceFile, scope, diagnostics, true)) return undefined;
  return target;
}

function lowerIf(
  node: ts.IfStatement,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt | undefined {
  const cond = lowerExpression(node.expression, sourceFile, scope, diagnostics);
  if (!cond) return undefined;
  if (typeKey(cond.type) !== 'bool') {
    pushDiag(
      diagnostics,
      sourceFile,
      node.expression,
      `if condition must be bool, got ${typeKey(cond.type)}.`,
      TS_CODES.TYPE_MISMATCH,
    );
    return undefined;
  }
  const thenBody = lowerBranch(node.thenStatement, sourceFile, scope, diagnostics);
  const ifArms: { cond: Expr; body: readonly Stmt[] }[] = [{ cond, body: thenBody }];
  let elseBody: readonly Stmt[] | undefined;
  if (node.elseStatement) {
    if (ts.isIfStatement(node.elseStatement)) {
      const nested = lowerIf(node.elseStatement, sourceFile, scope, diagnostics);
      if (nested && nested.s === 'if') {
        ifArms.push(...nested.arms);
        elseBody = nested.elseBody;
      }
    } else {
      elseBody = lowerBranch(node.elseStatement, sourceFile, scope, diagnostics);
    }
  }
  return { s: 'if', arms: ifArms, elseBody };
}

function lowerBranch(
  node: ts.Statement,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt[] {
  scope.enterBranch();
  try {
    if (ts.isBlock(node)) return lowerBlock(node, sourceFile, scope, diagnostics);
    scope.push();
    try {
      const one = lowerStatement(node, sourceFile, scope, diagnostics);
      if (!one) return [];
      return Array.isArray(one) ? one : [one];
    } finally {
      scope.pop();
    }
  } finally {
    scope.exitBranch();
  }
}

function isNumericScalar(t: ShaderType): boolean {
  const k = typeKey(t);
  return k === 'f32' || k === 'i32' || k === 'u32';
}

function pushDiag(
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
  node: ts.Node,
  message: string,
  code: TsCode,
): void {
  diagnostics.push(makeDiagnostic(sourceFile, node, message, code));
}

function truncate(s: string, n = 60): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : t.slice(0, n) + '…';
}

/** A WHOLE-parameter write, refused for every spelling that reaches one: `a = v`, `a += v`,
 *  `a++`. WGSL formal parameters are values, not references, and Tint says so outright:
 *  `cannot assign to parameter 'a'` / `parameters are immutable`. The compiler emitted
 *  `a = 1.0;` with zero diagnostics (§52), and the docs called it a bug it did not catch.
 *
 *  NOT shadowed by `var a = a;`, which is what the issue proposed: that is `redeclaration of
 *  'a'` on the same Tint, because a WGSL function's parameters and its top-level locals share
 *  one scope. A shadow would therefore have to RENAME the local, changing the identifier the
 *  author wrote and a debugger shows, to save one line. So the line is asked for instead. A
 *  write THROUGH a parameter (`p.x = 1.`) keeps its own message, which `checkRootWritable`
 *  raises before this.
 *
 *  ONE function because the three spellings lower in two different files: `lowerAssign` here
 *  and `lowerUpdate` in control.ts, which built its own `{ op: 'param' }` target and so
 *  emitted `a = (a + 1);` past this rule until it called this. */
export function refuseParamWrite(
  node: ts.Node,
  name: string,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): void {
  pushDiag(
    diagnostics,
    sourceFile,
    node,
    `Cannot assign to "${name}" — a parameter is a value, not a variable. Copy it ` +
      `into a local first: "let ${name}_ = ${name};", then write that.`,
    TS_CODES.ASSIGN_TARGET,
  );
}
