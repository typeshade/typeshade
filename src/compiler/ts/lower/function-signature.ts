// Function signatures and entry IO, read before bodies and checked again after inferred results.
import ts from 'typescript';
import type {
  Expr,
  FuncDecl,
  OverrideDecl,
  StructDecl,
  WorkgroupShape,
} from '../../../core/ir/nodes.js';
import type { SourceSpan } from '../../../core/ir/span.js';
import type { ShaderType } from '../../../core/ir/types.js';
import { structT, voidT } from '../../../core/ir/types.js';
import { toWorkgroupShape, workgroupSizeAttr } from '../../../core/ir/workgroup.js';
import { kernelWorkgroups } from '../../../core/kernel-workgroup.js';
import { hasNoWrittenResult } from '../abstract-const.js';
import { attributeDecoratorsOf, isTypeDecorator } from '../attribute-types.js';
import {
  checkAttributeName,
  checkBuiltinName,
  checkBuiltinStage,
  checkBuiltinType,
  checkLocationType,
  interpolateDecoratorArg,
  readIoAttributes,
  type BuiltinStage,
} from '../builtin-check.js';
import { TS_CODES, type TsCode } from '../codes.js';
import { authorTypeText } from '../context.js';
import { makeDiagnostic } from '../diagnostic.js';
import { optionalDeclaredType, refuseOptionalAt, logicalTypeKey as typeKey } from '../optional.js';
import type { TsCompilerDiagnostic } from '../source-file.js';
import { spanOf } from '../span.js';
import { stageCallOfDeclaration } from '../stage-call.js';
import { hasRefusedIoAttribute, type CollectedStruct } from '../structs.js';
import { mapTsTypeToShaderType, withCollections } from '../type-map.js';
import { refuseAtomicDeclaration } from './atomics.js';
import { functionTypeOf } from './function-types.js';
import { recordParamDefaults } from './param-defaults.js';
import { markOutParam, qualifiersOf } from './references.js';
import { refuseRuntimeArraySignature } from './runtime-array.js';

/** The declarations a body is lowered from: a top-level function, a class method or a class
 *  constructor (#86). All three carry `parameters`, an optional `type` and a `body`. */
export type FunctionNode =
  | ts.FunctionDeclaration
  | ts.MethodDeclaration
  /** A getter or a setter, which is a method of its class once lowered (Rule 8.11). */
  | ts.AccessorDeclaration
  | ts.ConstructorDeclaration
  /** A local function: `const f = (x: f32): f32 => ...` and the `function (x) { ... }` spelling
   *  of it (roadmap 0.3 item T7, #92). Both carry `parameters`, an optional `type` and a
   *  `body`, and an arrow's body may be an expression rather than a block. */
  | ts.ArrowFunction
  | ts.FunctionExpression;

/** The parameters of a signature, each with its type, `@builtin` and `@location`, checked
 *  against `stage` when the function is an entry. Returns `undefined` after the first
 *  parameter it cannot accept, having said why. `owner` names the function in messages;
 *  `forbidSelf` refuses a parameter named `self_`, the name a method's object takes in the
 *  emitted function (#86). */
export function parseParams(
  parameters: readonly ts.ParameterDeclaration[],
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  structs: readonly CollectedStruct[],
  stage: FuncDecl['stage'] | undefined,
  opts: {
    readonly owner?: string;
    readonly forbidSelf?: boolean;
    readonly fnName?: string;
    /** An exported function that is not an entry, whose array parameter with no size makes it
     *  a kernel function (Rule 8.22) rather than a refusal. */
    readonly mayBeKernel?: boolean;
    /** A function declared at the top of the file or of a namespace, the one kind that takes a
     *  qualified parameter, `@inout` or `@out` (Rule 8.25). Every other caller leaves it unset, and a qualified
     *  parameter there is refused. */
    readonly references?: boolean;
  } = {},
): FuncDecl['params'][number][] | undefined {
  const params: FuncDecl['params'][number][] = [];
  // `@location` slot → the parameter already holding it, for the collision rule below.
  const paramLocations = new Map<number, string>();
  const fnName = opts.fnName ?? opts.owner ?? 'this entry';
  // A function that is not an entry has no IO: WGSL refuses `@builtin` and `@location` on its
  // parameter (Tint: "not valid for non-entry point function parameters"), so each is refused
  // at the decorator and not read.
  const site = stage ? 'a parameter' : 'a parameter of a function that is not an entry';
  for (const p of parameters) {
    let unknownAttribute = false;
    for (const d of decoratorsOf(p))
      if (checkAttributeName(diagnostics, sourceFile, d, site)) unknownAttribute = true;
    if (!ts.isIdentifier(p.name)) {
      pushDiag(
        diagnostics,
        sourceFile,
        p,
        'Parameter must be a simple identifier.',
        TS_CODES.FUNCTION_SHAPE,
      );
      return undefined;
    }
    // An optional parameter `x?: T` is `x: T | undefined`, and a call may omit it (Rule 7.10,
    // change 0093, decision D5). An entry's parameters come from the pipeline, so none is
    // optional; a kernel function's come from the host, which `parseSignature` refuses once
    // it knows the function is one. TypeScript's own grammar applies through Rule 12.7: one
    // parameter has one filler (TS1015), and a required parameter follows no optional one
    // (TS1016), each said here in the compiler's sentence since no checker runs.
    if (p.questionToken) {
      if (stage) {
        pushDiag(
          diagnostics,
          sourceFile,
          p.questionToken,
          `An entry's parameters come from the pipeline, not from a call, so "${p.name.text}" ` +
            `cannot be optional. Write "${p.name.text}: T".`,
          TS_CODES.FUNCTION_SHAPE,
        );
        return undefined;
      }
      if (p.initializer !== undefined) {
        pushDiag(
          diagnostics,
          sourceFile,
          p,
          `"${p.name.text}?: T = d" gives "${p.name.text}" two fillers: a parameter is ` +
            `optional, or has a default, not both (TypeScript's TS1015). Write ` +
            `"${p.name.text}?: T" or "${p.name.text}: T = d".`,
          TS_CODES.FUNCTION_SHAPE,
        );
        return undefined;
      }
    } else if (p.initializer === undefined) {
      const before = parameters.find(
        (q) => q.pos < p.pos && q.questionToken !== undefined && ts.isIdentifier(q.name),
      );
      if (before !== undefined && ts.isIdentifier(before.name)) {
        pushDiag(
          diagnostics,
          sourceFile,
          p,
          `"${p.name.text}" is required and follows the optional parameter ` +
            `"${before.name.text}": a required parameter cannot follow an optional one ` +
            `(TypeScript's TS1016). Write "${p.name.text}?: T", or move it before ` +
            `"${before.name.text}".`,
          TS_CODES.FUNCTION_SHAPE,
        );
        return undefined;
      }
    }
    if (p.dotDotDotToken) {
      pushDiag(
        diagnostics,
        sourceFile,
        p,
        `Rest parameter "${p.name.text}" is not supported.`,
        TS_CODES.FUNCTION_SHAPE,
      );
      return undefined;
    }
    // A default is filled in where the function is called (roadmap 0.3 item T7, #92), so the
    // two shapes that have nothing to fill in from are refused here rather than at a call.
    if (p.initializer !== undefined) {
      if (stage) {
        pushDiag(
          diagnostics,
          sourceFile,
          p.initializer,
          `An entry's parameters come from the pipeline, not from a call, so "${p.name.text}" ` +
            `cannot have a default.`,
          TS_CODES.FUNCTION_SHAPE,
        );
        return undefined;
      }
      if (refuseDefaultReadingAParameter(p, parameters, sourceFile, diagnostics)) return undefined;
    }
    // `self_` only: `self_in` was the second name a method that changed its object used, for
    // the copy it worked on, and there is no copy now — the object is written through.
    if (opts.forbidSelf && p.name.text === 'self_') {
      pushDiag(
        diagnostics,
        sourceFile,
        p,
        `"${p.name.text}" is a name ${opts.owner ?? 'the method'} gives its object in the ` +
          `emitted function; rename the parameter.`,
        TS_CODES.CLASS_MEMBER,
      );
      return undefined;
    }
    // A function, a method, a constructor and a local function that take a function are copied
    // for each function a call hands them (Rule 8.18), and skip that parameter before here. What
    // is left is a setter's value, which an assignment gives it: no call hands it a function.
    if (functionTypeOf(p.type) !== undefined) {
      pushDiag(
        diagnostics,
        sourceFile,
        p.type ?? p,
        `"${p.name.text}" takes a function, and ${opts.owner === undefined ? 'this' : `"${opts.owner}"`} ` +
          `is a setter, whose value an assignment gives it: a shader has no function value to ` +
          `assign. Take the function in a method instead (Rule 8.18).`,
        TS_CODES.FUNCTION_SHAPE,
      );
      return undefined;
    }
    // The annotation is read first so that a missing one, which has no span of its own to
    // point at, is the parameter's complaint and everything else is the annotation's. Before,
    // both were pushed: a parameter written `x: f32 | vec3` said why the union names no type
    // AND that the parameter "requires a TypeShade type annotation", which it has (T10, #92).
    if (p.type === undefined) {
      pushDiag(
        diagnostics,
        sourceFile,
        p,
        `Parameter "${p.name.text}" requires a TypeShade type annotation.`,
        TS_CODES.UNKNOWN_TYPE,
      );
      return undefined;
    }
    // `@inout p: T` and `@out p: T` name a place of the caller's, which the IR spells as a
    // parameter the callee writes through, as a method that changes its object takes it
    // (Rule 8.25).
    const qualifiers = qualifiersOf(p);
    if (qualifiers.length > 0) {
      const refused = refuseQualifiedParameter(p, qualifiers, stage, opts);
      if (refused !== undefined) {
        // The type form's own refusal says it (`TS8028`, change 0137; Rule 12.4).
        if (!refused.typeForm)
          pushDiag(diagnostics, sourceFile, refused.at, refused.message, TS_CODES.REFERENCE);
        return undefined;
      }
    }
    const qualifier = qualifiers[0]?.name;
    const referenced = qualifier as 'inout' | 'out' | undefined;
    const written = p.type;
    // A Map or a Set is a kernel function's parameter (change 0080), taken as it is written.
    const pMapped =
      opts.mayBeKernel === true && referenced === undefined
        ? withCollections(() => mapTsTypeToShaderType(written, sourceFile, diagnostics))
        : mapTsTypeToShaderType(written, sourceFile, diagnostics);
    if (refuseAtomicDeclaration(pMapped, written, sourceFile, diagnostics, 'a parameter'))
      return undefined;
    // `x?: T` is `x: T | undefined` (change 0093).
    const pType = optionalDeclaredType(
      pMapped,
      p.questionToken,
      `parameter "${p.name.text}?"`,
      sourceFile,
      diagnostics,
      authorTypeText,
    );
    if (!pType) return undefined;
    // An entry's input has no interstage form for the flag, and a kernel function's parameter
    // comes from the host (Rule 7.10, changes 0088 and 0093): neither holds an optional, in a
    // struct's field or an array's element either.
    const structOf = (n: string): StructDecl | undefined =>
      structs.find((c) => c.decl.name === n)?.decl;
    if (
      stage !== undefined &&
      refuseOptionalAt(
        pType,
        written ?? p,
        "an entry point's parameter",
        sourceFile,
        diagnostics,
        authorTypeText,
        structOf,
      )
    )
      return undefined;
    if (
      opts.mayBeKernel === true &&
      (pType.kind === 'collection' || (pType.kind === 'array' && pType.size === undefined)) &&
      refuseOptionalAt(
        pType.kind === 'collection' ? pType.value : pType,
        written ?? p,
        "a kernel function's parameter",
        sourceFile,
        diagnostics,
        authorTypeText,
        structOf,
      )
    )
      return undefined;
    if (referenced !== undefined && (pType.kind === 'texture' || pType.kind === 'sampler')) {
      // The type form's own refusal says it (`TS8028`, change 0137; Rule 12.4).
      if (!isTypeDecorator(qualifiers[0]!.node))
        pushDiag(
          diagnostics,
          sourceFile,
          p.type,
          `"${p.name.text}" is @${referenced}, and a ${pType.kind} is a handle to a resource, ` +
            `not a place a function writes. Declare it "${p.name.text}: ${authorTypeText(pType)}" to take it ` +
            `by value.`,
          TS_CODES.REFERENCE,
        );
      return undefined;
    }
    // An array with no size is a kernel function's parameter, the caller's storage (Rule 8.23),
    // and nothing else's (Rule 12.6). A struct that holds one is not. It carries no qualifier, or
    // `@inout` or `@out` (change 0138, Amendment A15); an unqualified one is a value, and
    // `value-array-write.ts` refuses a write to it that no `return` carries back.
    const kernelArray =
      opts.mayBeKernel === true && pType.kind === 'array' && pType.size === undefined;
    if (
      !kernelArray &&
      refuseRuntimeArraySignature(
        pType,
        { kind: 'parameter', name: p.name.text },
        p.type,
        sourceFile,
        diagnostics,
        (n) => structs.find((c) => c.decl.name === n)?.decl,
      )
    )
      return undefined;
    const io = stage ? readIoAttributes(diagnostics, sourceFile, decoratorsOf(p)) : undefined;
    // Validate independent option arguments even when the IO argument itself is malformed.
    const interpolateAttr = stage
      ? interpolateDecoratorArg(diagnostics, sourceFile, decoratorsOf(p))
      : undefined;
    if (io?.invalid) return undefined;
    const builtinArg = io?.builtin;
    let builtin: string | undefined;
    if (builtinArg) {
      const validName = checkBuiltinName(
        diagnostics,
        sourceFile,
        builtinArg.argNode,
        builtinArg.name,
      );
      if (validName) {
        builtin = builtinArg.name;
        checkBuiltinType(diagnostics, sourceFile, builtinArg.argNode, builtinArg.name, pType);
        if (stage) {
          checkBuiltinStage(
            diagnostics,
            sourceFile,
            builtinArg.argNode,
            builtinArg.name,
            stage,
            'input',
          );
        }
      }
    }
    if (stage && pType.kind === 'struct') {
      checkStructBuiltinFields(diagnostics, sourceFile, p, pType.name, structs, stage, 'input');
    }
    const location = io?.location;
    // A compute entry has no user-defined input (WGSL), so a parameter that is no built-in
    // value and no struct of them is refused here: `c(x: u32)` was emitted as `fn c(x: u32)`,
    // which Tint refuses, with nothing said (Rule 6.6, change 0135). One written at a
    // `location<…>` is refused below, in the sentence that names the location.
    if (stage === 'compute' && builtinArg === undefined && location === undefined) {
      if (pType.kind !== 'struct') {
        pushDiag(
          diagnostics,
          sourceFile,
          p,
          `"${p.name.text}" is a user-defined input of a compute entry, which has no user IO: a ` +
            `compute shader reads its work from resources and the builtin<…> invocation ids.`,
          TS_CODES.STRUCT_FIELD_MISSING_ATTR,
        );
      }
    }
    // An emulated double on the entry's IO boundary (#151 F64-09). A FRAGMENT @location input
    // is interpolated; a VERTEX one is a buffer read, which carries a scalar f64's pair in one
    // slot but cannot carry a vec64's two.
    if (
      stage !== undefined &&
      location !== undefined &&
      refuseF64EntryIo(
        pType,
        `Parameter "${p.name.text}"`,
        stage === 'vertex' ? 'attribute' : 'varying',
        p,
        sourceFile,
        diagnostics,
      )
    ) {
      return undefined;
    }
    // `@interpolate` on a BARE parameter, the spelling a fragment entry uses when it takes one
    // varying and declares no struct. It was read on a struct field and nowhere else, so the
    // attribute an author wrote here was dropped with no diagnostic and reached neither
    // target (§53). The whole argument list is kept, as the struct path keeps it: the GLSL
    // writer needs the sampling as well as the type.
    if (interpolateAttr !== undefined && location === undefined) {
      pushDiag(
        diagnostics,
        sourceFile,
        p,
        `The interpolate option belongs on a location<…> parameter: it says how a VARYING is ` +
          `interpolated, and a builtin<…> carries its own rule.`,
        TS_CODES.ATTRIBUTE_NAME,
      );
    }
    const interpolate =
      interpolateAttr !== undefined && location !== undefined
        ? interpolateAttr.slice('@interpolate('.length, -1)
        : undefined;
    if (location !== undefined) {
      // WGSL: a compute entry point has no user-defined IO at all — its inputs are the
      // builtin invocation ids and its resources. `@location(0) x: f32` on one was emitted
      // and refused at the driver (§53).
      if (stage === 'compute') {
        pushDiag(
          diagnostics,
          sourceFile,
          p,
          `"${p.name.text}" is at a location<…> on a compute entry, which has no user IO: a ` +
            `compute shader reads its work from resources and the builtin<…> invocation ids.`,
          TS_CODES.STRUCT_FIELD_MISSING_ATTR,
        );
      }
      checkLocationType(diagnostics, sourceFile, p, p.name.text, pType, interpolate);
      // The slot rule the struct path has, for the parameter list: two parameters at one
      // `@location` is `'@location(0)' appears multiple times` on Tint, and was emitted here
      // with no diagnostic.
      const prior = paramLocations.get(location);
      if (prior !== undefined) {
        pushDiag(
          diagnostics,
          sourceFile,
          p,
          `"${fnName}" puts "${prior}" and "${p.name.text}" both at location<` +
            `${String(location)}, …>; each slot carries one value.`,
          TS_CODES.STRUCT_FIELD,
        );
      } else paramLocations.set(location, p.name.text);
    }
    const param: FuncDecl['params'][number] = {
      name: p.name.text,
      type: pType,
      ...(builtin ? { builtin } : {}),
      ...(location !== undefined ? { location } : {}),
      ...(interpolate !== undefined
        ? { interpolate, attr: `@location(${String(location)}) ${interpolateAttr!}` }
        : {}),
      // The caller's storage, passed by reference (Rule 8.23): no copy is made on the way in. An
      // `@inout` or `@out` parameter is the caller's place the same way (Rule 8.25); the IR
      // keeps one mode for both, since `@out`'s definite writes make them equal.
      ...(kernelArray || referenced !== undefined ? { mode: 'inout' as const } : {}),
    };
    if (referenced === 'out') markOutParam(param);
    // An attribute the front end refused, an unknown built-in name or an unknown attribute,
    // leaves the parameter with none. That is a consequence of the refusal and no second
    // mistake, so the parameter takes no location (Rule 12.4, `entry-locations.ts`).
    if (builtin === undefined && location === undefined && (builtinArg || unknownAttribute))
      refusedIoParams.add(param);
    params.push(param);
  }
  return params;
}

const refusedIoParams = new WeakSet<FuncDecl['params'][number]>();

/** Whether the front end refused the entry I/O attribute `param` wrote, so that the parameter
 *  carries none: the refusal is the one diagnostic, and nothing gives it a location. */
export function hasRefusedIoParam(param: FuncDecl['params'][number]): boolean {
  return refusedIoParams.has(param);
}

/** Why `p`, which carries `qualifiers`, cannot take them here, or `undefined` where it can: a
 *  qualifier belongs to a parameter of a function declared at the top of the file or of a
 *  namespace (Rule 8.25), one to a parameter, and a place takes no default. `typeForm` says that
 *  a qualifier is the refused type form `inout<T>` or `out<T>`, whose own `TS8028` is then the
 *  one diagnostic (change 0137; Rule 12.4). */
export function refuseQualifiedParameter(
  p: ts.ParameterDeclaration,
  qualifiers: readonly { name: string; node: ts.Decorator }[],
  stage: FuncDecl['stage'] | undefined,
  opts: { readonly owner?: string; readonly forbidSelf?: boolean; readonly references?: boolean },
): { at: ts.Node; message: string; typeForm: boolean } | undefined {
  const name = (p.name as ts.Identifier).text;
  const first = qualifiers[0]!;
  const typeForm = qualifiers.some((q) => isTypeDecorator(q.node));
  if (qualifiers.length > 1) {
    return {
      at: qualifiers[1]!.node,
      typeForm,
      message:
        `"${name}" carries ${qualifiers.map((q) => `@${q.name}`).join(' and ')}, and a ` +
        `parameter takes one qualifier. Keep the one that says what the function does with it.`,
    };
  }
  if (opts.references !== true || stage !== undefined) {
    // A class's members pass `forbidSelf`; a local function names itself as its owner too.
    const site =
      stage !== undefined
        ? 'an entry, whose parameters the pipeline supplies,'
        : opts.owner !== undefined && opts.forbidSelf !== undefined
          ? `"${opts.owner}", a member of a class,`
          : opts.owner !== undefined
            ? `"${opts.owner}", a local function,`
            : 'a generic function, whose instance is made from its arguments,';
    return {
      at: first.node,
      typeForm,
      message:
        `"${name}" is @${first.name}, and ${site} takes its parameters by value. A ` +
        `parameter that names the caller's place belongs to a function declared at the top ` +
        `of the file or of a namespace (Rule 8.25): move the code that changes the caller's ` +
        `value into one, or take the value and return the result.`,
    };
  }
  if (p.initializer !== undefined) {
    return {
      at: p.initializer,
      typeForm,
      message:
        `"${name}" is @${first.name}, which names the place a call hands over; a default is a ` +
        `value and names no place. Remove the default, and pass a variable at every call.`,
    };
  }
  return undefined;
}

/** Refuse a default that reads one of the function's own parameters, or `this`, and say why
 *  (roadmap 0.3 item T7, #92). A default is filled in at the call site, where the argument for
 *  an earlier parameter is an expression and not a value; splicing it in would emit that
 *  expression a second time and run whatever it calls twice. TypeScript's own meaning needs a
 *  binding for the argument, and a call is an expression with nowhere to put one.
 *
 *  Returns true when it reported. The walk skips a name in a position where it is a field and
 *  not a read: `p.k`, `{ k: 1. }`, so a parameter called `k` does not match either. */
function refuseDefaultReadingAParameter(
  p: ts.ParameterDeclaration,
  parameters: readonly ts.ParameterDeclaration[],
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): boolean {
  const names = new Set<string>();
  for (const other of parameters) if (ts.isIdentifier(other.name)) names.add(other.name.text);
  let found: { at: ts.Node; what: string } | undefined;
  const walk = (node: ts.Node): void => {
    if (found) return;
    if (node.kind === ts.SyntaxKind.ThisKeyword) {
      found = { at: node, what: 'this' };
      return;
    }
    if (ts.isPropertyAccessExpression(node)) {
      walk(node.expression);
      return;
    }
    if (ts.isPropertyAssignment(node)) {
      walk(node.initializer);
      return;
    }
    if (ts.isIdentifier(node) && names.has(node.text)) {
      found = { at: node, what: node.text };
      return;
    }
    ts.forEachChild(node, walk);
  };
  walk(p.initializer!);
  if (!found) return false;
  const own = found.what === 'this';
  pushDiag(
    diagnostics,
    sourceFile,
    found.at,
    `A default cannot read ${own ? '"this"' : `the parameter "${found.what}"`}: the default is ` +
      `filled in where the function is called, and ${own ? '"this"' : `"${found.what}"`} is an ` +
      `expression there, which would then run a second time. Give "${ts.isIdentifier(p.name) ? p.name.text : 'the parameter'}" a ` +
      `default that stands on its own and compute from ${own ? '"this"' : `"${found.what}"`} in the body.`,
    TS_CODES.FUNCTION_SHAPE,
  );
  return true;
}

/** The return type a signature declares: the mapped type, checked against `stage` for an entry's
 *  output struct, or `void` where none is written, which a function's body then says (Rule
 *  8.19) and an entry's body is checked against. Returns `undefined` after saying what it
 *  could not map. */
export function parseReturnType(
  typeNode: ts.TypeNode | undefined,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  structs: readonly CollectedStruct[],
  stage: FuncDecl['stage'] | undefined,
  kernel = false,
): ShaderType | undefined {
  if (!typeNode) return voidT;
  let ret: ShaderType = voidT;
  if (typeNode.kind !== ts.SyntaxKind.VoidKeyword) {
    const mapped = mapTsTypeToShaderType(typeNode, sourceFile, diagnostics);
    if (refuseAtomicDeclaration(mapped, typeNode, sourceFile, diagnostics, 'a return type'))
      return undefined;
    // A kernel function may return one of its arrays with no size (Rule 8.22, change 0138,
    // Amendment A19): the body's `return` is checked against its parameters, in `array-return.ts`.
    const kernelArray = kernel && mapped?.kind === 'array' && mapped.size === undefined;
    if (
      !kernelArray &&
      refuseRuntimeArraySignature(
        mapped,
        { kind: 'result' },
        typeNode,
        sourceFile,
        diagnostics,
        (n) => structs.find((c) => c.decl.name === n)?.decl,
      )
    )
      return undefined;
    // The annotation said why it names no type, on its own span. "Unsupported return type
    // for f" repeated that on the same span and named nothing the first one had not (T10).
    if (!mapped) return undefined;
    // An entry's output has no interstage form for the flag (Rule 7.10, changes 0088 and 0093),
    // in a struct's field either.
    if (
      stage !== undefined &&
      refuseOptionalAt(
        mapped,
        typeNode,
        "an entry point's result",
        sourceFile,
        diagnostics,
        authorTypeText,
        (n) => structs.find((c) => c.decl.name === n)?.decl,
      )
    )
      return undefined;
    ret = mapped;
  }
  if (stage && ret.kind === 'struct') {
    checkStructBuiltinFields(diagnostics, sourceFile, typeNode, ret.name, structs, stage, 'output');
  }
  return ret;
}

/** Whether a function declaration carries `export`. */
function isExported(node: ts.FunctionDeclaration): boolean {
  return (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0;
}

export function parseSignature(
  node: ts.FunctionDeclaration,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  structs: readonly CollectedStruct[] = [],
  /** The name the function takes in the IR when it is not the one it was written under: a
   *  function inside `namespace Palette` is `Palette_warm` (roadmap 0.3 item T4, #92). */
  irName?: string,
  /** The parameters that take a function (Rule 8.18), which an instance has none of: each is
   *  the function the call handed over. */
  skip?: ReadonlySet<number>,
  consts: readonly ScopedConst[] = [],
  overrides: readonly OverrideDecl[] = [],
): FuncDecl | undefined {
  if (!node.name || !ts.isIdentifier(node.name)) {
    // `@fragment export default function (…) { … }` has no name because `default` lets it have
    // none, and `default` on an entry is refused where it is written (Rule 8.1).
    if (
      decoratorsOf(node).length > 0 &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) === true
    )
      return undefined;
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      'Function declaration must have a name.',
      TS_CODES.FUNCTION_SHAPE,
    );
    return undefined;
  }
  if (!node.body) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `Function "${node.name.text}" needs a body (no ambient declarations).`,
      TS_CODES.FUNCTION_SHAPE,
    );
    return undefined;
  }
  const name = irName ?? node.name.text;
  // Computed up front (rather than after the return type, as before) so the builtin/stage
  // checks below, for both a direct parameter builtin and a struct-typed parameter's fields,
  // know the entry stage they are validating against.
  const stageInfo = parseStage(node, sourceFile, diagnostics, consts, overrides);
  const params = parseParams(
    skip === undefined ? node.parameters : node.parameters.filter((_, i) => !skip.has(i)),
    sourceFile,
    diagnostics,
    structs,
    stageInfo.stage,
    {
      fnName: name,
      mayBeKernel: stageInfo.stage === undefined && isExported(node),
      // A function of the file or of a namespace takes a reference (Rule 8.25); an entry's
      // parameters come from the pipeline, and a generic function's instance is made from
      // argument values, which a reference is not.
      references: stageInfo.stage === undefined && node.typeParameters === undefined,
    },
  );
  if (!params) return undefined;
  // An array with no size, or a 2D storage texture, makes an exported function a kernel function
  // (Rule 8.22, change 0077). A sampled texture alone does not: a helper that reads one stays a
  // helper an entry calls (0077, Amendment 1).
  const kernel = params.some(
    (p) =>
      (p.type.kind === 'array' && p.type.size === undefined) ||
      p.type.kind === 'collection' ||
      (isExported(node) &&
        stageInfo.stage === undefined &&
        p.type.kind === 'storage-texture' &&
        p.type.dim === '2d'),
  );
  // A function that writes no return type says it in its body (Rule 8.19); an entry's is its
  // output, which its signature declares.
  // A result type the editor's projection wrote is not the author's (change 0134): the
  // function infers it, as `compile()` reads the same text.
  const ret = parseReturnType(
    stageInfo.stage === undefined && hasNoWrittenResult(node, sourceFile) ? undefined : node.type,
    sourceFile,
    diagnostics,
    structs,
    stageInfo.stage,
    kernel,
  );
  if (!ret) return undefined;
  // A stage output of an emulated double is a varying or a render-target write (#151 F64-09).
  if (
    stageInfo.stage !== undefined &&
    refuseF64EntryIo(
      ret,
      `The return of entry "${name}"`,
      'varying',
      node.type ?? node,
      sourceFile,
      diagnostics,
    )
  ) {
    return undefined;
  }
  const decl: FuncDecl = { name, params, ret, body: [] };
  if (kernel) (decl as { kernel?: boolean }).kernel = true;
  // A kernel function's parameters come from the host, so none is optional (Rule 7.10, change
  // 0093, decision D5).
  const optionalOnKernel =
    decl.kernel === true ? node.parameters.find((p) => p.questionToken !== undefined) : undefined;
  if (optionalOnKernel !== undefined && ts.isIdentifier(optionalOnKernel.name)) {
    pushDiag(
      diagnostics,
      sourceFile,
      optionalOnKernel.questionToken!,
      `A kernel function's parameters come from the host, not from a call, so ` +
        `"${optionalOnKernel.name.text}" cannot be optional. Write "${optionalOnKernel.name.text}: T".`,
      TS_CODES.FUNCTION_SHAPE,
    );
    return undefined;
  }
  // A kernel function's result crosses to the host, which has no value for an optional (Rule
  // 7.10, Rule 8.21), in a struct's field or an array's element either (#792).
  if (
    decl.kernel === true &&
    refuseOptionalAt(
      ret,
      node.type ?? node,
      "a kernel function's result",
      sourceFile,
      diagnostics,
      authorTypeText,
      (n) => structs.find((c) => c.decl.name === n)?.decl,
      (inner) =>
        `Carry a u32 flag beside the value, "${inner}", in an array the function writes, or ` +
        `return a struct with a "found: u32" field beside it.`,
    )
  )
    return undefined;
  // A kernel function's `@workgroup_size` sets the workgroup of each loop it lowers (proposal 0067).
  if (stageInfo.kernelWorkgroup !== undefined) {
    const size = settleKernelWorkgroup(
      stageInfo.kernelWorkgroup,
      node,
      sourceFile,
      diagnostics,
      decl.kernel === true,
    );
    if (size !== undefined) kernelWorkgroups.set(decl, size);
  }
  recordParamDefaults(decl, node.parameters);
  // `node.getStart(sourceFile)` is the first decorator or the `export` keyword, so an entry
  // function's span covers its `@fragment` line; `nameSpan` is just the identifier, for a
  // stack frame that highlights the name rather than the whole body.
  (decl as { span?: SourceSpan }).span = spanOf(sourceFile, node);
  (decl as { nameSpan?: SourceSpan }).nameSpan = spanOf(sourceFile, node.name);
  if (stageInfo.stage) (decl as { stage?: FuncDecl['stage'] }).stage = stageInfo.stage;
  const shape = stageInfo.workgroupShape;
  if (shape !== undefined) {
    (decl as { workgroupSize?: number }).workgroupSize = shape[0];
    // An absent shape reads as `[workgroupSize, 1, 1]`, so only a y or z other than 1 is kept.
    if (shape[1] !== 1 || shape[2] !== 1)
      (decl as { workgroupShape?: WorkgroupShape }).workgroupShape = shape;
    if (stageInfo.workgroupSizeOverrides !== undefined)
      (
        decl as { workgroupSizeOverrides?: typeof stageInfo.workgroupSizeOverrides }
      ).workgroupSizeOverrides = stageInfo.workgroupSizeOverrides;
  }
  const attrs: string[] = [];
  if (stageInfo.stage === 'vertex') attrs.push('@vertex');
  if (stageInfo.stage === 'fragment') attrs.push('@fragment');
  if (stageInfo.stage === 'compute')
    attrs.push(
      `@compute ${workgroupSizeAttr(shape ?? [64, 1, 1], stageInfo.workgroupSizeExpressions)}`,
    );
  if (attrs.length) (decl as { attrs?: string[] }).attrs = attrs;
  if (stageInfo.stage === 'vertex' && typeKey(ret).startsWith('vec4')) {
    (decl as { retAttr?: string }).retAttr = '@builtin(position)';
    (decl as { retBuiltin?: string }).retBuiltin = 'position';
  }
  // A fragment entry's output takes `@location(0)` whatever its width: `f32`, `vec2` and
  // `vec3` are as valid a draw-buffer format as `vec4`, and only the `vec4` case used to get
  // the attribute, so the other three emitted WGSL Tint refuses ("missing entry point IO
  // attribute on return type") with nothing said here.
  if (
    stageInfo.stage === 'fragment' &&
    (ret.kind === 'scalar' || ret.kind === 'vec') &&
    ret.kind !== undefined
  ) {
    (decl as { retAttr?: string }).retAttr = '@location(0)';
  }
  // A vertex entry has to produce a position, and nothing here can invent one: WGSL says "a
  // vertex shader must include the 'position' builtin in its return type", and before this the
  // three ways to leave it out compiled clean and were refused by Tint instead.
  // An entry that writes no return type is checked once its body has said it (Rule 8.19,
  // `settleInferredEntryResult`).
  if (stageInfo.stage === 'vertex' && node.type !== undefined) {
    refuseVertexWithoutPosition(ret, node, name, sourceFile, diagnostics, structs);
  }
  return decl;
}

/** True, having reported it, when an emulated double sits on an entry's IO boundary.
 *
 *  A `@location` varying is INTERPOLATED, and interpolating a (hi, lo) pair word by word is
 *  not the interpolation of the double it encodes: the low word is the part f32 could not
 *  hold, and a hardware blend of it carries no meaning. The fp64 pass refuses it as SD0044,
 *  and a `vec64` vertex ATTRIBUTE as SD0041 (it would need two slots), both at emit, with no
 *  source span. Said here instead, at the parameter, the field or the return type that has
 *  it, naming the bridge an author can write (#151 F64-09).
 *
 *  A SCALAR `f64` vertex attribute is not refused: a vertex `@location` input is a buffer
 *  read, not a varying, and one `vec2<f32>` slot carries the pair exactly — which is what the
 *  pass accepts. */
export type F64IoPlace =
  /** A `@location` that is INTERPOLATED between the stages: a fragment input, any entry
   *  output. The pair's two words would be blended one at a time. */
  | 'varying'
  /** A bare vertex `@location` parameter, which is a buffer read. A scalar double's pair
   *  rides the one slot it already has; anything wider needs more than one. */
  | 'attribute'
  /** A `@location` field of an IO struct, which the fp64 pass refuses whichever direction it
   *  faces — its struct rule keys on `f.location !== undefined` alone. */
  | 'io-struct-field';

export function refuseF64EntryIo(
  type: ShaderType,
  what: string,
  place: F64IoPlace,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): boolean {
  if (!containsF64Type(type)) return false;
  // The one f64 an entry CAN carry, and the only place it can: see 'attribute' above.
  if (place === 'attribute' && type.kind === 'f64') return false;
  // The remedy is an ORDINARY one, deliberately: there is no author-facing helper for
  // splitting a double into its words and no plan for one, because the words are the
  // emulation's business and not the language's (§39). A uniform or storage binding carries
  // an f64 and is visible from every stage, so a double that two stages need is read where
  // it is needed rather than handed across.
  const bridge =
    `Narrow it with f32(x), or compute the double in the stage that needs it — a uniform or ` +
    `storage binding carries an f64 and every stage can read one.`;
  const reason =
    place === 'varying'
      ? `an emulated double is a pair of f32 words, and a @location varying interpolates ` +
        `each word on its own, which is not the interpolation of the double`
      : place === 'attribute'
        ? `a vertex attribute is one slot per @location, and only a scalar f64 fits one — ` +
          `this shape needs more`
        : `the fp64 pass carries no emulated double in an entry IO struct, whichever ` +
          `direction it faces` +
          (type.kind === 'f64'
            ? ` — a scalar one rides a bare @location parameter, if that is what you meant`
            : '');
  pushDiag(
    diagnostics,
    sourceFile,
    node,
    `${what} carries ${authorTypeText(type)}: ${reason}. ${bridge}`,
    TS_CODES.F64_ENTRY_IO,
  );
  return true;
}

/** Whether `t` carries an emulated double anywhere — the scalar, a vector of them, a matrix of
 *  them, or an array or struct field of any of those. The fp64 pass's own `containsF64`, in
 *  the front end's terms; a struct is taken by NAME there and its fields are checked where the
 *  struct is validated, so the recursion here stops at one. */
function containsF64Type(t: ShaderType): boolean {
  if (t.kind === 'f64' || t.kind === 'vec64') return true;
  if (t.kind === 'mat') return t.elem === 'f64';
  if (t.kind === 'array') return containsF64Type(t.elem);
  return false;
}

/** True, having reported it, when a `@vertex` entry's return carries no `@builtin(position)`:
 *  a struct without such a field, or any bare type that is not the `vec4` the position is. */
function refuseVertexWithoutPosition(
  ret: ShaderType,
  node: ts.Node,
  name: string,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  structs: readonly CollectedStruct[],
): void {
  if (typeKey(ret).startsWith('vec4')) return;
  if (ret.kind === 'struct') {
    const decl = structs.find((s) => s.decl.name === ret.name);
    // An unknown struct was reported where it was named; do not pile on.
    if (decl === undefined) return;
    if (decl.decl.fields.some((f) => f.builtin === 'position' || hasRefusedIoAttribute(f))) return;
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `"${name}" is a vertex entry, so what it returns has to carry the position: give ` +
        `"${authorTypeText(ret)}" a field typed builtin<"position">.`,
      TS_CODES.FUNCTION_SHAPE,
    );
    return;
  }
  pushDiag(
    diagnostics,
    sourceFile,
    node,
    `"${name}" is a vertex entry, so it returns the position: a vec4, which is the position ` +
      `on its own, or a struct with a field typed builtin<"position">. ` +
      `${typeKey(ret) === 'void' ? 'It returns nothing' : `It returns ${authorTypeText(ret)}`}.`,
    TS_CODES.FUNCTION_SHAPE,
  );
}

/** What a function's scope needs of a module const. `wgslValue` and `valueExpr` also supply
 *  conservative integer index proofs; a CPU value alone does not prove the emitted value. */
export interface ScopedConst {
  readonly name: string;
  readonly type: ShaderType;
  readonly cpuValue?: number | boolean;
  readonly wgslValue?: number;
  readonly valueExpr?: Expr;
}

/** A `@workgroup_size` on a function that is not an entry (proposal 0067): the decorator, and the
 *  extent its argument names, when the argument is one positive whole number. Whether the
 *  function is a kernel function, which takes it, is known once its parameters are read. */
export interface KernelWorkgroupAttr {
  /** The `@workgroup_size` decorator, or the `workgroup_size([…], f)` call (change 0111). */
  readonly anchor: ts.Decorator | ts.CallExpression;
  /** The extent, or undefined when the argument is not one positive whole number. */
  readonly size?: number;
  /** Each `@workgroup_size` written after the first on the same function (Rule 8.22). */
  readonly further?: readonly ts.Decorator[];
}

/** Reads the argument of a kernel function's `@workgroup_size` (Rule 8.7's grammar, one extent):
 *  an array literal of one positive integer literal or one `i32` or `u32` module constant. An
 *  override is not one (decision D2). */
function kernelWorkgroupOf(
  d: ts.Decorator | ts.CallExpression,
  consts: readonly ScopedConst[],
): KernelWorkgroupAttr {
  const unwrap = (e: ts.Expression): ts.Expression => {
    let out = e;
    while (
      ts.isParenthesizedExpression(out) ||
      ts.isAsExpression(out) ||
      ts.isSatisfiesExpression(out)
    )
      out = out.expression;
    return out;
  };
  // The decorator's one argument, or a refused stage call's first.
  const args = ts.isDecorator(d)
    ? ts.isCallExpression(d.expression)
      ? d.expression.arguments
      : undefined
    : d.arguments.slice(0, 1);
  if (args === undefined || args.length !== 1) return { anchor: d };
  const arg = unwrap(args[0]!);
  if (!ts.isArrayLiteralExpression(arg) || arg.elements.length !== 1) return { anchor: d };
  const element = unwrap(arg.elements[0]!);
  if (ts.isNumericLiteral(element)) {
    const n = Number(element.text);
    return Number.isInteger(n) && n > 0 ? { anchor: d, size: n } : { anchor: d };
  }
  if (ts.isIdentifier(element)) {
    const constant = consts.find((c) => c.name === element.text);
    const value = constant?.cpuValue;
    if (
      constant?.type.kind === 'scalar' &&
      (constant.type.scalar === 'u32' || constant.type.scalar === 'i32') &&
      typeof value === 'number' &&
      Number.isInteger(value) &&
      value > 0
    )
      return { anchor: d, size: value };
  }
  return { anchor: d };
}

/**
 * Settles the `@workgroup_size` of a function that is not an entry (proposal 0067, Rule 8.22): a
 * kernel function takes one extent and sets its loops' workgroup, and any other function refuses
 * the decorator (`TS8028`). A bad argument is `TS8037`, and an extent over WebGPU's default limit
 * the `TS8026` warning. Returns the extent a kernel function takes.
 */
function settleKernelWorkgroup(
  attr: KernelWorkgroupAttr,
  node: ts.FunctionDeclaration,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  kernel: boolean,
): number | undefined {
  const d = attr.anchor;
  const call = ts.isCallExpression(d);
  // A generic function is lowered once per instance, and each pass reads its decorators again: one
  // decorator is one refusal (Rule 12.4).
  const once = (
    message: string,
    code: TsCode,
    category: TsCompilerDiagnostic['category'] = 'error',
    at: ts.Node = d,
  ) => {
    const start = at.getStart(sourceFile);
    if (diagnostics.some((x) => x.start === start && x.message === message)) return;
    diagnostics.push(makeDiagnostic(sourceFile, at, message, code, category));
  };
  // Each `@workgroup_size` written after the first (change 0130, amendment A1).
  const further = attr.further ?? [];
  // Each message names the attribute, the form an author writes (change 0130), whichever form
  // was written.
  if (!kernel || !isExported(node)) {
    // The function takes none, so each one written is refused for that, at its own attribute.
    for (const at of [d, ...further])
      once(
        `"workgroup_size" applies to a kernel function only: an exported function that takes an array with no size (Rule 8.22). Declare "${node.name?.text ?? 'this function'}" without it.`,
        TS_CODES.ATTRIBUTE_NAME,
        'error',
        at,
      );
    return undefined;
  }
  // A function takes at most one `@workgroup_size([n])` (Rule 8.22, change 0130, amendment A1):
  // each further one is refused at its own attribute, as a second stage attribute is, and the
  // first one sets the size. The text names what to delete (Rule 12.5).
  for (const second of further) {
    const written = second.getText(sourceFile);
    once(
      `"${written}" is a second "@workgroup_size" on "${node.name?.text ?? 'this function'}", ` +
        `after "${d.getText(sourceFile)}": a function takes at most one "@workgroup_size([n])"; ` +
        `delete "${written}" (Rule 8.22).`,
      TS_CODES.ATTRIBUTE_NAME,
      'error',
      second,
    );
  }
  if (attr.size === undefined) {
    // The argument as written: the call's first, or the decorator's list.
    const args = call
      ? d.arguments.slice(0, 1)
      : ts.isCallExpression(d.expression)
        ? d.expression.arguments
        : [];
    const written =
      args.length === 0 ? d.getText(sourceFile) : args.map((a) => a.getText(sourceFile)).join(', ');
    once(
      `workgroup_size takes an array of one whole number, as "@workgroup_size([64])", or a module constant in it, as "@workgroup_size([TILE])"; "${written}" is not one.`,
      TS_CODES.WORKGROUP_ARG,
    );
    return undefined;
  }
  const shape: WorkgroupShape = [attr.size, 1, 1];
  const over = overDefaultWorkgroupLimit(shape);
  if (over !== undefined)
    once(
      `workgroup_size shape [${attr.size}, 1, 1] ${over}. WebGPU guarantees no more, so a device requested without raising that limit refuses the pipeline.`,
      TS_CODES.WORKGROUP_SHAPE,
      'warning',
    );
  return attr.size;
}

/**
 * The output of an entry that writes no return type, once its body has said it (Rule 8.19,
 * change 0136): the attribute its stage gives the type, and the checks a written return type
 * gets (`parseSignature`, `parseReturnType`). A bare `vec4` vertex result is the position, a bare
 * scalar or vector fragment result is `@location(0)`, and a struct result carries its fields'
 * attributes. A compute entry returns nothing, so a value it returns is refused. `failed` says
 * that an error in the body already explains a result that is missing.
 */
export function settleInferredEntryResult(
  stub: FuncDecl,
  node: FunctionNode,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  structs: readonly CollectedStruct[],
  failed: boolean,
): void {
  const ret = stub.ret;
  const anchor = node.name ?? node;
  const decl = stub as {
    retAttr?: string;
    retBuiltin?: string;
  };
  if (stub.stage === 'compute') {
    if (typeKey(ret) !== 'void') {
      pushDiag(
        diagnostics,
        sourceFile,
        anchor,
        `Entry function "${stub.name}" is a compute entry, and a compute entry returns nothing ` +
          `(WGSL): it returns ${authorTypeText(ret)}. Write the value to a storage binding.`,
        TS_CODES.RETURN_SHAPE,
      );
    }
    return;
  }
  if (typeKey(ret) === 'void') {
    if (stub.stage === 'vertex' && !failed) {
      refuseVertexWithoutPosition(ret, node, stub.name, sourceFile, diagnostics, structs);
    }
    return;
  }
  const declOf = (n: string): StructDecl | undefined =>
    structs.find((c) => c.decl.name === n)?.decl;
  if (
    refuseOptionalAt(
      ret,
      anchor,
      "an entry point's result",
      sourceFile,
      diagnostics,
      authorTypeText,
      declOf,
    )
  )
    return;
  if (
    refuseF64EntryIo(
      ret,
      `The return of entry "${stub.name}"`,
      'varying',
      anchor,
      sourceFile,
      diagnostics,
    )
  )
    return;
  if (ret.kind === 'struct') {
    checkStructBuiltinFields(
      diagnostics,
      sourceFile,
      anchor,
      ret.name,
      structs,
      stub.stage!,
      'output',
    );
  }
  if (stub.stage === 'vertex' && typeKey(ret).startsWith('vec4')) {
    decl.retAttr = '@builtin(position)';
    decl.retBuiltin = 'position';
  }
  if (stub.stage === 'fragment' && (ret.kind === 'scalar' || ret.kind === 'vec')) {
    decl.retAttr = '@location(0)';
  }
  if (stub.stage === 'vertex') {
    refuseVertexWithoutPosition(ret, node, stub.name, sourceFile, diagnostics, structs);
  }
}

function parseStage(
  node: ts.FunctionDeclaration,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  consts: readonly ScopedConst[] = [],
  overrides: readonly OverrideDecl[] = [],
): {
  stage?: FuncDecl['stage'];
  workgroupShape?: WorkgroupShape;
  workgroupSizeOverrides?: readonly [string | undefined, string | undefined, string | undefined];
  workgroupSizeExpressions?: readonly [string | undefined, string | undefined, string | undefined];
  /** A `@workgroup_size` on a function that is not an entry, settled by the caller. */
  kernelWorkgroup?: KernelWorkgroupAttr;
} {
  const decos = decoratorsOf(node);
  const isEntry = decos.some((d) => /^@(vertex|fragment|compute)\b/.test(d.getText(sourceFile)));
  let stage: FuncDecl['stage'] | undefined;
  let workgroupShape: WorkgroupShape | undefined;
  let kernelWorkgroup: KernelWorkgroupAttr | undefined;
  let workgroupSizeOverrides:
    [string | undefined, string | undefined, string | undefined] | undefined;
  let workgroupSizeExpressions:
    [string | undefined, string | undefined, string | undefined] | undefined;
  // Read the workgroup argument's AST, not its text (#118). No argument takes the default;
  // dimensions may be positive integer literals, module constants or overrides. Anything else
  // used to fall through to 64 with no diagnostic — `@compute({ workgroup: [8, 8, 1] })`,
  // `@compute(128)`, `@compute(SIZE)` — so the author asked for one size and dispatched against
  // another. It is reported now, at the argument.
  const readCompute = (args: readonly ts.Expression[], anchor: ts.Node): void => {
    stage = 'compute';
    workgroupShape = [64, 1, 1];
    if (args.length > 0) {
      const written = args.map((a) => a.getText(sourceFile)).join(', ');
      let arg: ts.Expression = args[0]!;
      while (
        ts.isParenthesizedExpression(arg) ||
        ts.isAsExpression(arg) ||
        ts.isSatisfiesExpression(arg)
      )
        arg = arg.expression;
      const shape = args.length === 1 && ts.isArrayLiteralExpression(arg) ? arg : undefined;
      const values: number[] = [];
      const overrideNames: (string | undefined)[] = [];
      const expressions: (string | undefined)[] = [];
      for (const element of shape?.elements ?? []) {
        let valueExpr = element;
        while (
          ts.isParenthesizedExpression(valueExpr) ||
          ts.isAsExpression(valueExpr) ||
          ts.isSatisfiesExpression(valueExpr)
        )
          valueExpr = valueExpr.expression;
        if (ts.isNumericLiteral(valueExpr)) {
          values.push(Number(valueExpr.text));
          overrideNames.push(undefined);
          expressions.push(undefined);
          continue;
        }
        if (ts.isIdentifier(valueExpr)) {
          const name = valueExpr.text;
          const override = overrides.find((candidate) => candidate.name === name);
          const constant = consts.find((candidate) => candidate.name === name);
          const type = override?.type ?? constant?.type;
          const value = override?.default ?? constant?.cpuValue;
          if (
            type?.kind === 'scalar' &&
            (type.scalar === 'u32' || type.scalar === 'i32') &&
            typeof value === 'number' &&
            Number.isInteger(value) &&
            value > 0
          ) {
            values.push(value);
            overrideNames.push(override === undefined ? undefined : name);
            expressions.push(name);
            continue;
          }
        }
        values.push(NaN);
        overrideNames.push(undefined);
        expressions.push(undefined);
      }
      const sizes = shape === undefined ? undefined : values;
      if (
        sizes === undefined ||
        sizes.length === 0 ||
        sizes.length > 3 ||
        sizes.some((n) => !Number.isInteger(n) || n < 1)
      ) {
        pushDiag(
          diagnostics,
          sourceFile,
          args[0]!,
          // The attribute's spelling, whichever form was written (Rule 8.7, change 0130).
          `compute takes an array of one to three whole numbers, "@compute([64, 1, 1])"; ` +
            `"${written}" is not a workgroup shape.`,
          TS_CODES.WORKGROUP_ARG,
        );
      } else {
        workgroupShape = toWorkgroupShape(sizes as [number, number?, number?]);
        if (overrideNames.some((name) => name !== undefined))
          workgroupSizeOverrides = [overrideNames[0], overrideNames[1], overrideNames[2]];
        workgroupSizeExpressions = [expressions[0], expressions[1], expressions[2]];
        const over = overDefaultWorkgroupLimit(workgroupShape);
        if (over !== undefined) {
          diagnostics.push(
            makeDiagnostic(
              sourceFile,
              anchor,
              `compute workgroup shape [${sizes.join(', ')}] ${over}. WebGPU guarantees no ` +
                `more, so a device requested without raising that limit refuses the pipeline.`,
              TS_CODES.WORKGROUP_SHAPE,
              'warning',
            ),
          );
        }
      }
    }
  };
  // A refused stage call (changes 0130 and 0140) says the stage, or a kernel function's
  // workgroup, with no decorator.
  const sc = stageCallOfDeclaration(node);
  if (sc !== undefined) {
    if (sc.callee === 'workgroup_size') kernelWorkgroup = kernelWorkgroupOf(sc.call, consts);
    else if (sc.callee === 'compute') readCompute(sc.size === undefined ? [] : [sc.size], sc.call);
    else stage = sc.callee;
  }
  // An entry has exactly one stage attribute (Rule 8.1, change 0130): a second one is refused at
  // its own decorator, once, and the first one decides the stage.
  let firstStage: string | undefined;
  for (const d of decos) {
    const name = /^@(vertex|fragment|compute)\b/.exec(d.getText(sourceFile))?.[1];
    if (name === undefined) continue;
    if (firstStage === undefined) {
      firstStage = name;
      continue;
    }
    const message =
      `"@${name}" is a second stage attribute on "${node.name?.text ?? 'this function'}", ` +
      `after "@${firstStage}": an entry has exactly one stage, "@vertex", "@fragment" or ` +
      `"@compute([…])" (Rule 8.1).`;
    const start = d.getStart(sourceFile);
    if (!diagnostics.some((x) => x.start === start && x.message === message))
      diagnostics.push(makeDiagnostic(sourceFile, d, message, TS_CODES.ATTRIBUTE_NAME));
  }
  // One refusal of a stage attribute or `@workgroup_size` as written, on the attribute. The
  // signature pass and the body pass both read the attributes: one attribute is one refusal
  // (Rule 12.4).
  const refuseAttribute = (d: ts.Decorator, message: string): void => {
    const start = d.getStart(sourceFile);
    if (!diagnostics.some((x) => x.start === start && x.message === message))
      diagnostics.push(makeDiagnostic(sourceFile, d, message, TS_CODES.ATTRIBUTE_NAME));
  };
  // `@name<T>(…)` is neither `@name` nor `@name(…)` (Rule 6.7): the type argument is read by
  // nothing, so the attribute is refused as `@name<T>` is. Returns whether it refused.
  const refuseTypeArguments = (d: ts.Decorator): boolean => {
    if (!ts.isCallExpression(d.expression) || d.expression.typeArguments === undefined)
      return false;
    refuseAttribute(
      d,
      `"${d.getText(sourceFile)}" is not applied: an attribute is written "@name" or ` +
        `"@name(...)". Remove it.`,
    );
    return true;
  };
  // `@vertex` and `@fragment` take no argument list (Rule 8.1, change 0130, amendment A1): an
  // argument written on one is read by nothing, so it is refused and not dropped, and the empty
  // list, `@vertex()`, is refused with it, since a stage has one spelling. `@compute()` is not:
  // its empty list means the default size (Rule 8.7). The stage is still read, so nothing else
  // is said about the entry (Rule 12.4).
  const refuseArguments = (d: ts.Decorator, name: 'vertex' | 'fragment'): void => {
    if (!ts.isCallExpression(d.expression)) return;
    const args = d.expression.arguments;
    // The arguments as written; the empty list is named as `()`.
    const written =
      args.length === 0
        ? ''
        : sourceFile.text.slice(args[0]!.getStart(sourceFile), args[args.length - 1]!.end);
    refuseAttribute(
      d,
      `"@${name}" takes no argument: write "@${name}" and delete "(${written})" (Rule 8.1).`,
    );
  };
  const furtherWorkgroups: ts.Decorator[] = [];
  for (const d of decos) {
    const stageName = /^@(vertex|fragment|compute)\b/.exec(d.getText(sourceFile))?.[1];
    if (stageName !== undefined && stageName !== firstStage) continue;
    if (stageName !== undefined && stage !== undefined) continue;
    // A function that is not an entry may be a kernel function, which takes one extent of
    // `@workgroup_size` (Rule 8.22). Whether it is one is known once its parameters are read.
    if (!isEntry && /^@workgroup_size\b/.test(d.getText(sourceFile))) {
      const typed = refuseTypeArguments(d);
      // The first one sets the size. Each further one is kept for `settleKernelWorkgroup`, which
      // refuses it on a kernel function (Rule 8.22, change 0130, amendment A1); one that a type
      // argument already refused is not refused twice (Rule 12.4).
      if (kernelWorkgroup === undefined) kernelWorkgroup = kernelWorkgroupOf(d, consts);
      else if (!typed && ts.isDecorator(kernelWorkgroup.anchor)) furtherWorkgroups.push(d);
      continue;
    }
    checkAttributeName(
      diagnostics,
      sourceFile,
      d,
      ts.isSourceFile(node.parent) ? 'a function' : "a namespace's function",
    );
    const text = d.getText(sourceFile);
    if (/^@vertex\b/.test(text)) {
      stage = 'vertex';
      if (!refuseTypeArguments(d)) refuseArguments(d, 'vertex');
    } else if (/^@fragment\b/.test(text)) {
      stage = 'fragment';
      if (!refuseTypeArguments(d)) refuseArguments(d, 'fragment');
    } else if (/^@compute\b/.test(text)) {
      refuseTypeArguments(d);
      readCompute(ts.isCallExpression(d.expression) ? d.expression.arguments : [], d);
    }
  }
  return {
    stage,
    workgroupShape,
    workgroupSizeOverrides,
    workgroupSizeExpressions,
    kernelWorkgroup:
      kernelWorkgroup !== undefined && furtherWorkgroups.length > 0
        ? { ...kernelWorkgroup, further: furtherWorkgroups }
        : kernelWorkgroup,
  };
}

/** WebGPU's default compute limits, the ones every adapter supports and `requestDevice()`
 *  grants when no `requiredLimits` raise them. */
const DEFAULT_WORKGROUP_LIMITS = {
  maxComputeWorkgroupSizeX: 256,
  maxComputeWorkgroupSizeY: 256,
  maxComputeWorkgroupSizeZ: 64,
  maxComputeInvocationsPerWorkgroup: 256,
} as const;

/** The first default limit a workgroup shape exceeds, as a clause naming it; `undefined` when
 *  the shape fits a device with the default limits. */
function overDefaultWorkgroupLimit(shape: WorkgroupShape): string | undefined {
  const [x, y, z] = shape;
  const L = DEFAULT_WORKGROUP_LIMITS;
  if (x > L.maxComputeWorkgroupSizeX)
    return `has x = ${x}, over maxComputeWorkgroupSizeX (${L.maxComputeWorkgroupSizeX})`;
  if (y > L.maxComputeWorkgroupSizeY)
    return `has y = ${y}, over maxComputeWorkgroupSizeY (${L.maxComputeWorkgroupSizeY})`;
  if (z > L.maxComputeWorkgroupSizeZ)
    return `has z = ${z}, over maxComputeWorkgroupSizeZ (${L.maxComputeWorkgroupSizeZ})`;
  const n = x * y * z;
  if (n > L.maxComputeInvocationsPerWorkgroup)
    return `has ${n} invocations, over maxComputeInvocationsPerWorkgroup (${L.maxComputeInvocationsPerWorkgroup})`;
  return undefined;
}

/** The decorators `node` carries, with those its attribute type stands for (change 0111). */
export function decoratorsOf(node: ts.Node): readonly ts.Decorator[] {
  return attributeDecoratorsOf(node);
}

/** Validates every field of the struct named `structName` (a parameter's or a return type's
 *  struct) against `stage`/`direction`: a `builtin<…>` field is checked with
 *  `checkBuiltinStage`, and a field of a compute entry's struct that is no built-in value is
 *  `STRUCT_FIELD_MISSING_ATTR`, since a compute entry has no user-defined input. A field with
 *  no attribute on a vertex or a fragment entry is a user-defined input or output, and the
 *  compiler gives it its location once every entry is read (`entry-locations.ts`, Rule 6.6,
 *  change 0135), where its type and an emulated double are checked too. Every diagnostic
 *  anchors at `node` (the parameter or the return type annotation) since a `StructField`
 *  carries no source position of its own; see `structs.ts`'s `collectStructs`, which already
 *  validated each field's builtin name and type independently of how the struct ends up used. */
function checkStructBuiltinFields(
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
  node: ts.Node,
  structName: string,
  structs: readonly CollectedStruct[],
  stage: BuiltinStage,
  direction: 'input' | 'output',
): void {
  const collected = structs.find((s) => s.decl.name === structName);
  if (!collected) return;
  // The struct as the author wrote it, `N.VOut` for the `N_VOut` a namespace's class emits as.
  const shown = authorTypeText(structT(structName));
  // The slot-collision and varying-type rules read the struct alone and live in `structs.ts`,
  // which sees each declaration once: raised here they printed one mistake twice, because a
  // vertex output and a fragment input are the SAME struct. What is left below reads the
  // stage, which is genuinely different between the two uses.
  for (const field of collected.decl.fields) {
    if (hasRefusedIoAttribute(field)) continue;
    // A user-defined value on a COMPUTE entry, reached through a struct parameter, with a
    // `location<…>` or with no attribute at all. Tint answers `'@location' cannot be used by
    // compute shaders`, and a member with no attribute is refused there too. Stage-dependent,
    // so it belongs here rather than in the struct collector, which sees no stage.
    if (stage === 'compute' && !field.builtin) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `Struct "${shown}" field "${field.name}" is ` +
          `${field.location !== undefined ? 'at a location<…>' : `a user-defined ${direction}`} ` +
          `and "${shown}" is a compute entry ${direction}, which has no user IO: a compute ` +
          `shader reads its work from resources and the builtin<…> invocation ids.`,
        TS_CODES.STRUCT_FIELD_MISSING_ATTR,
      );
      continue;
    }
    if (
      field.location !== undefined &&
      refuseF64EntryIo(
        field.type,
        `Struct "${shown}" field "${field.name}", a ${stage} ${direction},`,
        'io-struct-field',
        node,
        sourceFile,
        diagnostics,
      )
    ) {
      continue;
    }
    if (!field.builtin) continue;
    checkBuiltinStage(diagnostics, sourceFile, node, field.builtin, stage, direction);
  }
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
