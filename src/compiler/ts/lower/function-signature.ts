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
import { attributeDecoratorsOf } from '../attribute-types.js';
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
import { referenceOf } from './references.js';
import { refuseRuntimeArraySignature } from './runtime-array.js';
import { madeCandidate, refuseResultArray, type MadeResult } from './made-array/candidate.js';
import { markMadeResult } from './made-array/lower.js';
import { pushDiag } from './push-diag.js';

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
    readonly mayBeKernel?: boolean;
    readonly references?: boolean;
  } = {},
): FuncDecl['params'][number][] | undefined {
  const params: FuncDecl['params'][number][] = [];
  const paramLocations = new Map<number, string>();
  const fnName = opts.fnName ?? opts.owner ?? 'this entry';
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
    const referenced = opts.references === true ? referenceOf(p, sourceFile) : undefined;
    const written = p.type;
    const pMapped =
      opts.mayBeKernel === true && referenced === undefined
        ? withCollections(() => mapTsTypeToShaderType(written, sourceFile, diagnostics))
        : mapTsTypeToShaderType(written, sourceFile, diagnostics);
    if (refuseAtomicDeclaration(pMapped, written, sourceFile, diagnostics, 'a parameter'))
      return undefined;
    const pType = optionalDeclaredType(
      pMapped,
      p.questionToken,
      `parameter "${p.name.text}?"`,
      sourceFile,
      diagnostics,
      authorTypeText,
    );
    if (!pType) return undefined;
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
      ...(kernelArray || referenced !== undefined ? { mode: 'inout' as const } : {}),
    };
    if (builtin === undefined && location === undefined && (builtinArg || unknownAttribute))
      refusedIoParams.add(param);
    params.push(param);
  }
  return params;
}

const refusedIoParams = new WeakSet<FuncDecl['params'][number]>();

export function hasRefusedIoParam(param: FuncDecl['params'][number]): boolean {
  return refusedIoParams.has(param);
}

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

export function parseReturnType(
  typeNode: ts.TypeNode | undefined,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  structs: readonly CollectedStruct[],
  stage: FuncDecl['stage'] | undefined,
  made?: MadeResult['kind'],
): ShaderType | undefined {
  if (!typeNode) return voidT;
  let ret: ShaderType = voidT;
  if (typeNode.kind !== ts.SyntaxKind.VoidKeyword) {
    const mapped = mapTsTypeToShaderType(typeNode, sourceFile, diagnostics);
    if (refuseAtomicDeclaration(mapped, typeNode, sourceFile, diagnostics, 'a return type'))
      return undefined;
    if (
      refuseResultArray(
        mapped,
        typeNode,
        sourceFile,
        diagnostics,
        (n) => structs.find((c) => c.decl.name === n)?.decl,
        made,
      )
    )
      return undefined;
    if (!mapped) return undefined;
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

function isExported(node: ts.FunctionDeclaration): boolean {
  return (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0;
}

export function parseSignature(
  node: ts.FunctionDeclaration,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  structs: readonly CollectedStruct[] = [],
  irName?: string,
  skip?: ReadonlySet<number>,
  consts: readonly ScopedConst[] = [],
  overrides: readonly OverrideDecl[] = [],
): FuncDecl | undefined {
  if (!node.name || !ts.isIdentifier(node.name)) {
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
  const stageInfo = parseStage(node, sourceFile, diagnostics, consts, overrides);
  const made = madeCandidate(node, stageInfo.stage === undefined && isExported(node));
  const params = parseParams(
    skip === undefined ? node.parameters : node.parameters.filter((_, i) => !skip.has(i)),
    sourceFile,
    diagnostics,
    structs,
    stageInfo.stage,
    {
      fnName: name,
      mayBeKernel: stageInfo.stage === undefined && isExported(node),
      references: stageInfo.stage === undefined && node.typeParameters === undefined,
    },
  );
  if (!params) return undefined;
  const ret = parseReturnType(
    stageInfo.stage === undefined && hasNoWrittenResult(node, sourceFile) ? undefined : node.type,
    sourceFile,
    diagnostics,
    structs,
    stageInfo.stage,
    made?.kind,
  );
  if (!ret) return undefined;
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
  if (
    params.some(
      (p) =>
        (p.type.kind === 'array' && p.type.size === undefined) ||
        p.type.kind === 'collection' ||
        (isExported(node) &&
          stageInfo.stage === undefined &&
          p.type.kind === 'storage-texture' &&
          p.type.dim === '2d'),
    )
  )
    (decl as { kernel?: boolean }).kernel = true;
  if (made?.kind === 'kernel' && ret.kind === 'array') markMadeResult(decl, made.decl);
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
  (decl as { span?: SourceSpan }).span = spanOf(sourceFile, node);
  (decl as { nameSpan?: SourceSpan }).nameSpan = spanOf(sourceFile, node.name);
  if (stageInfo.stage) (decl as { stage?: FuncDecl['stage'] }).stage = stageInfo.stage;
  const shape = stageInfo.workgroupShape;
  if (shape !== undefined) {
    (decl as { workgroupSize?: number }).workgroupSize = shape[0];
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
  if (
    stageInfo.stage === 'fragment' &&
    (ret.kind === 'scalar' || ret.kind === 'vec') &&
    ret.kind !== undefined
  ) {
    (decl as { retAttr?: string }).retAttr = '@location(0)';
  }
  if (stageInfo.stage === 'vertex' && node.type !== undefined) {
    refuseVertexWithoutPosition(ret, node, name, sourceFile, diagnostics, structs);
  }
  return decl;
}

export type F64IoPlace =
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
  if (place === 'attribute' && type.kind === 'f64') return false;
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

function containsF64Type(t: ShaderType): boolean {
  if (t.kind === 'f64' || t.kind === 'vec64') return true;
  if (t.kind === 'mat') return t.elem === 'f64';
  if (t.kind === 'array') return containsF64Type(t.elem);
  return false;
}

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

export interface ScopedConst {
  readonly name: string;
  readonly type: ShaderType;
  readonly cpuValue?: number | boolean;
  readonly wgslValue?: number;
  readonly valueExpr?: Expr;
}

export interface KernelWorkgroupAttr {
  readonly anchor: ts.Decorator | ts.CallExpression;
  readonly size?: number;
  readonly further?: readonly ts.Decorator[];
}

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

function settleKernelWorkgroup(
  attr: KernelWorkgroupAttr,
  node: ts.FunctionDeclaration,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  kernel: boolean,
): number | undefined {
  const d = attr.anchor;
  const call = ts.isCallExpression(d);
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
  const further = attr.further ?? [];
  if (!kernel || !isExported(node)) {
    for (const at of [d, ...further])
      once(
        `"workgroup_size" applies to a kernel function only: an exported function that takes an array with no size (Rule 8.22). Declare "${node.name?.text ?? 'this function'}" without it.`,
        TS_CODES.ATTRIBUTE_NAME,
        'error',
        at,
      );
    return undefined;
  }
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
  const sc = stageCallOfDeclaration(node);
  if (sc !== undefined) {
    if (sc.callee === 'workgroup_size') kernelWorkgroup = kernelWorkgroupOf(sc.call, consts);
    else if (sc.callee === 'compute') readCompute(sc.size === undefined ? [] : [sc.size], sc.call);
    else stage = sc.callee;
  }
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
  const refuseAttribute = (d: ts.Decorator, message: string): void => {
    const start = d.getStart(sourceFile);
    if (!diagnostics.some((x) => x.start === start && x.message === message))
      diagnostics.push(makeDiagnostic(sourceFile, d, message, TS_CODES.ATTRIBUTE_NAME));
  };
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
  const refuseArguments = (d: ts.Decorator, name: 'vertex' | 'fragment'): void => {
    if (!ts.isCallExpression(d.expression)) return;
    const args = d.expression.arguments;
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
    if (!isEntry && /^@workgroup_size\b/.test(d.getText(sourceFile))) {
      const typed = refuseTypeArguments(d);
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

const DEFAULT_WORKGROUP_LIMITS = {
  maxComputeWorkgroupSizeX: 256,
  maxComputeWorkgroupSizeY: 256,
  maxComputeWorkgroupSizeZ: 64,
  maxComputeInvocationsPerWorkgroup: 256,
} as const;

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

export function decoratorsOf(node: ts.Node): readonly ts.Decorator[] {
  return attributeDecoratorsOf(node);
}

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
  const shown = authorTypeText(structT(structName));
  for (const field of collected.decl.fields) {
    if (hasRefusedIoAttribute(field)) continue;
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
