import { userCallExpr } from './caller-decided.js';
import ts from 'typescript';
import { logicalTypeKey as typeKey } from '../optional.js';
import { builtinResultType } from '../../../core/builtins/resolve.js';
import { stageOf } from '../../../core/ir/nodes.js';
import type { Expr, FuncDecl } from '../../../core/ir/nodes.js';
import type { ShaderType } from '../../../core/ir/types.js';
import { boolT, f32T, f64T, i32T, u32T } from '../../../core/ir/types.js';
import type { TsCompilerDiagnostic } from '../source-file.js';
import { authorTypeText, type LoweringScope } from '../context.js';
import { resolveMathExpand } from '../math-alias.js';
import { expandMath } from '../math-expand.js';
import { lowerRandomHash } from '../random-hash.js';
import { lowerScalarCast } from '../numeric.js';
import {
  abstractLiteralOf,
  noteCastRead,
  noteIntegerRead,
  refuseTwoReadings,
  twoReadingsOf,
} from '../abstract-const.js';
import { foldConstNumber } from '../loop-bound.js';
import { foldF64ModuleConst } from '../module-const-f64.js';
import {
  reportIntLitRange,
  retargetIntLitCtx,
  pendingKindlessRefusal,
  readingsOf,
} from '../lit-coerce.js';
import { readonlyClassUpcast } from '../class-upcasts.js';
import { lowerExpression } from './expression.js';
import { convertedQuotientArg } from './integer-quotient.js';
import { captureArguments } from './local-functions.js';
import { lowerReferenceArgument } from './references.js';
import { makeDiagnostic } from '../diagnostic.js';
import { TS_CODES, type TsCode } from '../codes.js';
import {
  declaresParamDefault,
  noteFilledCall,
  paramDefault,
  requiredParamCount,
} from './param-defaults.js';
import { eachExpr } from '../../../core/ir/visit.js';
import { isKnownIntrinsic } from '../../../core/intrinsics.js';
import { EFFECTFUL_INTRINSICS } from '../../../core/passes/effects.js';
import { absentLiteral, absentOf, isOptional, optionalInner, presentOf } from '../optional.js';
import { convertOptional, lowerOptionalInitializer, refuseOptionalUse } from './optional-values.js';
import { functionTypeOf, shapeOf, type FunctionShape } from './function-types.js';

const SCALAR_ZERO: Readonly<Record<string, Expr | undefined>> = {
  f32: { op: 'lit', type: f32T, value: 0 },
  i32: { op: 'lit', type: i32T, value: 0 },
  u32: { op: 'lit', type: u32T, value: 0 },
  bool: { op: 'lit', type: boolT, value: false },
};

export function lowerScalarCastCall(
  name: string,
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  if (node.arguments.length === 0) {
    const zero = SCALAR_ZERO[name];
    if (zero) return zero;
  }
  if (node.arguments.length !== 1) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      SCALAR_ZERO[name]
        ? `${name}() expects 1 argument, or none for the zero value.`
        : `${name}() expects 1 argument.`,
      TS_CODES.ARITY_MISMATCH,
    );
    return undefined;
  }
  let lowered = lowerExpression(node.arguments[0]!, sourceFile, scope, diagnostics);
  if (!lowered) return undefined;
  if (name === 'f32') {
    const arg = node.arguments[0]!;
    const readings = readingsOf(lowered, (n) => scope.resolveIr(n)) ?? twoReadingsOf(arg);
    if (readings !== undefined && pendingKindlessRefusal(lowered) === undefined) {
      refuseTwoReadings(sourceFile, diagnostics, {
        node: arg,
        operation: node,
        operator: 'f32()',
        readings,
        target: false,
      });
      return undefined;
    }
  }
  if (name === 'i32' || name === 'u32') {
    const read = convertedQuotientArg(lowered, node.arguments[0]!, sourceFile, name);
    if (read.wrapped !== undefined) return read.wrapped;
    lowered = read.arg;
  }
  const arg = name === 'f32' || name === 'bool' ? lowered : (abstractLiteralOf(lowered) ?? lowered);
  if ((name === 'i32' || name === 'u32') && arg !== lowered) {
    noteIntegerRead(node.arguments[0]!, name);
  }
  if (arg !== lowered) noteCastRead(node.arguments[0]!, name);
  const out = lowerScalarCast(
    name,
    arg,
    (e) =>
      scope.preservesConstantF32() ? foldF64ModuleConst(e, scope) : foldConstNumber(e, scope),
    node.arguments[0]!,
    scope.preservesConstantF32(),
  );
  if (typeof out === 'string') {
    pushDiag(diagnostics, sourceFile, node, out, TS_CODES.TYPE_MISMATCH);
    return undefined;
  }
  return out;
}

function mayHaveEffect(e: Expr): boolean {
  let effect = false;
  eachExpr(e, (x) => {
    if (
      x.op === 'call' &&
      (x.declRef !== undefined || !isKnownIntrinsic(x.fn) || EFFECTFUL_INTRINSICS.has(x.fn))
    )
      effect = true;
  });
  return effect;
}

export function lowerExpandCall(
  name: string,
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
  refuse: (args: readonly Expr[]) => boolean = () => false,
): Expr | undefined {
  const id = resolveMathExpand(name);
  if (!id) return undefined;
  const args: Expr[] = [];
  for (const arg of node.arguments) {
    const lowered = lowerExpression(arg, sourceFile, scope, diagnostics);
    if (!lowered) return undefined;
    args.push(lowered);
  }
  if (refuse(args)) return undefined;
  if (id === 'cbrt' && args.length === 1 && typeKey(args[0]!.type) === 'f32') {
    const x = args[0]!;
    if (mayHaveEffect(x)) {
      const param: Expr = { op: 'param', type: f32T, name: 'x' };
      const body = expandMath('cbrt', [param]) as Expr;
      const built = scope.buildFunction('math|cbrt', 'cbrt', 'Math.cbrt', [], (name) => ({
        name,
        params: [{ name: 'x', type: f32T }],
        ret: f32T,
        body: [{ s: 'return', expr: body }],
      }));
      if (built !== undefined) {
        return { op: 'call', type: f32T, fn: built.name, args: [x], declRef: built };
      }
    }
  }
  const out = expandMath(id, args);
  if (typeof out === 'string') {
    pushDiag(diagnostics, sourceFile, node, out, TS_CODES.TYPE_MISMATCH);
    return undefined;
  }
  return out;
}

export function lowerRandomCall(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  if (node.arguments.length !== 1) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      'random(seed) needs one seed (f32 | vec2 | vec3).',
      TS_CODES.ARITY_MISMATCH,
    );
    return undefined;
  }
  const seed = lowerExpression(node.arguments[0]!, sourceFile, scope, diagnostics);
  if (!seed) return undefined;
  const hashed = lowerRandomHash(seed);
  if (!hashed) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `random(seed) seed must be f32, vec2, or vec3; got ${authorTypeText(seed.type)}.`,
      TS_CODES.TYPE_MISMATCH,
    );
    return undefined;
  }
  return hashed;
}

export function lowerUserCall(
  node: ts.CallExpression | ts.NewExpression,
  decl: FuncDecl,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
  opts: {
    readonly leading?: readonly Expr[];
    readonly shown?: string;
    readonly lowered?: readonly Expr[];
    readonly written?: readonly ts.Expression[];
  } = {},
): Expr | undefined {
  const leading = opts.leading ?? [];
  const shown = opts.shown ?? decl.name;
  const stage = stageOf(decl);
  if (stage !== undefined) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `"${shown}" is a ${stage} entry point and cannot be called; the pipeline invokes it. ` +
        `Move the body into a plain function and call that from both.`,
      TS_CODES.UNSUPPORTED,
    );
    return undefined;
  }
  if (decl.kernel === true) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `"${shown}" is a kernel function, which host code calls and whose arrays are the call's ` +
        `storage, so no function can call it. Move what the two share into a plain function ` +
        `and call that from both.`,
      TS_CODES.UNSUPPORTED,
    );
    return undefined;
  }
  if (!scope.calleeReady(decl, node, sourceFile, diagnostics)) return undefined;
  const written = opts.written ?? node.arguments ?? [];
  const args: Expr[] = [...leading];
  if (opts.lowered !== undefined) {
    for (const [i, value] of opts.lowered.entries()) {
      const want = decl.params[leading.length + i]?.type;
      const inner = optionalInner(want);
      const fitted =
        inner === undefined
          ? value
          : typeKey(value.type) === typeKey(inner)
            ? presentOf(want!, value)
            : convertOptional(value, want!, written[i]!, sourceFile, scope, diagnostics);
      if (fitted === undefined) return undefined;
      args.push(fitted);
    }
  } else {
    for (const [i, arg] of written.entries()) {
      const param = decl.params[leading.length + i];
      if (param?.mode === 'inout') {
        const place = lowerReferenceArgument(arg, param, shown, sourceFile, scope, diagnostics);
        if (!place) return undefined;
        args.push(place);
        continue;
      }
      const lowered = lowerExpression(
        arg,
        sourceFile,
        scope,
        diagnostics,
        decl.params[leading.length + i]?.type,
      );
      if (!lowered) return undefined;
      args.push(lowered);
    }
  }
  const supplied = args.length;
  let broken = false;
  const owner = scope.owner();
  // Implements: Rule 8.18
  const handed = handedShapeOf(node, scope, sourceFile);
  for (let i = args.length; i < decl.params.length; i++) {
    const filled =
      paramDefault(decl, i, (n) => scope.structByName(n)) ??
      (handed?.omittable?.[i - leading.length] === true && isOptional(decl.params[i]!.type)
        ? absentOf(decl.params[i]!.type, optionalInner(decl.params[i]!.type)!, (n) =>
            scope.structByName(n),
          )
        : undefined);
    if (!filled) {
      broken = declaresParamDefault(decl, i);
      break;
    }
    args.push(filled);
    if (owner) {
      eachExpr(filled, (e) => {
        if (e.op === 'call' && e.declRef !== undefined) noteFilledCall(owner, e.fn, node);
      });
    }
  }
  if (broken) return undefined;
  if (args.length !== decl.params.length) {
    const total = decl.params.length - leading.length;
    const required = requiredParamCount(decl, leading.length);
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      required === total
        ? `"${shown}" expects ${total} argument(s), got ${written.length}.`
        : `"${shown}" takes ${required} to ${total} argument(s), got ${written.length}.`,
      TS_CODES.ARITY_MISMATCH,
    );
    return undefined;
  }
  for (let i = leading.length; i < supplied; i++) {
    const argNode = written[i - leading.length]!;
    const want = decl.params[i]!.type;
    args[i] = retargetIntLitCtx(args[i]!, argNode, want);
    args[i] = readonlyClassUpcast(args[i]!, want, scope, sourceFile);
    args[i] = reportIntLitRange(args[i]!, argNode, want, sourceFile, diagnostics) ?? args[i]!;
    if (!isOptional(want) && refuseOptionalUse(args[i], argNode, sourceFile, diagnostics))
      return undefined;
    if (typeKey(args[i]!.type) !== typeKey(decl.params[i]!.type)) {
      const got = args[i]!.type;
      const note = scope.inheritanceNote(want, got);
      const nth = `Argument ${i + 1 - leading.length} of "${shown}"`;
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        note === '' && want.kind === 'struct' && got.kind === 'struct'
          ? `${nth} is ${authorTypeText(got)}, and "${shown}" takes ${authorTypeText(want)}. ` +
              `A struct is its own type whatever its fields, so pass a value of type ` +
              `${authorTypeText(want)}.`
          : `${nth} type mismatch.${note}`,
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    }
  }
  const call = userCallExpr(decl, args, node, sourceFile);
  return wrapHandedResult(call, node, scope, sourceFile, diagnostics);
}

function wrapHandedResult(
  call: Expr,
  node: ts.CallExpression | ts.NewExpression,
  scope: LoweringScope,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const shape = handedShapeOf(node, scope, sourceFile);
  const inner = optionalInner(shape?.ret);
  if (shape === undefined || inner === undefined) return call;
  if (isOptional(call.type))
    return convertOptional(call, shape.ret!, node, sourceFile, scope, diagnostics);
  return typeKey(inner) === typeKey(call.type) ? presentOf(shape.ret!, call) : call;
}

function handedShapeOf(
  node: ts.CallExpression | ts.NewExpression,
  scope: LoweringScope,
  sourceFile: ts.SourceFile,
): FunctionShape | undefined {
  const callee = node.expression;
  if (!ts.isIdentifier(callee)) return undefined;
  const owner = scope.ownerNode();
  const param = owner?.parameters.find(
    (p) => ts.isIdentifier(p.name) && p.name.text === callee.text,
  );
  const fnType = functionTypeOf(param?.type);
  if (fnType === undefined) return undefined;
  return shapeOf(fnType, sourceFile, []);
}

export function mathResultType(fn: string, args: readonly Expr[]): ShaderType {
  const fromTable = builtinResultType(
    fn,
    args.map((a) => a.type),
  );
  if (fromTable !== undefined) return fromTable;
  const first = args[0]!.type;
  if ((fn === 'length' || fn === 'distance' || fn === 'dot') && first.kind === 'vec64') return f64T;
  if (fn === 'length' || fn === 'distance' || fn === 'dot' || fn === 'determinant') return f32T;
  if (fn === 'transpose' && first.kind === 'mat') {
    return { kind: 'mat', cols: first.rows, rows: first.cols, elem: first.elem };
  }
  return first;
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

export function lowerGenericCall(
  node: ts.CallExpression,
  name: string,
  shown: string,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const takesFunction = scope.functionParamsOf(name) ?? new Set<number>();
  const lowered: (Expr | undefined)[] = [];
  const written: ts.Expression[] = [];
  const argTypes: (ShaderType | undefined)[] = [];
  for (const [i, arg] of node.arguments.entries()) {
    if (takesFunction.has(i)) {
      argTypes.push(undefined);
      continue;
    }
    const deferred = absentLiteral(arg) !== undefined;
    const one = deferred
      ? undefined
      : (lowerOptionalInitializer(arg, sourceFile, scope) ??
        lowerExpression(arg, sourceFile, scope, diagnostics));
    if (!deferred && !one) return undefined;
    lowered.push(one);
    written.push(arg);
    argTypes.push(one?.type);
  }
  const decl = scope.instantiateGeneric(name, node, argTypes, sourceFile, diagnostics);
  if (!decl) return undefined;
  const leading = captureArguments(decl, shown, node, sourceFile, scope, diagnostics);
  if (leading === undefined) return undefined;
  const values: Expr[] = [];
  for (const [i, value] of lowered.entries()) {
    const one =
      value ??
      lowerExpression(
        written[i]!,
        sourceFile,
        scope,
        diagnostics,
        decl.params[leading.length + i]?.type,
      );
    if (one === undefined) return undefined;
    values.push(one);
  }
  return lowerUserCall(node, decl, sourceFile, scope, diagnostics, {
    lowered: values,
    shown,
    ...(leading.length > 0 ? { leading } : {}),
    ...(takesFunction.size > 0 ? { written } : {}),
  });
}
