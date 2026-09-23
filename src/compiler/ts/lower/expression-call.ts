import ts from 'typescript';
import type { Expr } from '../../../core/ir/nodes.js';
import type { ShaderType } from '../../../core/ir/types.js';
import {
  boolT,
  f32T,
  f64T,
  i32T,
  isF64,
  storageTexel,
  typeKey,
  u32T,
  vec2fT,
  vec2uT,
  vec3uT,
  vec4fT,
  vec4iT,
  vec4uT,
  voidT,
} from '../../../core/ir/types.js';
import type { TsCompilerDiagnostic } from '../source-file.js';
import type { LoweringScope } from '../context.js';
import {
  USER_FIRST_BUILTINS,
  expectedArity,
  isCanonicalMathFn,
  resolveMathConst,
  resolveMathExpand,
  resolveMathFn,
} from '../math-alias.js';
import { SCALAR_CAST, literalPeerType } from '../numeric.js';
import {
  foldNumericLit,
  isIntegerLiteralTree,
  retargetIntLit,
  retargetIntLitCtx,
  reportIntLitRange,
} from '../lit-coerce.js';
import { spanOf } from '../span.js';
import { lowerExpression } from './expression.js';
import { JS_ARRAY_METHODS, arrayLengthOf } from './expression-prop.js';
import { lowerAtomicCall } from './atomics.js';
import { lowerWorkgroupUniformLoad } from './barriers.js';
import { lowerClassCall } from './class-methods.js';
import { isAtomicIntrinsic, isBarrierIntrinsic, PACKED_4X8_IDS } from '../../../core/intrinsics.js';
import { divergentIntegerId } from '../../../core/ir/divergent-int.js';
import { lowerArrayCtor, lowerArrayFold, lowerFill } from './expression-array.js';
import {
  lowerExpandCall,
  lowerRandomCall,
  lowerScalarCastCall,
  lowerSwizzleCall,
  lowerGenericCall,
  lowerUserCall,
  mathResultType,
} from './expression-misc.js';
import { captureArguments, declaresFunction } from './local-functions.js';
import { declarationOf, functionAround } from './closures.js';
import { makeDiagnostic } from '../diagnostic.js';
import { HOST_GLOBALS } from '../semantic.js';
import { TS_CODES, type TsCode } from '../codes.js';
import { checkMathArgs, mathTakesElem } from './math-args.js';
import { isConsoleMethod } from '../../../core/console.js';

const VEC_CTOR: Readonly<Record<string, { n: 2 | 3 | 4; elem: VecCtorElem }>> = {
  vec2: { n: 2, elem: 'f32' },
  vec2f: { n: 2, elem: 'f32' },
  vec2i: { n: 2, elem: 'i32' },
  vec2u: { n: 2, elem: 'u32' },
  vec2f64: { n: 2, elem: 'f64' },
  vec3: { n: 3, elem: 'f32' },
  vec3f: { n: 3, elem: 'f32' },
  vec3i: { n: 3, elem: 'i32' },
  vec3u: { n: 3, elem: 'u32' },
  vec3f64: { n: 3, elem: 'f64' },
  vec4: { n: 4, elem: 'f32' },
  vec4f: { n: 4, elem: 'f32' },
  vec4i: { n: 4, elem: 'i32' },
  vec4u: { n: 4, elem: 'u32' },
  vec4f64: { n: 4, elem: 'f64' },
  // Vectors of bools (§27): what a vector comparison yields, and a constructor for one.
  vec2b: { n: 2, elem: 'bool' },
  vec3b: { n: 3, elem: 'bool' },
  vec4b: { n: 4, elem: 'bool' },
};

/** The element kinds a vector constructor spells: the three native scalars, the emulated
 *  double the fp64 pass assembles, and bool (§27). */
type VecCtorElem = 'f32' | 'i32' | 'u32' | 'f64' | 'bool';

/** What a `vecN<T>(…)` type argument may name, by the text the author wrote (#150). `f64` is
 *  here because `vec3<f64>` is the long spelling of `vec3f64`, which the surface already has. */
const TYPE_ARG_ELEM: Readonly<Record<string, VecCtorElem>> = {
  f32: 'f32',
  i32: 'i32',
  u32: 'u32',
  f64: 'f64',
  bool: 'bool',
};

/** The short suffix each element kind has, for the message that offers it. */
const SHORT_SUFFIX: Readonly<Record<string, string>> = {
  f32: 'f',
  i32: 'i',
  u32: 'u',
  f64: 'f64',
  bool: 'b',
};

/** The zero of each element kind, for `vecN()`. The emulated double has none here: an `f64`
 *  zero is a pair the fp64 pass assembles, not a literal this path can write. */
function ctorZero(elem: VecCtorElem): Expr | undefined {
  const t = elem === 'f32' ? f32T : elem === 'i32' ? i32T : elem === 'u32' ? u32T : undefined;
  if (t) return { op: 'lit', type: t, value: 0 };
  return elem === 'bool' ? { op: 'lit', type: boolT, value: false } : undefined;
}
/** Matrix constructor name -> its shape. Every `matCxR` of wgsl.txt:4621 plus the `matN`
 *  shorthand for a square one, matching the type names `type-map.ts` accepts, so a type an
 *  author can declare is a value an author can build. */
const MAT_CTOR: Readonly<Record<string, { cols: 2 | 3 | 4; rows: 2 | 3 | 4 }>> = Object.fromEntries(
  ([2, 3, 4] as const).flatMap((cols) =>
    ([2, 3, 4] as const).flatMap((rows) =>
      cols === rows
        ? [[`mat${cols}x${rows}`, { cols, rows }] as const, [`mat${cols}`, { cols, rows }] as const]
        : [[`mat${cols}x${rows}`, { cols, rows }] as const],
    ),
  ),
);

export function lowerCall(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const callee = node.expression;
  let intrinsicId: string | undefined;
  let viaMath = false;
  let ctor: { n: 2 | 3 | 4; elem: VecCtorElem } | undefined;
  /** The name the constructor was written under, for the messages that offer a short form. */
  let ctorName = '';

  if (ts.isPropertyAccessExpression(callee)) {
    const obj = callee.expression;
    // Keep the authoring surface on the JavaScript Console API spelling. The call remains a
    // normal IR call, so it is not a TypeShade-specific debug DSL.
    if (ts.isIdentifier(obj) && obj.text === 'console') {
      const method = callee.name.text;
      if (!isConsoleMethod(method)) {
        pushDiag(
          diagnostics,
          sourceFile,
          callee.name,
          `console.${method}() is not supported in TypeShade yet. Use log, info, debug, warn, or error.`,
          TS_CODES.UNSUPPORTED,
        );
        return undefined;
      }
      const args: Expr[] = [];
      for (const arg of node.arguments) {
        const lowered = lowerExpression(arg, sourceFile, scope, diagnostics);
        if (!lowered) return undefined;
        args.push(lowered);
      }
      return {
        op: 'call',
        type: voidT,
        fn: `console.${method}`,
        args,
        // The one span constructor every lowering uses: a `SourceSpan` carries line and character
        // as well as the offset, and a hand-built `{ file, start, length }` is not one.
        span: spanOf(sourceFile, node),
      };
    }
    if (ts.isIdentifier(obj) && obj.text === 'Math') {
      viaMath = true;
      const jsName = callee.name.text;
      if (resolveMathConst(jsName) !== undefined) {
        pushDiag(
          diagnostics,
          sourceFile,
          node,
          `"Math.${jsName}" is a constant, not a function.`,
          TS_CODES.UNSUPPORTED,
        );
        return undefined;
      }
      if (jsName === 'random') return lowerRandomCall(node, sourceFile, scope, diagnostics);
      if (resolveMathExpand(jsName))
        return lowerExpandCall(jsName, node, sourceFile, scope, diagnostics);
      intrinsicId = resolveMathFn(jsName);
      if (!intrinsicId) {
        pushDiag(
          diagnostics,
          sourceFile,
          node,
          `"Math.${jsName}(...)" is not a TypeShade Math alias.`,
          TS_CODES.UNKNOWN_NAME,
        );
        return undefined;
      }
    } else if (callee.name.text === 'swizzle') {
      return lowerSwizzleCall(node, callee.expression, sourceFile, scope, diagnostics);
    } else {
      // A method of a class the file declares, or a static function on the class (#86); a
      // receiver that is not a struct falls through to the refusals below.
      const viaClass = lowerClassCall(node, callee, sourceFile, scope, diagnostics);
      if (viaClass !== 'not-a-class-call') return viaClass;
      if (JS_ARRAY_METHODS.has(callee.name.text)) {
        pushDiag(
          diagnostics,
          sourceFile,
          node,
          `JS Array method ".${callee.name.text}" is not a shader op. Use sum/min/any/all/zip/fill.`,
          TS_CODES.UNSUPPORTED,
        );
        return undefined;
      }
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        'Method calls are not supported here: a method belongs to a class the file declares ' +
          '(#86); anything else is a free function.',
        TS_CODES.UNSUPPORTED,
      );
      return undefined;
    }
  } else if (ts.isIdentifier(callee)) {
    const name = callee.text;
    // A local function, or a parameter that takes a function, is a name the body declares, and
    // TypeScript's lookup finds it before any global: it wins over a builtin of its name (Rule
    // 9.5). `step(i)` on a parameter `step` calls the function handed over, not WGSL's `step`.
    const declared = declarationOf(callee);
    const local =
      declared !== undefined &&
      functionAround(declared) !== undefined &&
      declaresFunction(declared) &&
      scope.localFunctions()?.has(name) === true
        ? scope.resolveCallee(name)
        : undefined;
    // One refused where it is declared said why there.
    if (local === undefined && declared !== undefined && scope.declarationRefused(name)) {
      return undefined;
    }
    // One that takes a function is copied for the functions this call hands it (Rule 8.18),
    // and wins over a builtin of its name as any local function does (Rule 9.5).
    if (
      local === undefined &&
      declared !== undefined &&
      functionAround(declared) !== undefined &&
      declaresFunction(declared) &&
      scope.localFunctions()?.has(name) === true &&
      scope.isGenericFunction(name)
    ) {
      return lowerGenericCall(node, name, name, sourceFile, scope, diagnostics);
    }
    if (local !== undefined) {
      const leading = captureArguments(local, name, node, sourceFile, scope, diagnostics);
      if (leading === undefined) return undefined;
      return lowerUserCall(
        node,
        local,
        sourceFile,
        scope,
        diagnostics,
        leading.length > 0 ? { leading, shown: name } : {},
      );
    }
    if (name === 'array') return lowerArrayCtor(node, sourceFile, scope, diagnostics);
    if (name === 'fill') return lowerFill(node, sourceFile, scope, diagnostics);
    if (
      name === 'sum' ||
      name === 'min' ||
      name === 'max' ||
      name === 'any' ||
      name === 'all' ||
      name === 'none' ||
      name === 'zip'
    ) {
      // `any(m)` / `all(m)` over a vector of bools is the builtin (§27); over an array with a
      // predicate it is the fold below.
      if ((name === 'any' || name === 'all') && node.arguments.length === 1) {
        const reduced = lowerBoolReduce(name, node, sourceFile, scope, diagnostics);
        if (reduced !== 'not-a-bool-vector') return reduced;
      }
      const folded = lowerArrayFold(name, node, sourceFile, scope, diagnostics);
      if (folded !== 'fallback') return folded;
    }
    // A name #8 A6 added does not shadow a function the file declares: before it, the call
    // resolved to that function, and an addition may not change what a program means.
    const shadowed = USER_FIRST_BUILTINS.has(name) ? scope.resolveCallee(name) : undefined;
    if (shadowed) return lowerUserCall(node, shadowed, sourceFile, scope, diagnostics);
    if (name === 'select') return lowerSelectCall(node, sourceFile, scope, diagnostics);
    if (name === 'arrayLength') return lowerArrayLengthCall(node, sourceFile, scope, diagnostics);
    if (isAtomicIntrinsic(name)) return lowerAtomicCall(name, node, sourceFile, scope, diagnostics);
    // In expression position only: a barrier standing alone is lowered by the statement path.
    if (isBarrierIntrinsic(name)) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `${name}() is a statement with no value; write it on its own line.`,
        TS_CODES.BARRIER_PLACEMENT,
      );
      return undefined;
    }
    // `workgroupUniformLoad` is a VALUE, unlike the barriers above, so it is lowered here
    // rather than by the statement path — but it carries a barrier's placement rules (#152).
    if (name === 'workgroupUniformLoad') {
      const loaded: Expr[] = [];
      for (const a of node.arguments) {
        const lowered = lowerExpression(a, sourceFile, scope, diagnostics);
        if (!lowered) return undefined;
        loaded.push(lowered);
      }
      return lowerWorkgroupUniformLoad(loaded, node, sourceFile, scope, diagnostics);
    }
    if (SCALAR_CAST[name]) return lowerScalarCastCall(name, node, sourceFile, scope, diagnostics);
    // A matrix constructor is its own function, deliberately NOT an arm of the vector one:
    // the two share only a name shape. A vector composes a flat component list; a matrix
    // composes COLUMNS, truncates another matrix, and has a zero form.
    const matCtor = MAT_CTOR[name];
    if (matCtor !== undefined) {
      return lowerMatrixCtor(matCtor, node, sourceFile, scope, diagnostics);
    }
    ctor = VEC_CTOR[name];
    ctorName = name;
    if (!ctor) {
      if (name === 'random') return lowerRandomCall(node, sourceFile, scope, diagnostics);
      if (resolveMathExpand(name))
        return lowerExpandCall(name, node, sourceFile, scope, diagnostics);
      // A texture read is a canonical intrinsic name too, but its arity and result type both
      // depend on the texture argument, so it is routed to lowerTextureCall below rather than
      // through MATH_FN_ARITY, which records neither (#8 A7).
      if (
        name === 'mod' ||
        TEXTURE_CALLS.has(name) ||
        BIT_CALLS.has(name) ||
        isCanonicalMathFn(name)
      )
        intrinsicId = name;
      else {
        const decl = scope.resolveCallee(name);
        if (decl) {
          // A local function that captures variables of the function around it takes each
          // ahead of its own parameters, as this body holds it (Rule 8.17).
          const leading = captureArguments(decl, name, node, sourceFile, scope, diagnostics);
          if (leading === undefined) return undefined;
          return lowerUserCall(
            node,
            decl,
            sourceFile,
            scope,
            diagnostics,
            leading.length > 0 ? { leading, shown: name } : {},
          );
        }
        // A generic function is compiled once per set of argument types the file calls it
        // with (roadmap 0.3 item T9, #92). The instance does not exist until a call asks for
        // it, so the arguments are lowered here, the type arguments read off them, and the
        // instance made before `lowerUserCall` checks the call against it.
        if (scope.isGenericFunction(name)) {
          return lowerGenericCall(node, name, name, sourceFile, scope, diagnostics);
        }
      }
    }
  }

  // `Symbol('k')`, `fetch(url)`: the semantic pass already said the callee is a host API, and
  // lowering the arguments adds a second complaint about the same line — one about a string
  // that is only there because the call is (roadmap 0.3 item T10, #92).
  if (ts.isIdentifier(callee) && HOST_GLOBALS.has(callee.text)) return undefined;

  const args: Expr[] = [];
  for (const arg of node.arguments) {
    const lowered = lowerExpression(arg, sourceFile, scope, diagnostics);
    if (!lowered) return undefined;
    args.push(lowered);
  }

  if (ctor !== undefined) {
    // `vec3<u32>(1, 2, 3)` is WGSL's own spelling (wgsl.txt:20889), and the type argument was
    // read by nobody: the call built a `vec3<f32>` and emitted `vec3<f32>(1.0, 2.0, 3.0)` with
    // zero diagnostics, so a program that asked for an unsigned vector silently got a float one
    // and a following `f32(v.x)` looked like a cast while casting nothing (#150).
    const written = node.typeArguments?.[0]?.getText(sourceFile);
    if (written !== undefined) {
      const named = TYPE_ARG_ELEM[written];
      if (named === undefined) {
        pushDiag(
          diagnostics,
          sourceFile,
          node,
          `vec${ctor.n}<${written}> is not a vector element type; write vec${ctor.n}<f32>, ` +
            `<i32>, <u32> or <bool>, or the short form vec${ctor.n}${SHORT_SUFFIX[ctor.elem] ?? ''}.`,
          TS_CODES.UNKNOWN_TYPE,
        );
        return undefined;
      }
      // `vec3u<f32>(…)` names its element twice and disagrees with itself. Only the plain
      // `vecN` spelling, whose own element is the default f32, takes one.
      //
      // Tested with the same regex the ambient lib uses, not with `endsWith(n)`:
      // `'vec4f64'.endsWith('4')` is TRUE — the 4 of `f64` — so that test let `vec4f64<u32>`
      // through and silently discarded the `f64`, which is the very swap this rule exists to
      // stop. Its `vec2f64`/`vec3f64` siblings were refused correctly, so only the one name
      // where the suffix collides leaked.
      if (!/^vec[234]$/.test(ctorName) && named !== ctor.elem) {
        pushDiag(
          diagnostics,
          sourceFile,
          node,
          `${ctorName}<${written}> names two element types; ${ctorName} is already ` +
            `${ctor.elem}. Write vec${ctor.n}<${written}> or ${ctorName}.`,
          TS_CODES.TYPE_MISMATCH,
        );
        return undefined;
      }
      // The type-argument spelling takes SCALAR components (and none, for the zero value).
      // Composing from a shorter vector or converting a whole one keeps the short name, and
      // that is a parity rule, not a taste: the ambient lib types a parameter concretely —
      // a conditional there defeats the vector-arithmetic filter issue #43 needs — so
      // `vec3<i32>(v)` cannot be declared without either breaking that filter or lying about
      // some other call. Refusing it here is what keeps the editor and the compiler saying
      // the same thing about the same program, and `vec3i(v)` is the same value.
      if (args.some((a) => a.type.kind === 'vec' || a.type.kind === 'vec64')) {
        pushDiag(
          diagnostics,
          sourceFile,
          node,
          `vec${ctor.n}<${written}> takes scalar components; to build one from a vector, ` +
            `write the short name: vec${ctor.n}${SHORT_SUFFIX[named] ?? ''}(...).`,
          TS_CODES.TYPE_MISMATCH,
        );
        return undefined;
      }
      ctor = { n: ctor.n, elem: named };
    }
    const vc: { readonly n: 2 | 3 | 4; readonly elem: VecCtorElem } = ctor;
    // `vec3()` is the ZERO value (wgsl.txt:20015-20030): every component the element's zero.
    // It was "Vector constructor component count mismatch.", which is true of nothing the
    // author wrote — there are no components to count.
    if (node.arguments.length === 0) {
      const zero = ctorZero(vc.elem);
      if (!zero) {
        // Name the spelling the AUTHOR wrote. `vec4<f64>()` reaches here as much as `vec4f64()`
        // does, and a refusal that answers about `vec4f64()` is about a call that is not on the
        // line. The fix stays the short name, which is the one form that takes the f64 zero.
        const spelled = written === undefined ? ctorName : `${ctorName}<${written}>`;
        pushDiag(
          diagnostics,
          sourceFile,
          node,
          `${spelled}() has no zero-value form; write vec${vc.n}f64(f64(0.)).`,
          TS_CODES.ARITY_MISMATCH,
        );
        return undefined;
      }
      return {
        op: 'construct',
        type: vectorCtorType(vc.n, vc.elem),
        args: Array.from({ length: vc.n }, () => zero),
      };
    }
    // `vec3u(1, 2, 3)` types each bare integer literal as the constructor's element kind
    // (#8 A3); an f32 constructor changes nothing, since retargetIntLitCtx only acts on an
    // integer target.
    const elem = ctorElemType(vc.elem);
    if (elem) {
      for (let i = 0; i < args.length; i++) {
        args[i] = retargetIntLitCtx(args[i]!, node.arguments[i]!, elem);
        args[i] =
          reportIntLitRange(args[i]!, node.arguments[i]!, elem, sourceFile, diagnostics) ??
          args[i]!;
      }
    }
    if (args.length === 1 && isVectorCtorScalar(args[0]!.type, vc.elem)) {
      const splat = args[0]!;
      return {
        op: 'construct',
        type: vectorCtorType(vc.n, vc.elem),
        args: Array.from({ length: vc.n }, () => splat),
      };
    }
    // vecN<T>(v: vecN<S>) — WGSL's element-converting constructor (`vec3f(v)`, `vec3u(v)`,
    // `vec2(gid.xy)`), which GLSL ES 3.00 spells the same way (`vec3(uv)`) and which the
    // EDSL's `vec3(v)` already builds as this very node: one argument, a vector of the same
    // size, a different element kind, every component converted. It is checked before the
    // component-count and element rules below, which are about composing a vector out of
    // parts and would reject it as an element-type mismatch.
    if (args.length === 1 && isConvertibleVector(args[0]!.type, vc)) {
      return { op: 'construct', type: vectorCtorType(vc.n, vc.elem), args };
    }
    // vecN(v: vecN<f64>) — the per-lane NARROW, the one conversion an emulated-double vector
    // has. There is nothing to reinterpret componentwise: each lane is a (hi, lo) pair, and
    // `f32(lane)` is the df64_narrow the fp64 pass emits for it. Written out as the explicit
    // component list, so all three backends and the CPU oracle see one ordinary vector
    // constructor and the pass has no new shape to learn (#151 F64-05). The integer and bool
    // constructors are not offered: the pass has no f64 → i32 body (SD0041) and saturating a
    // double through f32 first is not a conversion an author should get by accident.
    const from = args[0];
    if (args.length === 1 && from !== undefined && from.type.kind === 'vec64') {
      if (ctor.elem === 'f32' && from.type.n === ctor.n) {
        return {
          op: 'construct',
          type: vectorCtorType(ctor.n, 'f32'),
          args: Array.from({ length: ctor.n }, (_, i): Expr => ({
            op: 'call',
            type: f32T,
            fn: 'f32',
            args: [{ op: 'member', type: f64T, base: from, field: 'xyzw'[i]! }],
          })),
        };
      }
      if (ctor.elem !== 'f64') {
        // `written` and not a captured `name`: the constructor's identifier is bound in the
        // callee branch above, which has already closed here — and `lib.dom` declares a
        // global `name: string`, so reading it type-checked and threw a ReferenceError at
        // run time instead, taking the language service down with it.
        const written = node.expression.getText(sourceFile);
        pushDiag(
          diagnostics,
          sourceFile,
          node,
          `${written}(${typeKey(from.type)}) — an emulated-double vector narrows to f32 lane ` +
            `by lane and to nothing else; write vec${from.type.n}(v)` +
            (ctor.elem === 'f32'
              ? ' of its own width.'
              : ` and cast that, e.g. ${written}(vec${from.type.n}(v)).`),
          TS_CODES.TYPE_MISMATCH,
        );
        return undefined;
      }
    }
    // fp64 lowering represents vecN<f64> as DF64VecN, while the constructor
    // contract is component-based. Flatten vec64 arguments here so the fp64 pass
    // only has to lower scalar f64 constructor components; it can then reassemble
    // the target DF64VecN from those scalar pairs without treating a whole vec64 as
    // an f64 operand.
    const ctorArgs = vc.elem === 'f64' ? flattenF64VectorArgs(args) : args;
    if (vectorComponentCount(ctorArgs) !== vc.n) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        'Vector constructor component count mismatch.',
        TS_CODES.ARITY_MISMATCH,
      );
      return undefined;
    }
    const badArg = ctorArgs.find((arg) => !isVectorCtorArg(arg.type, vc.elem));
    if (badArg) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `Vector constructor element type mismatch: expected ${vc.elem}.`,
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    }
    return { op: 'construct', type: vectorCtorType(vc.n, vc.elem), args: ctorArgs };
  }

  if (intrinsicId !== undefined && TEXTURE_CALLS.has(intrinsicId)) {
    return lowerTextureCall(intrinsicId, args, node, sourceFile, scope, diagnostics);
  }
  if (intrinsicId !== undefined && BIT_CALLS.has(intrinsicId)) {
    return lowerBitBuiltinCall(intrinsicId, args, node, sourceFile, diagnostics);
  }
  if (!intrinsicId) {
    // A call to a function this file declares and could not lower says nothing here: the
    // declaration already said why it names no callee, and "Unknown function" on top of that
    // is both a second complaint about one mistake and untrue (roadmap 0.3 item T10, #92).
    if (ts.isIdentifier(callee) && scope.declarationRefused(callee.text)) return undefined;
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `Unknown function "${node.getText(sourceFile)}". Declare it in this file, or import it from another shader module.`,
      TS_CODES.UNKNOWN_FN,
    );
    return undefined;
  }
  // atan(y, x) is WGSL's and GLSL's two-argument arctangent, which the IR carries under the
  // neutral id atan2 (`atan2(y, x)` in WGSL, `atan(y, x)` in GLSL). One argument stays atan.
  if (intrinsicId === 'atan' && args.length === 2) intrinsicId = 'atan2';
  else if (intrinsicId === 'atan' && args.length !== 1) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `${viaMath ? 'Math.' : ''}atan expects 1 argument, or 2 for atan(y, x), got ${args.length}.`,
      TS_CODES.ARITY_MISMATCH,
    );
    return undefined;
  }
  // `min(i, 4)` with `i` an i32 types the 4 as i32 (#8 A3). Before this the literal stayed
  // f32 and the call emitted `min(i, 4.0)`, which is not valid WGSL — the one place this
  // item changes the emitted text of source the front end already accepted.
  retargetIntrinsicLiterals(args, node, intrinsicId);
  const arity = expectedArity(intrinsicId) ?? (intrinsicId === 'mod' ? 2 : undefined);
  if (arity !== undefined && args.length !== arity) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `${viaMath ? 'Math.' : ''}${intrinsicId} expects ${arity} argument(s), got ${args.length}.`,
      TS_CODES.ARITY_MISMATCH,
    );
    return undefined;
  }
  if (args.length === 0) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `Call "${intrinsicId}" needs at least one argument.`,
      TS_CODES.ARITY_MISMATCH,
    );
    return undefined;
  }
  // The shapes the signature takes (roadmap 0.2 item 9, #57): one diagnostic on the argument
  // that does not fit, with the fix.
  const display = `${viaMath ? 'Math.' : ''}${intrinsicId === 'atan2' ? 'atan' : intrinsicId}`;
  if (!checkMathArgs(intrinsicId, display, args, node, sourceFile, diagnostics)) return undefined;
  const type = mathResultType(intrinsicId, args);
  return { op: 'call', type, fn: divergentIntegerId(intrinsicId, args[0]?.type, type), args };
}

/** The scalar type a vector constructor's components must have, or undefined for the
 *  emulated-double constructor, whose components the fp64 pass assembles. */
/** `mat3(a, b, c)`, `mat4x3(...)`, `mat2()`, `mat3(m4)` — the matrix constructors of
 *  wgsl.txt:20248ff, which GLSL ES 3.00 spells the same way.
 *
 *  Four forms, and the order they are tried in is the order WGSL gives them:
 *
 *    `matCxR()`            the zero matrix
 *    `matCxR(m)`           from another matrix: the overlapping block, the rest from the
 *                          identity — WGSL gives only the exact-shape conversion, so this
 *                          surface offers the TRUNCATION a renderer actually asks for
 *                          (`mat3(m4)`, the normal matrix) and refuses a widening one
 *    `matCxR(c0, …, cC-1)` from C columns, each a `vecR`
 *    `matCxR(e0, …, e*)`   from C*R scalars, column-major
 *
 *  Its own function rather than an arm of the vector constructor: a vector composes one flat
 *  component list and a matrix composes columns, so sharing the code would mean a flattening
 *  rule that is wrong for one of them. */
function lowerMatrixCtor(
  shape: { cols: 2 | 3 | 4; rows: 2 | 3 | 4 },
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const { cols, rows } = shape;
  const type: ShaderType = { kind: 'mat', cols, rows, elem: 'f32' };
  const shown = typeKey(type);
  const colT: ShaderType = { kind: 'vec', n: rows, elem: 'f32' };
  const args: Expr[] = [];
  for (const arg of node.arguments) {
    const lowered = lowerExpression(arg, sourceFile, scope, diagnostics);
    if (!lowered) return undefined;
    args.push(lowered);
  }

  // `matCxR()` — the zero matrix (wgsl.txt:20015-20030, "T ()"). Written out as C zero
  // columns so every backend and the oracle see an ordinary constructor.
  if (args.length === 0) {
    const zero: Expr = { op: 'lit', type: f32T, value: 0 };
    return {
      op: 'construct',
      type,
      args: Array.from({ length: cols }, () => ({
        op: 'construct' as const,
        type: colT,
        args: Array.from({ length: rows }, () => zero),
      })),
    };
  }

  // `matCxR(m)` — from another matrix.
  if (args.length === 1 && args[0]!.type.kind === 'mat') {
    const from = args[0]!;
    const src = from.type as Extract<ShaderType, { kind: 'mat' }>;
    if (src.elem !== 'f32') {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `${shown} cannot be built from ${typeKey(src)}: the emulated-double matrices are ` +
          `their own square shapes and do not convert.`,
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    }
    if (src.cols < cols || src.rows < rows) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `${shown} cannot be built from the smaller ${typeKey(src)}: this surface truncates a ` +
          `matrix and does not grow one, since the components it would have to invent are a ` +
          `choice the author should make. Write the columns out.`,
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    }
    // The upper-left block, column by column: `mat3(m4)` is the rotation a normal matrix
    // wants out of a model matrix, which is why the truncation is worth having at all.
    return {
      op: 'construct',
      type,
      args: Array.from({ length: cols }, (_, c): Expr => {
        const column: Expr = {
          op: 'index',
          type: { kind: 'vec', n: src.rows, elem: 'f32' },
          base: from,
          idx: { op: 'lit', type: i32T, value: c },
        };
        return src.rows === rows
          ? column
          : { op: 'member', type: colT, base: column, field: 'xyzw'.slice(0, rows) };
      }),
    };
  }

  // `matCxR(c0, …)` — one `vecR` per column.
  if (
    args.length === cols &&
    args.every((a) => a.type.kind === 'vec' && a.type.n === rows && a.type.elem === 'f32')
  ) {
    return { op: 'construct', type, args };
  }

  // `matCxR(e0, …)` — C*R scalars, column-major, gathered into columns here so the IR always
  // carries a matrix as a list of columns whichever way it was written.
  if (args.length === cols * rows) {
    const bad = args.findIndex((a) => typeKey(a.type) !== 'f32');
    if (bad >= 0) {
      pushDiag(
        diagnostics,
        sourceFile,
        node.arguments[bad] ?? node,
        `${shown} takes f32 components; argument ${bad + 1} is ${typeKey(args[bad]!.type)}.`,
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    }
    return {
      op: 'construct',
      type,
      args: Array.from({ length: cols }, (_, c) => ({
        op: 'construct' as const,
        type: colT,
        args: args.slice(c * rows, c * rows + rows),
      })),
    };
  }

  pushDiag(
    diagnostics,
    sourceFile,
    node,
    `${shown} takes ${cols} vec${rows} columns, ${cols * rows} f32 components, a larger ` +
      `matrix to truncate, or nothing for the zero matrix; got ${args.length} argument(s)` +
      `${args.length > 0 ? ` (${args.map((a) => typeKey(a.type)).join(', ')})` : ''}.`,
    TS_CODES.ARITY_MISMATCH,
  );
  return undefined;
}

/** `arrayLength(src)`: the explicit spelling of what `src.length` reads on a runtime-sized
 *  storage array (#46). One argument, and `arrayLengthOf` decides whether it is what the
 *  builtin takes, so the call and the property agree. */
function lowerArrayLengthCall(
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
      `arrayLength expects 1 argument, got ${node.arguments.length}.`,
      TS_CODES.ARITY_MISMATCH,
    );
    return undefined;
  }
  const arg = lowerExpression(node.arguments[0]!, sourceFile, scope, diagnostics);
  if (!arg) return undefined;
  return arrayLengthOf(arg, node, sourceFile, scope, diagnostics, 'arrayLength');
}

function ctorElemType(elem: VecCtorElem): ShaderType | undefined {
  if (elem === 'f32') return f32T;
  if (elem === 'i32') return i32T;
  if (elem === 'u32') return u32T;
  if (elem === 'bool') return boolT;
  return undefined;
}

/** A number written out, with no type of its own: `4`, `-2`, `0.5`. The peer of a builtin
 *  call's literal arguments is the first argument that is not one of these, since a written
 *  number is exactly what has no type to lend. `u32(1)` is a call, not one of these, even
 *  though it lowers to a literal. */
function isBareNumericLiteral(node: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(node)) return isBareNumericLiteral(node.expression);
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    return isBareNumericLiteral(node.operand);
  }
  return ts.isNumericLiteral(node);
}

/** A bare integer literal argument of a builtin call takes the kind of the call's other
 *  arguments (#8 A3): `min(i, 4)` with `i` an i32 makes the 4 an i32, and `clamp(x, 0, 1)`
 *  with `x` an f32 leaves both literals f32, since retargetIntLitCtx only acts on an integer
 *  target. The peer is the element scalar of the first argument that is not itself a written
 *  number, so `min(u32(1), 2)` types the 2 as u32. A call with nothing but written numbers has
 *  no peer and is left alone.
 *
 *  The FIRST argument is never retargeted, whatever the peer says: `mathResultType` is
 *  `args[0].type`, so a literal there types the whole call rather than itself. See the loop.
 *  Mutates `args` in place. */
/** The argument positions of a builtin that are integers by the builtin's own signature, with
 *  the scalar kind each takes. */
const FIXED_LITERAL_KINDS: Readonly<Record<string, Readonly<Record<number, ShaderType>>>> = {
  ldexp: { 1: i32T },
  extractBits: { 1: u32T, 2: u32T },
  insertBits: { 2: u32T, 3: u32T },
};

function retargetIntrinsicLiterals(
  args: Expr[],
  node: ts.CallExpression,
  intrinsicId: string,
): void {
  if (intrinsicId === 'length' || intrinsicId === 'distance' || intrinsicId === 'dot') return;
  // A builtin whose later arguments are integers whatever the first one is (§10): the exponent
  // of `ldexp` is an i32, the offset and count of `extractBits` and `insertBits` are u32. A
  // bare literal there takes that kind, not the first argument's.
  const fixed = FIXED_LITERAL_KINDS[intrinsicId] ?? {};
  for (const [index, kind] of Object.entries(fixed)) {
    const i = Number(index);
    const argNode = node.arguments[i];
    if (argNode && args[i]) args[i] = retargetIntLitCtx(args[i]!, argNode, kind);
  }
  const peerIndex = node.arguments.findIndex((a) => !isBareNumericLiteral(a));
  const peer = peerIndex >= 0 ? args[peerIndex]?.type : undefined;
  // A builtin with NO float form takes an integer, and an integer-written literal is what the
  // author gave it: `countOneBits(5)` was typed f32 and refused as "takes an i32 or u32, or a
  // vector of them; got f32", about a program WGSL accepts — 5 is an AbstractInt there and
  // materialises to i32 (wgsl.txt:3930-3941, measured accepted on Tint). With no peer to take
  // a kind from, i32 is that materialisation. Only an INTEGER-written literal: `countOneBits(5.)`
  // has no integer meaning and keeps its refusal.
  if (!peer && !mathTakesElem(intrinsicId, 'f32') && mathTakesElem(intrinsicId, 'i32')) {
    for (let i = 0; i < args.length; i++) {
      if (fixed[i] !== undefined) continue;
      const argNode = node.arguments[i];
      if (argNode && args[i] && isIntegerLiteralTree(argNode)) {
        args[i] = retargetIntLitCtx(args[i]!, argNode, i32T);
      }
    }
  }
  if (!peer) return;
  const target = literalPeerType(peer);
  // The first position too, for an integer peer of a builtin that takes integers (roadmap 0.2
  // item 9, #57): `min(1, i)` with an i32 `i` is an i32 call, as `min(i, 1)` already was. The
  // result type follows the operand deciding the shape rather than a written number. A float
  // peer changes nothing, and a builtin with no integer form (`pow(2, i)`) keeps its f32 first
  // argument so the argument check names `i` as the odd one out.
  if (peerIndex > 0 && target.kind === 'scalar' && mathTakesElem(intrinsicId, target.scalar)) {
    const argNode = node.arguments[0];
    if (argNode && args[0] && fixed[0] === undefined) {
      args[0] = retargetIntLitCtx(args[0], argNode, target);
    }
  }
  for (let i = 1; i < args.length; i++) {
    if (fixed[i] !== undefined) continue;
    // From 1, never 0: `mathResultType` is `args[0].type`, so retargeting a literal in the
    // FIRST position does not just retype that argument, it retypes the whole call. A sweep
    // over the intrinsics found 42 programs changed by that — 24 that compiled before and
    // errored after (`max(1, i)` became an i32 call and no longer fit an f32 position) and 18
    // whose emit moved. Retargeting only the later arguments keeps the case this item is
    // about, `min(i, 4)`, because there the peer is the first argument and the literal is not.
    //
    // What it leaves alone is `min(1, i)`, a literal in the type-deciding position, which
    // still types the call f32 and emits `min(1.0, i)` — invalid WGSL, exactly as on main.
    // Fixing that means changing how an intrinsic call's result type is decided, which is a
    // change to every intrinsic rather than to this rule, and is not additive.
    const argNode = node.arguments[i];
    if (!argNode) continue;
    // `mix`'s interpolant stays a plain f32 beside a SCALAR emulated double: the df64 body
    // blends by a float, and the pass refuses an f64 `t` outright. Without this the literal
    // in `mix(a64, b64, 0.25)` would take the f64 peer like any other later argument and then
    // be refused at the argument check — a written 0.25 with no way to spell it (#151). A
    // `vec64` peer needs no arm: `literalPeerType` leaves a literal beside one f32 already.
    if (intrinsicId === 'mix' && i === 2 && isF64(target)) {
      args[i] = retargetIntLitCtx(args[i]!, argNode, f32T);
      continue;
    }
    args[i] = retargetIntLitCtx(args[i]!, argNode, target);
  }
}

/** `select(falseValue, trueValue, cond)` — WGSL's argument order, which is what this surface
 *  follows (the EDSL's free `select(cond, a, b)` puts the condition first; #8 S-seam notes the
 *  difference and keeps each surface's own order). It lowers to the `select` Expr op, the very
 *  node `cond ? trueValue : falseValue` already lowers to, so the two spellings are one IR and
 *  the backends spell it as `select(f, t, c)` in WGSL and `(c ? t : f)` in GLSL. It is not a
 *  call: the oracle and both writers handle `select` as an Expr, never as an intrinsic call. */
function lowerSelectCall(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  if (node.arguments.length !== 3) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `select expects 3 argument(s), got ${node.arguments.length}. ` +
        "The order is WGSL's: select(falseValue, trueValue, cond).",
      TS_CODES.ARITY_MISMATCH,
    );
    return undefined;
  }
  const lowered: Expr[] = [];
  for (const arg of node.arguments) {
    const one = lowerExpression(arg, sourceFile, scope, diagnostics);
    if (!one) return undefined;
    lowered.push(one);
  }
  let [ifFalse, ifTrue] = lowered as [Expr, Expr];
  const cond = lowered[2]!;
  const perComponent = cond.type.kind === 'vec' && cond.type.elem === 'bool';
  if (typeKey(cond.type) !== 'bool' && !perComponent) {
    pushDiag(
      diagnostics,
      sourceFile,
      node.arguments[2]!,
      `select condition must be bool or a vector of bools, got ${typeKey(cond.type)}. ` +
        "The order is WGSL's: select(falseValue, trueValue, cond).",
      TS_CODES.TYPE_MISMATCH,
    );
    return undefined;
  }
  ifFalse = retargetIntLit(ifFalse, node.arguments[0]!, ifTrue.type);
  ifTrue = retargetIntLit(ifTrue, node.arguments[1]!, ifFalse.type);
  if (typeKey(ifTrue.type) !== typeKey(ifFalse.type)) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `select arm type mismatch: ${typeKey(ifFalse.type)} vs ${typeKey(ifTrue.type)}.`,
      TS_CODES.TYPE_MISMATCH,
    );
    return undefined;
  }
  // A vector of bools picks per component (§27), so the arms are vectors of its size.
  if (perComponent && cond.type.kind === 'vec') {
    if (ifTrue.type.kind !== 'vec' || ifTrue.type.n !== cond.type.n) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `select with a ${typeKey(cond.type)} condition picks per component and needs ` +
          `${cond.type.n}-component arms; got ${typeKey(ifTrue.type)}.`,
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    }
  }
  return { op: 'select', type: ifTrue.type, cond, ifTrue, ifFalse };
}

/** `any(m)` / `all(m)` over a vector of bools (§27): the builtin of both targets, reducing the
 *  components. Returns the marker when the one argument is not such a vector, so the array
 *  fold of the same name (`any(xs, pred)`) keeps its turn and its diagnostics. */
function lowerBoolReduce(
  name: 'any' | 'all',
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined | 'not-a-bool-vector' {
  const peek = lowerExpression(node.arguments[0]!, sourceFile, scope, []);
  if (!peek) return 'not-a-bool-vector';
  // `all(e: bool) -> bool` and `any(e: bool) -> bool` are overloads of both builtins, and both
  // "Return e" (wgsl.txt:21294-21314). The ambient lib always admitted the scalar; the front
  // end refused it, so the editor and the compiler disagreed about a program WGSL defines.
  // Lowered to the ARGUMENT, not to a call: a one-component reduction is the value itself, and
  // GLSL ES 3.00 has no `all(bool)` overload at all, so emitting the call would fail there.
  if (peek.type.kind === 'scalar' && peek.type.scalar === 'bool') {
    return lowerExpression(node.arguments[0]!, sourceFile, scope, diagnostics);
  }
  if (peek.type.kind !== 'vec' || peek.type.elem !== 'bool') {
    // An array takes the fold's turn and its own message; anything else is neither shape.
    if (peek.type.kind === 'array') return 'not-a-bool-vector';
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `${name}(v) takes a vector of bools, which a comparison of two vectors gives (§27), or ` +
        `an array with a predicate, ${name}(xs, (x) => ...); got ${typeKey(peek.type)}.`,
      TS_CODES.TYPE_MISMATCH,
    );
    return undefined;
  }
  const arg = lowerExpression(node.arguments[0]!, sourceFile, scope, diagnostics);
  if (!arg) return undefined;
  return { op: 'call', type: boolT, fn: name, args: [arg] };
}

/** The bit-level builtins of WGSL §17.10-§17.11 and §17.7.28 (#150). The IR and both backends
 *  have spelled these since the registry was written; nothing on this surface could NAME them.
 *
 *  Kept out of the generic math path because neither their argument nor their result follows
 *  `args[0].type`: a pack takes a vector of `f32` and yields a `u32`, an unpack does the
 *  reverse. The types are exact — WGSL has ONE overload each, so a `vec3` handed to
 *  `pack4x8unorm` or an `i32` to `unpack2x16float` is refused here rather than by Tint. */
const BIT_BUILTINS: Readonly<
  Record<string, { readonly arg: ShaderType; readonly result: ShaderType }>
> = {
  pack4x8unorm: { arg: vec4fT, result: u32T },
  pack4x8snorm: { arg: vec4fT, result: u32T },
  unpack4x8unorm: { arg: u32T, result: vec4fT },
  unpack4x8snorm: { arg: u32T, result: vec4fT },
  pack2x16float: { arg: vec2fT, result: u32T },
  pack2x16unorm: { arg: vec2fT, result: u32T },
  pack2x16snorm: { arg: vec2fT, result: u32T },
  unpack2x16float: { arg: u32T, result: vec2fT },
  unpack2x16unorm: { arg: u32T, result: vec2fT },
  unpack2x16snorm: { arg: u32T, result: vec2fT },
  // The packed 4x8 INTEGER family (#152, wgsl.txt:21906/21920): a `u32` read as four bytes,
  // component 0 in the low byte. Same one-overload shape as the rows above, so the same table.
  // The two `dot4*Packed` forms take TWO arguments and live in their own table below.
  pack4xU8: { arg: vec4uT, result: u32T },
  pack4xU8Clamp: { arg: vec4uT, result: u32T },
  // Both SIGNED packs return a `u32`, not an `i32`: WGSL declares them `-> u32`
  // (index.bs:20307, :20341), and the value is four bytes in a word rather than a number with
  // a sign. Typed `i32` here, a clean program emitted WGSL Tint refuses — measured,
  // `out[gid.x] = pack4xI8(vec4i(1, 2, 3, 4))` into an i32 buffer is "cannot assign 'u32' to
  // 'i32'", and adding the result to `dot4I8Packed`'s (which IS an i32) is "no matching
  // overload for 'operator + (u32, i32)'". The CPU oracle always returned the unsigned value,
  // so the IR type disagreed with its own oracle as well as with the target.
  pack4xI8: { arg: vec4iT, result: u32T },
  pack4xI8Clamp: { arg: vec4iT, result: u32T },
  unpack4xU8: { arg: u32T, result: vec4uT },
  unpack4xI8: { arg: u32T, result: vec4iT },
};

/** The two packed 4x8 DOT products (#152). Their own table because they take two `u32`s, not
 *  one argument: `dot4U8Packed` sums four unsigned byte products into a `u32`, `dot4I8Packed`
 *  four signed ones into an `i32`. Measured on a real device by dispatching both:
 *  `dot4U8Packed(0x01010101, 0x01010101)` is 4 and `dot4I8Packed(0x80808080, 0x01010101)` is
 *  -512. WGSL-only; the `packed4x8Dot` capability fails a module closed on GLSL ES 3.00. */
const PACKED_DOTS: Readonly<Record<string, ShaderType>> = {
  dot4U8Packed: u32T,
  dot4I8Packed: i32T,
};

/** The names routed to {@link lowerBitBuiltinCall}: the ten above, plus the two whose id or
 *  result the call site decides — `quantizeToF16`, whose GLSL spelling is one id per width,
 *  and `bitcast`, whose result is its TYPE ARGUMENT. */
const BIT_CALLS: ReadonlySet<string> = new Set([
  ...Object.keys(BIT_BUILTINS),
  ...Object.keys(PACKED_DOTS),
  'quantizeToF16',
  'bitcast',
]);

/** The neutral id `quantizeToF16` takes at each width: GLSL has no such builtin and spells it
 *  as a half-precision round trip, which runs two components at a time. */
const QUANTIZE_ID: Readonly<Record<number, string>> = {
  1: 'quantizeToF16',
  2: 'quantizeToF16Vec2',
  3: 'quantizeToF16Vec3',
  4: 'quantizeToF16Vec4',
};

/** `bitcast<T>(e)`: the same 32 bits read as another type (wgsl.txt:21147). The target type is
 *  a TYPE ARGUMENT, not an argument, because that is how WGSL spells it and how the two
 *  neutral ids already in the registry are shaped (`bitcastU32`, `bitcastF32`). */
const BITCAST_ID: Readonly<
  Record<string, { readonly id: string; readonly from: ShaderType; readonly article: string }>
> = {
  u32: { id: 'bitcastU32', from: f32T, article: 'an' },
  f32: { id: 'bitcastF32', from: u32T, article: 'a' },
};

function lowerBitBuiltinCall(
  id: string,
  args: readonly Expr[],
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  // The two packed dots take two `u32`s, so they are answered before the one-argument arity
  // check below rather than by it.
  const dotResult = PACKED_DOTS[id];
  if (dotResult) {
    if (!arityPlain(id, args, 2, node, sourceFile, diagnostics)) return undefined;
    for (const [i, a] of args.entries()) {
      const retyped = retargetIntLitCtx(a, node.arguments[i]!, u32T);
      if (typeKey(retyped.type) !== 'u32') {
        pushDiag(
          diagnostics,
          sourceFile,
          node.arguments[i]!,
          `${id} reads each argument as four packed bytes, so both are u32; ` +
            `argument ${String(i + 1)} is ${typeKey(a.type)}. Write u32(x).`,
          TS_CODES.TYPE_MISMATCH,
        );
        return undefined;
      }
      (args as Expr[])[i] = retyped;
    }
    return { op: 'call', type: dotResult, fn: id, args: [...args] };
  }
  if (!arityPlain(id, args, 1, node, sourceFile, diagnostics)) return undefined;
  const arg = args[0]!;
  if (id === 'bitcast') {
    const written = node.typeArguments?.[0]?.getText(sourceFile);
    const target = written === undefined ? undefined : BITCAST_ID[written];
    if (!target) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `bitcast needs the type to read the bits as, bitcast<u32>(x) or bitcast<f32>(x)` +
          `${written === undefined ? '' : `; got bitcast<${written}>`}. Those are the two the ` +
          `IR carries today; the signed pair is not here yet.`,
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    }
    if (typeKey(arg.type) !== typeKey(target.from)) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `bitcast<${written}> reads the bits of ${target.article} ${typeKey(target.from)}; got ` +
          `${typeKey(arg.type)}. A bitcast reinterprets 32 bits, it does not convert: ` +
          `${written}(x) is the conversion.`,
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    }
    return { op: 'call', type: written === 'u32' ? u32T : f32T, fn: target.id, args: [arg] };
  }
  if (id === 'quantizeToF16') {
    const n =
      arg.type.kind === 'scalar' && arg.type.scalar === 'f32'
        ? 1
        : arg.type.kind === 'vec' && arg.type.elem === 'f32'
          ? arg.type.n
          : 0;
    if (n === 0) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `quantizeToF16 takes an f32 or a vector of them; got ${typeKey(arg.type)}.`,
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    }
    return { op: 'call', type: arg.type, fn: QUANTIZE_ID[n]!, args: [arg] };
  }
  const sig = BIT_BUILTINS[id]!;
  // `unpack2x16float(65536)` writes the bit pattern as a bare number, which lowers to an f32
  // on this surface. Retargeted like every other integer literal in an integer position (#8
  // A3), so the author is not asked to write `u32(65536)` for a constant.
  const fixed = typeKey(sig.arg) === 'u32' ? retargetIntLitCtx(arg, node.arguments[0]!, u32T) : arg;
  if (typeKey(fixed.type) !== typeKey(sig.arg)) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `${id} takes a ${typeKey(sig.arg)}; got ${typeKey(fixed.type)}. WGSL gives it one ` +
        // "and GLSL ES 3.00 the same" is true of the ten pack/unpack rows this message was
        // written for and FALSE of the packed 4x8 family (#152), which GLSL ES 3.00 has no
        // form of at all — so the sentence names the target that actually has the overload.
        (PACKED_4X8_IDS.has(id)
          ? `overload, and GLSL ES 3.00 has no form of it at all.`
          : `overload, and GLSL ES 3.00 the same.`),
      TS_CODES.TYPE_MISMATCH,
    );
    return undefined;
  }
  return { op: 'call', type: sig.result, fn: id, args: [fixed] };
}

/** The arity check of the bit builtins, which name themselves rather than the texture they
 *  read, so the texture `arity` helper's message does not fit. */
function arityPlain(
  id: string,
  args: readonly Expr[],
  want: number,
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): boolean {
  if (args.length === want) return true;
  pushDiag(
    diagnostics,
    sourceFile,
    node,
    `${id} expects ${want} argument(s), got ${args.length}.`,
    TS_CODES.ARITY_MISMATCH,
  );
  return false;
}

/** The texture reads this surface spells (#8 A7). They are kept out of the generic intrinsic
 *  path for two reasons: `mathResultType` is `args[0].type`, which for a texture call is the
 *  TEXTURE, and each one picks a different neutral id depending on whether the texture is an
 *  array — the same choice the EDSL's overloads make. */
const TEXTURE_CALLS = new Set([
  'textureSample',
  'textureSampleLevel',
  'textureLoad',
  'textureDimensions',
  'textureNumLayers',
  'textureStore',
  'textureSampleCompare',
  'textureSampleCompareLevel',
  'textureSampleBias',
  'textureSampleGrad',
  'textureGather',
  'textureGatherCompare',
  'textureNumSamples',
]);

/** `textureStore(dst, coord, value)`, `textureLoad(src, coord)` and `textureDimensions(t)` on a
 *  storage texture (roadmap 0.4 item 10).
 *
 *  Three things are checked here that Tint also checks, so the author reads this compiler's
 *  words and a span in their own file rather than a driver's message about generated code: the
 *  access mode has to admit the call (`textureLoad` on a `write` texture and `textureStore` on
 *  a `read` one are both "no matching call" on Tint), and the value stored has to be the
 *  texel type the FORMAT decides — `rgba8uint` stores a `vec4u`, `rgba8unorm` a `vec4`.
 *
 *  The coordinate goes through `vecArg` like every other texture's (#145): its width is the
 *  dim's and its element an `i32` or a `u32`, either of which Tint takes, so both `vec2i` and
 *  `vec2u` are written here as they are. */
function lowerStorageTextureCall(
  id: string,
  tex: Extract<ShaderType, { kind: 'storage-texture' }>,
  args: readonly Expr[],
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const isArray = tex.dim === '2d-array';
  const texel: ShaderType = { kind: 'vec', n: 4, elem: storageTexel(tex.format) };
  const shown = typeKey(tex);
  if (id === 'textureDimensions') {
    // NO mip level here, unlike every sampled and depth texture. A storage texture has exactly
    // one level, and WGSL gives its `textureDimensions` no level overload at all — measured on
    // Tint: `no matching call to 'textureDimensions(texture_storage_2d<r32float, read>, u32)'`,
    // against 33 candidates. So the extra argument is refused where it is written rather than
    // emitted for Tint to reject.
    if (args.length > 1) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `textureDimensions on a ${shown} takes the texture alone: a storage texture has one ` +
          `mip level, so there is no level to ask for.`,
        TS_CODES.ARITY_MISMATCH,
      );
      return undefined;
    }
    return arity(id, args, 1, node, sourceFile, diagnostics)
      ? { op: 'call', type: vec2uT, fn: id, args: [...args] }
      : undefined;
  }
  if (id === 'textureNumLayers') {
    // A storage ARRAY has layers, and answering "takes a sampled texture … has no sampler" was
    // the wrong reason as well as the wrong answer (wgsl.txt:24360; measured accepted on Tint).
    if (!isArray) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `textureNumLayers needs a texture_storage_2d_array; "${shown}" has no layers.`,
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    }
    return arity(id, args, 1, node, sourceFile, diagnostics)
      ? { op: 'call', type: u32T, fn: 'textureNumLayersStorage', args: [...args] }
      : undefined;
  }
  if (id === 'textureLoad') {
    if (tex.access === 'write') {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `"${shown}" is write-only, so textureLoad cannot read it. Declare it "read" to read ` +
          `it, or "read_write" to do both — which only "r32uint", "r32sint" and "r32float" ` +
          `allow, so a format outside those takes a second binding over the same texture.`,
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    }
    if (!arity(id, args, isArray ? 3 : 2, node, sourceFile, diagnostics)) return undefined;
    if (!vecArg(id, tex, args[1]!, node.arguments[1]!, 'coordinate', sourceFile, diagnostics))
      return undefined;
    const out = [...args];
    // The layer of an array texture is an integer: a bare `0` would lower to `0.0`, which
    // Tint refuses ("no matching call"), so it is retyped like every other layer.
    if (isArray) {
      const layer = intArg(id, out[2]!, node.arguments[2]!, i32T, 'layer', sourceFile, diagnostics);
      if (!layer) return undefined;
      out[2] = layer;
    }
    return { op: 'call', type: texel, fn: id, args: out };
  }
  if (id === 'textureStore') {
    if (tex.access === 'read') {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `"${shown}" is read-only, so textureStore cannot write it. Declare it "write" to ` +
          `write it, or "read_write" to do both — which only "r32uint", "r32sint" and ` +
          `"r32float" allow.`,
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    }
    if (!arity(id, args, isArray ? 4 : 3, node, sourceFile, diagnostics)) return undefined;
    if (!vecArg(id, tex, args[1]!, node.arguments[1]!, 'coordinate', sourceFile, diagnostics))
      return undefined;
    const out = [...args];
    if (isArray) {
      const layer = intArg(id, out[2]!, node.arguments[2]!, i32T, 'layer', sourceFile, diagnostics);
      if (!layer) return undefined;
      out[2] = layer;
    }
    const value = out[isArray ? 3 : 2]!;
    if (typeKey(value.type) !== typeKey(texel)) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `"${shown}" stores a ${typeKey(texel)}; got ${typeKey(value.type)}. The texel type is ` +
          `the format's own: a "…uint" format stores a vec4u, a "…sint" one a vec4i, and ` +
          `every other one — unorm, snorm and float — a vec4.`,
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    }
    return { op: 'call', type: voidT, fn: id, args: out };
  }
  pushDiag(
    diagnostics,
    sourceFile,
    node,
    `${id} takes a sampled texture; "${shown}" is a storage texture, which is read and ` +
      `written by texel coordinate with textureLoad and textureStore and has no sampler.`,
    TS_CODES.TYPE_MISMATCH,
  );
  return undefined;
}

/** `textureSampleCompare(tex, smp, uv, ref)` and `textureSampleCompareLevel(…)` on a depth
 *  texture, with the layer between the coordinate and the reference on the array form
 *  (roadmap 0.4 item 11). Both yield an `f32`: how much of the filter footprint passed the
 *  comparison, not a texel. The sampler has to be a `sampler_comparison`; an ordinary one has
 *  no reference to compare against, and Tint refuses the pairing as "no matching call".
 *
 *  `textureSampleCompare` uses the implicit level of detail, so it is fragment-only, which
 *  `FRAGMENT_ONLY_CALLS` in function.ts reports by stage; `…Level` samples level 0 anywhere.
 *
 *  A PLAIN read of a depth texture — `textureSample` with an ordinary sampler, `textureLoad` —
 *  is refused here for now, with the reason: GLSL ES 3.00 fuses a texture and its sampler into
 *  one object whose type is decided by the read (`sampler2D` for a plain one, `sampler2DShadow`
 *  for a comparison), so a depth texture read both ways needs WebGPU's separate samplers, a
 *  capability a later item adds. Until then every depth read is a comparison and the GLSL
 *  combined type is one spelling per dim. */
function lowerDepthTextureCall(
  id: string,
  tex: Extract<ShaderType, { kind: 'depth-texture' }>,
  args: readonly Expr[],
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  // A multisampled depth texture is loaded, never compared (roadmap 0.4 item 13); WGSL-only by
  // the msaaTextureLoad capability, so the fused-sampler reason that defers a plain read of the
  // other depth textures does not arise for it.
  if (tex.dim === '2d-ms')
    return lowerMultisampledCall(id, tex, args, node, sourceFile, diagnostics);
  const suffix = arraySuffix(tex.dim);
  const isArray = suffix !== '';
  const shown = typeKey(tex);
  if (id === 'textureDimensions') {
    // A cube's size is the size of one face, two wide on both targets, so it keeps the 2d id.
    const out = dimsArgs(id, args, node, sourceFile, diagnostics);
    return out ? { op: 'call', type: vec2uT, fn: id, args: out } : undefined;
  }
  if (id === 'textureNumLayers') {
    if (!isArray) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        tex.dim === 'cube'
          ? `textureNumLayers needs a texture_depth_2d_array or a texture_depth_cube_array; a ` +
              `texture_depth_cube has six faces, not layers.`
          : `textureNumLayers needs a texture_depth_2d_array; a plain depth texture has no layers.`,
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    }
    return arity(id, args, 1, node, sourceFile, diagnostics)
      ? { op: 'call', type: u32T, fn: id, args: [...args] }
      : undefined;
  }
  if (id === 'textureSampleCompare' || id === 'textureSampleCompareLevel') {
    const smp = args[1];
    if (smp === undefined || smp.type.kind !== 'sampler-comparison') {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `${id} compares through a sampler_comparison; got ` +
          `${smp === undefined ? 'nothing' : typeKey(smp.type)}. An ordinary sampler filters a ` +
          `texel and has no reference to compare against. Declare the sampler ` +
          `"declare const smp: sampler_comparison".`,
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    }
    if (!arity(id, args, isArray ? 5 : 4, node, sourceFile, diagnostics)) return undefined;
    if (!vecArg(id, tex, args[2]!, node.arguments[2]!, 'coordinate', sourceFile, diagnostics))
      return undefined;
    const out = [...args];
    if (isArray) {
      // The layer is an integer, as on a sampled array texture.
      const layer = intArg(id, out[3]!, node.arguments[3]!, i32T, 'layer', sourceFile, diagnostics);
      if (!layer) return undefined;
      out[3] = layer;
    }
    // …and the reference depth that follows it is an `f32` (wgsl.txt:24734).
    const refIndex = isArray ? 4 : 3;
    const ref = floatArg(
      id,
      out[refIndex]!,
      node.arguments[refIndex]!,
      'depth_ref',
      sourceFile,
      diagnostics,
    );
    if (!ref) return undefined;
    out[refIndex] = ref;
    // The cube form is its own id (roadmap 0.4 item 12): on GLSL the reference folds into a
    // vec4 after the vec3 direction, where the 2d form folds it into a vec3.
    const fn = isArray ? `${id}${suffix}` : tex.dim === 'cube' ? `${id}Cube` : id;
    return { op: 'call', type: f32T, fn, args: out };
  }
  if (id === 'textureSample' || id === 'textureSampleLevel' || id === 'textureLoad') {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `"${shown}" is read by comparison: textureSampleCompare(tex, smp, uv, ref) with a ` +
        `sampler_comparison yields how much of the footprint passed. A plain read of a depth ` +
        `texture — ${id} — is not here yet: on GLSL ES 3.00 the texture and its sampler are one ` +
        `object whose type the read decides, so a depth texture read both ways needs separate ` +
        `samplers, which a later item adds.`,
      TS_CODES.UNSUPPORTED,
    );
    return undefined;
  }
  pushDiag(
    diagnostics,
    sourceFile,
    node,
    `${id} does not take a depth texture; "${shown}" is read with textureSampleCompare.`,
    TS_CODES.TYPE_MISMATCH,
  );
  return undefined;
}

/**
 * Lower `textureSample(tex, smp, uv)` and its siblings.
 *
 * The id a call becomes is decided by the texture's own `dim`, not by an argument count:
 * `textureSample` on a `texture_2d_array<f32>` is the neutral id `textureSampleArray`, which
 * WGSL spells `textureSample(t, s, uv, layer)` and GLSL ES 3.00 folds into a `vec3`
 * coordinate. That is exactly what `textureSample(tex, smp, uv, layer)` in the EDSL does, so
 * the two surfaces build the same node.
 *
 * @returns the `call` expression, or `undefined` after pushing a diagnostic.
 */
function lowerTextureCall(
  id: string,
  args: readonly Expr[],
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  // A gather takes its texture SECOND on a colour texture, after the component (roadmap 0.4
  // item 12), so it is routed before anything below reads args[0] as the texture.
  if (id === 'textureGather' || id === 'textureGatherCompare') {
    return lowerGatherCall(id, args, node, sourceFile, scope, diagnostics);
  }
  const tex = args[0];
  // A storage texture is read and written by texel coordinate (roadmap 0.4 item 10), so the
  // three calls that take one go down their own path: its access mode decides which of them
  // apply, and its FORMAT decides the texel type where a sampled texture's element would.
  if (tex && tex.type.kind === 'storage-texture') {
    return lowerStorageTextureCall(id, tex.type, args, node, sourceFile, diagnostics);
  }
  // A depth texture is read by COMPARISON (roadmap 0.4 item 11): its own path, since the reads
  // that apply, the sampler they take and the type they yield all differ from a sampled one.
  if (tex && tex.type.kind === 'depth-texture') {
    return lowerDepthTextureCall(id, tex.type, args, node, sourceFile, diagnostics);
  }
  if (!tex || tex.type.kind !== 'texture') {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `${id} takes a texture as its first argument.`,
      TS_CODES.TYPE_MISMATCH,
    );
    return undefined;
  }
  if (id === 'textureStore') {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `textureStore writes a storage texture; "${typeKey(tex.type)}" is a sampled texture, ` +
        `which is read through a sampler and never written. Declare the binding as ` +
        `texture_storage_2d<"rgba8unorm", "write"> (or whichever format) to write to it.`,
      TS_CODES.TYPE_MISMATCH,
    );
    return undefined;
  }
  // The array forms are their own ids: `Array` for a 2d array, `CubeArray` for a cube array
  // (roadmap 0.4 item 12), since the two restructure their GLSL arguments differently.
  // A multisampled texture is read one sample at a time and never sampled (roadmap 0.4 item
  // 13): its own path, since the third argument of its load is a sample index, not a level.
  if (tex.type.dim === '2d-ms') {
    return lowerMultisampledCall(id, tex.type, args, node, sourceFile, diagnostics);
  }
  const suffix = arraySuffix(tex.type.dim);
  const isArray = suffix !== '';
  const shown = typeKey(tex.type);
  const texel: ShaderType = { kind: 'vec', n: 4, elem: tex.type.elem };
  // The two sampler kinds are not interchangeable in either direction, and Tint says so ("no
  // matching call"); this says it first, in the author's own file (roadmap 0.4 item 11).
  if (id === 'textureSampleCompare' || id === 'textureSampleCompareLevel') {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `${id} compares against a depth texture; "${typeKey(tex.type)}" is a sampled colour ` +
        `texture with no depth to compare. Declare the shadow map "texture_depth_2d" and read ` +
        `it with a "sampler_comparison".`,
      TS_CODES.TYPE_MISMATCH,
    );
    return undefined;
  }
  if (
    (id === 'textureSample' || id === 'textureSampleLevel') &&
    args[1]?.type.kind === 'sampler-comparison'
  ) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `${id} filters a texel through an ordinary sampler; a sampler_comparison compares a ` +
        `reference depth against the texel instead, and reads a texture_depth_2d with ` +
        `textureSampleCompare. Declare this sampler "sampler" to sample with it.`,
      TS_CODES.TYPE_MISMATCH,
    );
    return undefined;
  }
  switch (id) {
    case 'textureDimensions': {
      const out = dimsArgs(id, args, node, sourceFile, diagnostics);
      if (!out) return undefined;
      // A 3d texture's size is three wide, and its own id on GLSL (`uvec3` where the 2d wrapper
      // is `uvec2`); a cube's is the size of one face, two wide on both targets (item 12).
      // A 1d texture's size is ONE wide, a u32, and its own id for the same reason (item 12).
      if (tex.type.dim === '1d')
        return { op: 'call', type: u32T, fn: 'textureDimensions1d', args: out };
      return tex.type.dim === '3d'
        ? { op: 'call', type: vec3uT, fn: 'textureDimensions3d', args: out }
        : { op: 'call', type: vec2uT, fn: id, args: out };
    }
    case 'textureNumSamples':
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `textureNumSamples takes a texture_multisampled_2d; a ${shown} has one sample per texel.`,
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    case 'textureNumLayers':
      if (!isArray) {
        pushDiag(
          diagnostics,
          sourceFile,
          node,
          tex.type.dim === '1d'
            ? `textureNumLayers needs a texture_2d_array; a texture_1d has no layers.`
            : tex.type.dim === 'cube'
              ? `textureNumLayers needs a texture_2d_array or a texture_cube_array; a texture_cube has six faces, not layers.`
              : tex.type.dim === '3d'
                ? `textureNumLayers needs a texture_2d_array; a texture_3d has depth, not layers: ` +
                  `textureDimensions(t).z is its slice count.`
                : `textureNumLayers needs a texture_2d_array; a plain 2D texture has no layers.`,
          TS_CODES.TYPE_MISMATCH,
        );
        return undefined;
      }
      return arity(id, args, 1, node, sourceFile, diagnostics)
        ? { op: 'call', type: u32T, fn: id, args: [...args] }
        : undefined;
    case 'textureSample':
    case 'textureSampleLevel':
    case 'textureSampleBias':
    case 'textureSampleGrad': {
      // Sampling is float-only on both targets: an integer texture has no filtering, so WGSL
      // gives it no `textureSample` overload at all. textureLoad is the read it does have.
      if (tex.type.elem !== 'f32') {
        pushDiag(
          diagnostics,
          sourceFile,
          node,
          `${id} needs a float texture; ${shown} is read with ` +
            `${tex.type.dim === 'cube' || tex.type.dim === 'cube-array' ? 'textureGather' : 'textureLoad'}.`,
          TS_CODES.TYPE_MISMATCH,
        );
        return undefined;
      }
      // WGSL gives a 1d texture textureSample and textureSampleLevel only (roadmap 0.4 item 12).
      if (tex.type.dim === '1d' && (id === 'textureSampleBias' || id === 'textureSampleGrad')) {
        pushDiag(
          diagnostics,
          sourceFile,
          node,
          `${id} has no texture_1d form on WGSL; a ${shown} is read with textureSample, ` +
            `textureSampleLevel or textureLoad.`,
          TS_CODES.UNSUPPORTED,
        );
        return undefined;
      }
      // (tex, smp, coord) plus a level or a bias, or two gradients (roadmap 0.4 item 12); the
      // array form adds its layer after the coordinate on every one of them.
      const base = id === 'textureSample' ? 3 : id === 'textureSampleGrad' ? 5 : 4;
      const want = isArray ? base + 1 : base;
      if (!arity(id, args, want, node, sourceFile, diagnostics)) return undefined;
      if (
        !vecArg(id, tex.type, args[2]!, node.arguments[2]!, 'coordinate', sourceFile, diagnostics)
      )
        return undefined;
      const fn = `${id}${suffix}`;
      // The LAYER is an integer; the mip LEVEL of a sampled read, and a bias on it, are `f32`
      // (wgsl.txt:25081, 24615). (`textureSampleLevel`'s level argument sits where the layer
      // does on the non-array form, which is why the index is computed rather than fixed.)
      const out = [...args];
      if (isArray) {
        const layer = intArg(
          id,
          out[3]!,
          node.arguments[3]!,
          i32T,
          'layer',
          sourceFile,
          diagnostics,
        );
        if (!layer) return undefined;
        out[3] = layer;
      }
      if (id === 'textureSampleLevel' || id === 'textureSampleBias') {
        const k = isArray ? 4 : 3;
        const lod = floatArg(
          id,
          out[k]!,
          node.arguments[k]!,
          id === 'textureSampleBias' ? 'bias' : 'level',
          sourceFile,
          diagnostics,
        );
        if (!lod) return undefined;
        out[k] = lod;
      }
      // The gradients have the coordinate's width, on both targets.
      if (id === 'textureSampleGrad') {
        const first = isArray ? 4 : 3;
        for (const k of [first, first + 1]) {
          if (
            !vecArg(id, tex.type, out[k]!, node.arguments[k]!, 'gradient', sourceFile, diagnostics)
          )
            return undefined;
        }
      }
      return { op: 'call', type: texel, fn, args: out };
    }
    case 'textureLoad': {
      // Neither target has a texel fetch for a cube: WGSL's `textureLoad` and GLSL's
      // `texelFetch` both stop at 2d, 2d-array and 3d (roadmap 0.4 item 12).
      if (tex.type.dim === 'cube' || tex.type.dim === 'cube-array') {
        pushDiag(
          diagnostics,
          sourceFile,
          node,
          `textureLoad has no cube form on either target: a ${shown} is looked up by ` +
            `direction, so read it with textureSample or textureSampleLevel.`,
          TS_CODES.UNSUPPORTED,
        );
        return undefined;
      }
      const want = isArray ? 4 : 3;
      if (!arity(id, args, want, node, sourceFile, diagnostics)) return undefined;
      if (
        !vecArg(id, tex.type, args[1]!, node.arguments[1]!, 'coordinate', sourceFile, diagnostics)
      )
        return undefined;
      // A 1d texture's coordinate is ONE integer (roadmap 0.4 item 12): a bare `3` lowers to an
      // f32 on this surface, so it is retargeted like a layer. An f32 EXPRESSION is refused by
      // `vecArg` above, in the same sentence this arm used to say it in, where Tint would
      // refuse the generated `textureLoad(t, 3.0, 0u)`.
      if (tex.type.dim === '1d') {
        const c = intArg(
          id,
          args[1]!,
          node.arguments[1]!,
          i32T,
          'coordinate',
          sourceFile,
          diagnostics,
        );
        if (!c) return undefined;
        args = [args[0]!, c, ...args.slice(2)];
      }
      // Both the layer and the mip level are integers here. A bare number lowers to f32, and
      // `textureLoad(t, c, 0.0)` is not valid WGSL — the same bug the EDSL fixed in its own
      // layerArg/levelArg (#1703), fixed the same way and with the same types.
      const out = [...args];
      if (isArray) {
        const layer = intArg(
          id,
          out[2]!,
          node.arguments[2]!,
          i32T,
          'layer',
          sourceFile,
          diagnostics,
        );
        if (!layer) return undefined;
        out[2] = layer;
      }
      const levelIndex = isArray ? 3 : 2;
      const level = intArg(
        id,
        out[levelIndex]!,
        node.arguments[levelIndex]!,
        u32T,
        'mip level',
        sourceFile,
        diagnostics,
      );
      if (!level) return undefined;
      out[levelIndex] = level;
      // An UNSIGNED coordinate takes a wrapping id: GLSL's `texelFetch` has no unsigned
      // overload (measured), so the coordinate is wrapped in the signed constructor of the
      // texture's own width. The signed ids are the ones every existing program already uses.
      const unsignedCoord = out[1]!.type.kind === 'vec' && out[1]!.type.elem === 'u32';
      const fn = isArray
        ? unsignedCoord
          ? 'textureLoadArrayU'
          : 'textureLoadArray'
        : unsignedCoord
          ? tex.type.dim === '3d'
            ? 'textureLoad3dU'
            : 'textureLoadU'
          : id;
      return { op: 'call', type: texel, fn, args: out };
    }
    default:
      return undefined;
  }
}

/** The reads of a multisampled texture, colour or depth (roadmap 0.4 item 13): `textureLoad(t,
 *  coords, sampleIndex)` yields one sample (`vec4<T>`, or `f32` on the depth twin),
 *  `textureNumSamples(t)` the count and `textureDimensions(t)` the size. Nothing else applies —
 *  WGSL §6.6.3: a multisampled texture cannot be used with a sampler — so every sampling,
 *  comparison and gather form is refused with the read that does apply. WGSL-only under the
 *  `msaaTextureLoad` capability the binding derives; GLSL ES 3.00 has no `sampler2DMS`. */
function lowerMultisampledCall(
  id: string,
  tex: Extract<ShaderType, { kind: 'texture' | 'depth-texture' }>,
  args: readonly Expr[],
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const shown = typeKey(tex);
  const depth = tex.kind === 'depth-texture';
  switch (id) {
    case 'textureDimensions':
      return arity(id, args, 1, node, sourceFile, diagnostics)
        ? { op: 'call', type: vec2uT, fn: 'textureDimensionsMs', args: [...args] }
        : undefined;
    case 'textureNumSamples':
      return arity(id, args, 1, node, sourceFile, diagnostics)
        ? { op: 'call', type: u32T, fn: id, args: [...args] }
        : undefined;
    case 'textureLoad': {
      if (!arity(id, args, 3, node, sourceFile, diagnostics)) return undefined;
      if (!vecArg(id, tex, args[1]!, node.arguments[1]!, 'coordinate', sourceFile, diagnostics))
        return undefined;
      // The third argument is a SAMPLE INDEX, an integer like a level, retyped the same way.
      const sample = intArg(
        id,
        args[2]!,
        node.arguments[2]!,
        u32T,
        'sample index',
        sourceFile,
        diagnostics,
      );
      if (!sample) return undefined;
      const type: ShaderType = depth ? f32T : { kind: 'vec', n: 4, elem: tex.elem };
      return {
        op: 'call',
        type,
        fn: depth ? 'textureLoadDepthMs' : 'textureLoadMs',
        args: [args[0]!, args[1]!, sample],
      };
    }
    case 'textureNumLayers':
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `textureNumLayers needs an array texture; a ${shown} has samples, not layers, and ` +
          `textureNumSamples(t) is their count.`,
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    default:
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `${id} cannot read a ${shown}: a multisampled texture cannot be used with a sampler. ` +
          `Read one sample with textureLoad(t, coords, sampleIndex); textureNumSamples(t) is ` +
          `how many there are.`,
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
  }
}

/** The id suffix the array forms take: `Array` for a 2d array, `CubeArray` for a cube array
 *  (roadmap 0.4 item 12), '' for a texture with no layers. Two suffixes rather than one because
 *  the GLSL spellings fold the layer differently (a `vec3(uv, layer)` on a 2d array; nothing at
 *  all on a cube array, which GLSL ES 3.00 has no sampler for), and an id's text must never
 *  depend on the texture it is called on. */
function arraySuffix(dim: string): '' | 'Array' | 'CubeArray' {
  return dim === '2d-array' ? 'Array' : dim === 'cube-array' ? 'CubeArray' : '';
}

/** The gather component folded to a literal: a written number, or a module `const` whose value
 *  is a scalar. WGSL takes any const-expression (wgsl.txt:23916-23925); these two are the ones
 *  this surface can prove. */
function foldConstComponent(arg: Expr, scope: LoweringScope): Expr {
  if (arg.op === 'constref') {
    const binding = scope.resolve(arg.name);
    if (binding?.kind === 'module' && typeof binding.constValue === 'number') {
      return { op: 'lit', type: arg.type, value: binding.constValue };
    }
  }
  return foldNumericLit(arg);
}

/** `textureGather(component, tex, smp, coords[, layer])` on a colour texture,
 *  `textureGather(tex, smp, coords[, layer])` on a depth texture, and
 *  `textureGatherCompare(tex, smp, coords[, layer], ref)` on a depth texture through a comparison
 *  sampler (roadmap 0.4 item 12): the four texels a linear filter would blend at mip level 0, one
 *  channel each, as a `vec4`, in any stage.
 *
 *  WGSL puts the COMPONENT first on a colour texture, because a depth texture has one channel
 *  and takes none; this surface keeps that order, so the texture is found by its kind rather
 *  than its position. The component must be a whole number from 0 to 3 written in the call: WGSL
 *  requires a const-expression there and makes any other value a shader-creation error, so it is
 *  said here, at the argument. Cube textures gather by direction like they sample; a 1d, 3d or
 *  multisampled texture has no gather form. WGSL-only: GLSL ES 3.00 has no gather (ES 3.10), and
 *  the `textureGather` capability fails the module closed on that target. */
function lowerGatherCall(
  id: string,
  args: readonly Expr[],
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const at = args.findIndex((a) => a.type.kind === 'texture' || a.type.kind === 'depth-texture');
  const tex = at === 0 || at === 1 ? args[at]! : undefined;
  if (tex === undefined || (tex.type.kind !== 'texture' && tex.type.kind !== 'depth-texture')) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `${id} takes a texture as its first argument, or as its second after the component on a ` +
        `colour texture: textureGather(0, tex, smp, uv).`,
      TS_CODES.TYPE_MISMATCH,
    );
    return undefined;
  }
  const shown = typeKey(tex.type);
  const compare = id === 'textureGatherCompare';
  if (tex.type.dim === '1d' || tex.type.dim === '3d' || tex.type.dim === '2d-ms') {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `${id} gathers a 2d, 2d-array, cube or cube-array texture; a ${shown} has no gather form ` +
        `on WGSL.`,
      TS_CODES.UNSUPPORTED,
    );
    return undefined;
  }
  if (compare && tex.type.kind !== 'depth-texture') {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `textureGatherCompare compares against a depth texture; "${shown}" is a sampled colour ` +
        `texture with no depth to compare. textureGather reads its channels.`,
      TS_CODES.TYPE_MISMATCH,
    );
    return undefined;
  }
  const out = [...args];
  if (tex.type.kind === 'texture') {
    if (at !== 1) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `textureGather on a ${shown} takes the component first: textureGather(0, tex, smp, ` +
          `coords) reads the red channel of the four texels.`,
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    }
    // WGSL asks for a const-EXPRESSION here, not a literal (wgsl.txt:23916-23925): a module
    // `const C = 1` used as the component is a program Tint accepts (measured), and this
    // refused it for being "not written in the call". A module const's scalar value is on its
    // binding, so folding one is a lookup.
    const lit = foldConstComponent(args[0]!, scope);
    if (
      lit.op !== 'lit' ||
      typeof lit.value !== 'number' ||
      !Number.isInteger(lit.value) ||
      lit.value < 0 ||
      lit.value > 3
    ) {
      pushDiag(
        diagnostics,
        sourceFile,
        node.arguments[0]!,
        `textureGather's component must be a whole number from 0 to 3 known at compile time ` +
          `(0 is red, 3 is alpha): a literal, or a module const. WGSL requires a ` +
          `const-expression there and refuses any other value.`,
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    }
    out[0] =
      typeKey(lit.type) === 'i32' || typeKey(lit.type) === 'u32'
        ? lit
        : { op: 'lit', type: i32T, value: lit.value };
  } else if (at !== 0) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `${id} on a ${shown} takes no component: a depth texture has one channel. Write ` +
        `${id}(tex, smp, coords${compare ? ', ref' : ''}).`,
      TS_CODES.TYPE_MISMATCH,
    );
    return undefined;
  }
  const smp = args[at + 1];
  const wantSmp = compare ? 'sampler-comparison' : 'sampler';
  if (smp === undefined || smp.type.kind !== wantSmp) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      compare
        ? `textureGatherCompare compares through a sampler_comparison; got ` +
            `${smp === undefined ? 'nothing' : typeKey(smp.type)}.`
        : `textureGather reads through an ordinary sampler; got ` +
            `${smp === undefined ? 'nothing' : typeKey(smp.type)}. A sampler_comparison ` +
            `compares instead, with textureGatherCompare.`,
      TS_CODES.TYPE_MISMATCH,
    );
    return undefined;
  }
  const suffix = arraySuffix(tex.type.dim);
  const isArray = suffix !== '';
  const want = at + 3 + (isArray ? 1 : 0) + (compare ? 1 : 0);
  if (!arity(id, args, want, node, sourceFile, diagnostics)) return undefined;
  if (
    !vecArg(
      id,
      tex.type,
      args[at + 2]!,
      node.arguments[at + 2]!,
      'coordinate',
      sourceFile,
      diagnostics,
    )
  )
    return undefined;
  if (isArray) {
    const k = at + 3;
    const layer = intArg(id, out[k]!, node.arguments[k]!, i32T, 'layer', sourceFile, diagnostics);
    if (!layer) return undefined;
    out[k] = layer;
  }
  // The reference depth of a gather-compare is an `f32`, like `textureSampleCompare`'s.
  if (compare) {
    const k = want - 1;
    const ref = floatArg(id, out[k]!, node.arguments[k]!, 'depth_ref', sourceFile, diagnostics);
    if (!ref) return undefined;
    out[k] = ref;
  }
  // One id per WGSL argument structure; a cube gathers by direction with the 2d id, since the
  // coordinate's width rides on the type, and the depth forms differ only in taking no component.
  const fn =
    tex.type.kind === 'texture'
      ? isArray
        ? 'textureGatherArray'
        : 'textureGather'
      : compare
        ? isArray
          ? 'textureGatherCompareArray'
          : 'textureGatherCompare'
        : isArray
          ? 'textureGatherDepthArray'
          : 'textureGatherDepth';
  const type: ShaderType =
    tex.type.kind === 'texture' ? { kind: 'vec', n: 4, elem: tex.type.elem } : vec4fT;
  return { op: 'call', type, fn, args: out };
}

/** The element a texture argument carries, by the one name the messages use: the scalar of a
 *  scalar, the element of a vector, and `f64` for both emulated-double kinds, which no texture
 *  builtin has an overload for on either target. */
function elemNameOf(t: ShaderType): string {
  return t.kind === 'scalar'
    ? t.scalar
    : t.kind === 'vec'
      ? t.elem
      : t.kind === 'f64' || t.kind === 'vec64'
        ? 'f64'
        : typeKey(t);
}

/** The coordinate a texture is addressed by has the width its `dim` decides — a `vec2` on a 2d
 *  texture (and on the array, whose layer is a separate argument), a `vec3` DIRECTION on a cube
 *  and a `vec3` on a 3d texture — and the gradients of `textureSampleGrad` have the same width
 *  (roadmap 0.4 item 12). Both targets refuse the wrong width ("no matching call" on Tint, "no
 *  matching overloaded function" on a WebGL2 driver), so this says it first, at the argument.
 *
 *  The ELEMENT is checked here too (#145). It used to be left to `tsc` through the ambient lib,
 *  and the compiler is not always reached through an editor: `textureSample(t, s, vec2i(0, 0))`
 *  emitted `textureSample(t, s, vec2<i32>(0, 0))` and `textureLoad(t, vec2(0., 0.), 0)` emitted
 *  a float coordinate, both of which Tint refuses ("no matching call"). A sampled read takes a
 *  normalised `f32` coordinate (wgsl.txt:24435 and the `textureSample*` overloads); a texel
 *  fetch — `textureLoad` and `textureStore`, sampled or storage — takes a whole texel, "C is
 *  i32, or u32" (wgsl.txt:24129, 25342). A bare numeric LITERAL is exempt: it lowers to an f32
 *  on this surface and the retarget below (`intArg`) gives it the type the call needs. */
function vecArg(
  id: string,
  tex: Extract<ShaderType, { kind: 'texture' | 'depth-texture' | 'storage-texture' }>,
  arg: Expr,
  node: ts.Expression,
  what: 'coordinate' | 'gradient',
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): boolean {
  const want =
    tex.dim === '1d'
      ? 1
      : tex.dim === '2d' || tex.dim === '2d-array' || tex.dim === '2d-ms'
        ? 2
        : 3;
  // A 1d texture (roadmap 0.4 item 12) is addressed by ONE number: an f32 to sample, an integer
  // to fetch. An emulated double counts as the width it has — `f64` is a scalar and `vec64` a
  // vector here — so a `vec2f64` coordinate on a 2d texture is answered by the ELEMENT check
  // below, which is what is wrong with it, rather than by a width message about a width that
  // is right.
  const n =
    arg.type.kind === 'vec' || arg.type.kind === 'vec64'
      ? arg.type.n
      : arg.type.kind === 'scalar' || arg.type.kind === 'f64'
        ? 1
        : 0;
  if (n !== want) {
    const shape =
      want === 1
        ? `single ${id === 'textureLoad' ? 'integer' : 'f32'} ${what}`
        : (tex.dim === 'cube' || tex.dim === 'cube-array') && what === 'coordinate'
          ? 'vec3 direction'
          : `vec${want} ${what}`;
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `${id} on a ${typeKey(tex)} takes a ${shape}; got ${typeKey(arg.type)}.`,
      TS_CODES.TEXTURE_ARGUMENT,
    );
    return false;
  }
  // A texel fetch is by whole texel, every other read by normalised coordinate; a gradient is
  // a rate of change of the latter, so it is float whatever the call.
  const wantInt = what === 'coordinate' && (id === 'textureLoad' || id === 'textureStore');
  const elem = elemNameOf(arg.type);
  const ok = wantInt ? elem === 'i32' || elem === 'u32' : elem === 'f32';
  // A bare number in an INTEGER slot is retargeted, not refused: `textureLoad(t, 3, 0)` on a 1d
  // texture is the form the surface spells, and `intArg` below turns the f32 lit into the i32
  // the call takes. The exemption is only sound where that retarget follows. It used to test
  // the FOLDED value and apply to the float slots too, where nothing retargets: `u32(2)` folded
  // to a lit, skipped the check, and `textureSample(ramp, smp, u32(2))` emitted `2u` on a 1d
  // texture — "no matching call" on Tint, with no diagnostic here. (`i32(2)` survived only
  // because the writer spells an i32 lit bare, which WGSL reads as abstract-int.)
  if (ok || (wantInt && isBareNumber(node))) return true;
  pushDiag(
    diagnostics,
    sourceFile,
    node,
    wantInt
      ? `${id} on a ${typeKey(tex)} takes an integer ${what}, an i32 or a u32; got ` +
          `${typeKey(arg.type)}.`
      : `${id} on a ${typeKey(tex)} takes an f32 ${what}; got ${typeKey(arg.type)}.`,
    TS_CODES.TEXTURE_ARGUMENT,
  );
  return false;
}

/** Whether the author wrote a bare number here: a numeric literal, or one behind a unary sign.
 *
 *  This is the shape the retargets below act on, and it is asked of the SOURCE rather than of
 *  the folded value because `foldNumericLit` also folds an explicit cast: `i32(0)` folds to the
 *  literal 0, so retargeting on the folded value silently deleted a cast the author wrote and
 *  emitted `0.0` for `textureSampleLevel(t, s, uv, i32(0))` — while refusing the same mistake
 *  spelled `const l: i32 = 0`. A bare `0` has no type of its own on this surface and is the
 *  call's to type; `i32(0)` says what it is, and is answered like any other i32. */
function isBareNumber(node: ts.Expression): boolean {
  const inner = ts.isPrefixUnaryExpression(node) ? node.operand : node;
  return ts.isNumericLiteral(inner);
}

/** The source the author wrote for an argument, for the "Write f32(l)." half of a refusal.
 *  Normalised to one line and cut short, so a long expression cannot smear the message across
 *  the terminal; the span already points at the argument itself. */
function argText(node: ts.Expression, sourceFile: ts.SourceFile): string {
  const text = node.getText(sourceFile).replace(/\s+/g, ' ').trim();
  return text.length > 24 ? `${text.slice(0, 24).trimEnd()}…` : text;
}

/** A `level`, `bias` or `depth_ref`: the texture arguments WGSL types `f32` (wgsl.txt:25081,
 *  24615, 24734), where a layer and a mip level of a fetch are integers.
 *
 *  `intArg` below has always retargeted a whole-number literal, so `textureSampleLevel(t, s, uv,
 *  0)` was never the bug. The bug was a VARIABLE: `const l: i32 = 2` reached the backend
 *  untouched and emitted `textureSampleLevel(t, s, p.xy, 2)`, which Tint refuses. An integer
 *  literal is still retargeted here; anything else has to be an f32 already.
 *
 *  That covers the EMULATED DOUBLE too, which #151 found separately: an `f64` is a pair of f32
 *  words after the fp64 pass and no `textureSampleLevel` overload takes one on either target,
 *  so it used to be accepted here and refused by that pass as a span-less SD0041 at emit, after
 *  the call the author wrote was gone. It is not an `f32`, so it falls to the refusal below and
 *  is named at the argument with the narrow that makes it legal. */
function floatArg(
  id: string,
  arg: Expr,
  node: ts.Expression,
  what: string,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const lit = foldNumericLit(arg);
  // A literal already typed f32 is returned AS WRITTEN, not as the folded lit: folding a
  // negated literal would rewrite `-1.0` and move the emit for no reason.
  if (isBareNumber(node) && lit.op === 'lit' && typeof lit.value === 'number')
    return typeKey(lit.type) === 'f32' ? arg : { op: 'lit', type: f32T, value: lit.value };
  if (typeKey(arg.type) === 'f32') return arg;
  pushDiag(
    diagnostics,
    sourceFile,
    node,
    `${id} ${what} must be an f32; got ${typeKey(arg.type)}. Write f32(${argText(node, sourceFile)}).`,
    TS_CODES.TEXTURE_ARGUMENT,
  );
  return undefined;
}

/** A layer or mip-level argument, retyped when it is a bare whole number and REPORTED when it
 *  is a number that cannot be one.
 *
 *  A number written without a decimal point lowers to an f32 on this surface, and WGSL's
 *  `textureLoad` and array sampling take INTEGERS — `textureLoad(t, c, 0.0)` is rejected. An
 *  argument that is not a literal at all is returned as it is, and one that is already an
 *  integer likewise.
 *
 *  A fractional or negative literal is the case this used to wave through, on the claim that a
 *  check downstream would report it. There is none: `textureLoad(t, c, 2.5)`,
 *  `textureLoad(t, c, -1)` and `textureSample(atlas, smp, uv, 1.5)` emitted with zero
 *  diagnostics, Tint refused the WGSL, and GLSL silently rounded — the exact divergence the
 *  EDSL's own layerArg/levelArg raise SD0015 for. Reported here, at the argument, with the
 *  divergence named.
 *
 *  A non-literal is no longer waved through either (#145): `const l: f32 = 1.` as a layer
 *  emitted `textureSampleLevel(t, s, p.xy, 1.0, 0.0)` and `textureLoad(t, c, si)` with an f32
 *  `si` emitted a float sample index, both refused by Tint ("no matching call") and both
 *  silently rounded by GLSL ES 3.00. */
function intArg(
  id: string,
  arg: Expr,
  node: ts.Expression,
  want: ShaderType,
  what: string,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  // An emulated double is not a literal, so it used to sail through every check below and
  // reach emit as a span-less SD0041. It needs its own message: this slot wants an INTEGER,
  // so `f32(x)` alone is not the fix — the pass has no f64 → i32 body either, which makes
  // the narrow a two-step one (#151).
  if (arg.type.kind === 'f64' || arg.type.kind === 'vec64') {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `A texture ${what} must be an i32 or u32; got ${typeKey(arg.type)}. An emulated double ` +
        `narrows to f32 first, so write i32(f32(x)).`,
      TS_CODES.TYPE_MISMATCH,
    );
    return undefined;
  }
  // A NEGATED literal is a unop, not a lit, and reached the backend as `-(1.0)`. Folded first
  // so the range check below sees the number the author wrote.
  const lit = foldNumericLit(arg);
  if (!isBareNumber(node) || lit.op !== 'lit' || typeof lit.value !== 'number') {
    const key = typeKey(arg.type);
    if (key === 'i32' || key === 'u32') return arg;
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `${id} ${what} must be an i32 or a u32; got ${key}. ` +
        `Write ${typeKey(want)}(${argText(node, sourceFile)}).`,
      TS_CODES.TEXTURE_ARGUMENT,
    );
    return undefined;
  }
  const v = lit.value;
  // Negative is refused whatever the target type. A layer is typed i32 because that is the
  // overload WGSL's array sampling takes, not because -1 means anything: both it and a mip
  // level are indices into memory that starts at 0.
  if (!Number.isInteger(v) || v < 0) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `A texture ${what} must be a whole number of 0 or more, got ${String(v)}. ` +
        `WGSL rejects a fractional or negative one and GLSL ES 3.00 silently rounds it, ` +
        `so the two targets would disagree.`,
      TS_CODES.TEXTURE_ARGUMENT,
    );
    return undefined;
  }
  if (typeKey(lit.type) === 'i32' || typeKey(lit.type) === 'u32') return lit;
  return { op: 'lit', type: want, value: v };
}

/** `textureDimensions(t)` or `textureDimensions(t, level)` (#147, wgsl.txt:23649). The level
 *  is optional and is an INTEGER: WGSL types it `i32` or `u32`, and the GLSL column already
 *  spells the 2-argument form as `textureSize(t, int(level))`, so nothing new is needed on
 *  either target — the front end simply refused the second argument as an arity error.
 *
 *  Measured accepted on Tint (`textureDimensions(t, 0)` and with a `u32` variable) and on a
 *  WebGL2 driver (`uvec2(textureSize(t, int(0)))`, and with a non-constant level).
 *
 *  Returns the arguments to emit, or undefined when it has reported. */
function dimsArgs(
  id: string,
  args: readonly Expr[],
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): Expr[] | undefined {
  if (args.length === 1) return [...args];
  if (args.length !== 2) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `${id} on a ${typeKey(args[0]!.type)} expects 1 argument(s), or 2 with an explicit mip ` +
        `level, got ${args.length}.`,
      TS_CODES.ARITY_MISMATCH,
    );
    return undefined;
  }
  const level = intArg(
    id,
    args[1]!,
    node.arguments[1]!,
    u32T,
    'mip level',
    sourceFile,
    diagnostics,
  );
  return level ? [args[0]!, level] : undefined;
}

/** One arity check, with the message naming what the texture's own shape requires — an array
 *  texture takes the extra layer argument, so the expected count is not a property of the
 *  function name alone. */
function arity(
  id: string,
  args: readonly Expr[],
  want: number,
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): boolean {
  if (args.length === want) return true;
  pushDiag(
    diagnostics,
    sourceFile,
    node,
    `${id} on a ${typeKey(args[0]!.type)} expects ${want} argument(s), got ${args.length}.`,
    TS_CODES.ARITY_MISMATCH,
  );
  return false;
}

function vectorCtorType(n: 2 | 3 | 4, elem: VecCtorElem): ShaderType {
  if (elem === 'f64') return { kind: 'vec64', n };
  return { kind: 'vec', n, elem };
}

/** True for the one argument shape {@link lowerCall} converts rather than composes: a native
 *  vector of the constructor's own size whose element kind differs. Both sides must be native
 *  (f32 / i32 / u32) — an emulated-double vector is not converted here, since a vec64 is a
 *  pair of f32 lanes the fp64 pass assembles, not a component list to reinterpret. */
function isConvertibleVector(t: ShaderType, ctor: { n: 2 | 3 | 4; elem: VecCtorElem }): boolean {
  if (ctor.elem === 'f64') return false;
  return t.kind === 'vec' && t.n === ctor.n && t.elem !== ctor.elem;
}

function isVectorCtorScalar(t: ShaderType, elem: VecCtorElem): boolean {
  if (elem === 'f64') return t.kind === 'f64';
  return t.kind === 'scalar' && t.scalar === elem;
}

function isVectorCtorArg(t: ShaderType, elem: VecCtorElem): boolean {
  if (elem === 'f64') return t.kind === 'f64' || t.kind === 'vec64';
  return isVectorCtorScalar(t, elem) || (t.kind === 'vec' && t.elem === elem);
}

function flattenF64VectorArgs(args: readonly Expr[]): Expr[] {
  const flattened: Expr[] = [];
  for (const arg of args) {
    if (arg.type.kind !== 'vec64') {
      flattened.push(arg);
      continue;
    }
    for (const field of 'xyzw'.slice(0, arg.type.n)) {
      flattened.push({ op: 'member', type: { kind: 'f64' }, base: arg, field });
    }
  }
  return flattened;
}

function vectorComponentCount(args: readonly Expr[]): number {
  return args.reduce((count, arg) => {
    if (arg.type.kind === 'vec' || arg.type.kind === 'vec64') return count + arg.type.n;
    return count + 1;
  }, 0);
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
