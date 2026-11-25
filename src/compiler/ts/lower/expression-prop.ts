import { markAbstractRead, markCarriedRead } from '../abstract-const.js';
import { carriedOf, markInferredRead } from '../use-inference.js';
import { inferredFieldOf } from '../structs.js';
import ts from 'typescript';
import { logicalTypeKey as typeKey } from '../optional.js';
import type { Expr } from '../../../core/ir/nodes.js';
import type { ShaderType } from '../../../core/ir/types.js';
import { f32T, i32T, structT } from '../../../core/ir/types.js';
import type { TsCompilerDiagnostic } from '../source-file.js';
import { authorTypeText, irNameOf, writtenText, type LoweringScope } from '../context.js';
import { kernelStaticReadNames } from '../kernel-loops.js';
import {
  MATH_MEMBER_NAMES,
  resolveMathConst,
  resolveMathExpand,
  resolveMathFn,
} from '../math-alias.js';
import { emittedMemberName, isPrivateName } from '../class-names.js';
import { classFunctionOf, methodFnName } from './class-methods.js';
import {
  checkFieldAccess,
  checkPrivateStatic,
  checkStaticFieldAccess,
  inheritedPrivateStaticField,
  lowerAccessorRead,
  lowerSuperAccessorRead,
  staticFieldRead,
  staticOwnerOf,
  visibleField,
} from './class-access.js';
import { parseSwizzle } from '../swizzle.js';
import { declaredTypeNamesOf, isLibraryTypeName } from '../type-map.js';
import { numericMismatch } from '../numeric.js';
import { reportIntLitRange, retargetIntLitCtx } from '../lit-coerce.js';
import { recordKeyText, recordOf, type RecordKeys } from '../key-types.js';
import { foldConstValue } from '../loop-bound.js';
import { lowerExpression, placeOf } from './expression.js';
import {
  continuesOptionalChain,
  lowerOptionalChain,
  lowerOptionalMember,
  refuseOptionalUse,
} from './optional-values.js';
import { absentOf, isOmittableField, optionalInner } from '../optional.js';
import { refuseBareAtomic } from './atomics.js';
import { builtinResultType } from '../../../core/builtins/resolve.js';
import { isArrayMethod, otherArrayMethod } from './array-methods.js';
import { makeDiagnostic } from '../diagnostic.js';
import { TS_CODES, type TsCode } from '../codes.js';
import { enumMemberNames, staticMemberNames, unknownNameSentence } from '../unknown-names.js';
import { staticFieldRefused } from '../refused-names.js';
import { lowerCollectionSize } from './collections.js';

const JS_ARRAY_METHODS = new Set([
  'map',
  'filter',
  'reduce',
  'forEach',
  'find',
  'some',
  'every',
  'flat',
  'flatMap',
  'slice',
  'concat',
  'includes',
  'indexOf',
  'join',
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'sort',
  'reverse',
]);

export { JS_ARRAY_METHODS };

export function storageRooted(e: Expr, scope: LoweringScope): boolean {
  return rootedIn(e, scope, ['storage']);
}

export function rootedIn(e: Expr, scope: LoweringScope, spaces: readonly string[]): boolean {
  switch (e.op) {
    case 'param': {
      const b = scope.resolveIr(e.name);
      return b?.kind === 'param' && b.space !== undefined && spaces.includes(b.space);
    }
    case 'varref': {
      const b = scope.resolveIr(e.name);
      if (b === undefined) return false;
      if (b.space !== undefined && spaces.includes(b.space)) return true;
      return b.aliasOf !== undefined && rootedIn({ ...e, name: b.aliasOf }, scope, spaces);
    }
    case 'member':
      return rootedIn(e.base, scope, spaces);
    case 'index':
      return rootedIn(e.base, scope, spaces);
    default:
      return false;
  }
}

export function arrayLengthOf(
  base: Expr,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  if (base.type.kind !== 'array' || base.type.size !== undefined) {
    throw new Error('arrayLengthOf takes an array with no size');
  }
  if (!storageRooted(base, scope)) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `".length" on an array with no size is not known at compile time. Give the type a size: array<f32, 3> rather than array<f32>.`,
      TS_CODES.UNSIZED_ARRAY_LENGTH,
    );
    return undefined;
  }
  const type = builtinResultType('arrayLength', [base.type]);
  if (type === undefined)
    throw new Error('arrayLength: core.def has no row for a runtime-sized array');
  return { op: 'call', type, fn: 'arrayLength', args: [base] };
}

export function lowerPropertyAccess(
  node: ts.PropertyAccessExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  if (node.questionDotToken !== undefined || continuesOptionalChain(node.expression)) {
    return lowerOptionalChain(node, sourceFile, scope, diagnostics, () =>
      lowerPropertyAccessOf(node, sourceFile, scope, diagnostics),
    );
  }
  return lowerPropertyAccessOf(node, sourceFile, scope, diagnostics);
}

function lowerPropertyAccessOf(
  node: ts.PropertyAccessExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const obj = node.expression;
  const prop = node.name.text;
  if (ts.isIdentifier(obj) && obj.text === 'Math') {
    const value = resolveMathConst(prop);
    if (value !== undefined) return { op: 'lit', type: f32T, value };
    if (resolveMathFn(prop) || resolveMathExpand(prop)) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `"Math.${prop}" is a function alias. Call it.`,
        TS_CODES.UNSUPPORTED,
      );
      return undefined;
    }
    pushDiag(
      diagnostics,
      sourceFile,
      node.name,
      unknownNameSentence(`"Math.${prop}" is not a TypeShade alias.`, prop, [MATH_MEMBER_NAMES]),
      TS_CODES.UNKNOWN_NAME,
    );
    return undefined;
  }
  if (obj.kind === ts.SyntaxKind.SuperKeyword) {
    return lowerSuperAccessorRead(node, sourceFile, scope, diagnostics);
  }
  const owner = staticOwnerOf(obj, scope);
  if (owner !== undefined) {
    const read = staticFieldRead(owner, prop, scope, sourceFile);
    const binding = read?.binding;
    if (read !== undefined && binding !== undefined) {
      if (!checkPrivateStatic(owner, prop, node.name, sourceFile, diagnostics, scope)) {
        return undefined;
      }
      const at = node.name;
      if (!checkStaticFieldAccess(read.declaredOn, prop, at, sourceFile, scope, diagnostics)) {
        return undefined;
      }
      const ref: Expr =
        binding.kind === 'modvar'
          ? markInferredRead(
              markCarriedRead(
                { op: 'varref', type: binding.type, name: irNameOf(binding) },
                node,
                carriedOf(undefined, binding.inferred),
              ),
              node,
              binding.inferred,
            )
          : markAbstractRead(
              { op: 'constref', type: binding.type, name: binding.name },
              node,
              binding.abstract,
            );
      kernelStaticReadNames.set(ref, writtenText(node).replace(/\s+/g, ' ').trim());
      return ref;
    }
    if (scope.structByName(owner) !== undefined) {
      const read = lowerAccessorRead(node, owner, undefined, sourceFile, scope, diagnostics);
      if (read !== 'none') return read;
    }
    if (
      obj.kind === ts.SyntaxKind.ThisKeyword &&
      scope.fieldType(owner, emittedMemberName(prop)) !== undefined
    ) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `In a static member, "this" is the class "${owner}", and "${prop}" is a field of each ` +
          `${owner} value, not of the class. Take the value as a parameter, or make the member ` +
          `an instance method.`,
        TS_CODES.CLASS_MEMBER,
      );
      return undefined;
    }
    const inheritedPrivate = inheritedPrivateStaticField(owner, prop, scope, sourceFile);
    if (inheritedPrivate !== undefined) {
      pushDiag(diagnostics, sourceFile, node, inheritedPrivate, TS_CODES.CLASS_MEMBER);
      return undefined;
    }
    if (scope.declarationRefused(`${owner}_${emittedMemberName(prop)}`)) return undefined;
    if (scope.structByName(owner) !== undefined) {
      if (
        [owner, ...scope.ancestorsOf(owner)].some((c) =>
          staticFieldRefused(c, prop, sourceFile, diagnostics),
        )
      ) {
        return undefined;
      }
      const fn = scope.resolveCallee(methodFnName(owner, emittedMemberName(prop)));
      const asFunction = fn !== undefined && classFunctionOf(fn)?.member === prop;
      pushDiag(
        diagnostics,
        sourceFile,
        asFunction ? node : node.name,
        asFunction
          ? `"${owner}.${prop}" is a function; call it: ${owner}.${prop}(...).`
          : unknownNameSentence(`"${owner}" has no static field "${prop}".`, prop, [
              [owner, ...scope.ancestorsOf(owner)].flatMap((c) => staticMemberNames(c, sourceFile)),
            ]),
        TS_CODES.UNKNOWN_NAME,
      );
      return undefined;
    }
    if (scope.isEnum(owner)) {
      pushDiag(
        diagnostics,
        sourceFile,
        node.name,
        unknownNameSentence(`"${owner}" has no member "${prop}".`, prop, [
          enumMemberNames(owner, sourceFile),
        ]),
        TS_CODES.UNKNOWN_NAME,
      );
      return undefined;
    }
  }
  const base = lowerExpression(obj, sourceFile, scope, diagnostics);
  if (refuseOptionalUse(base, obj, sourceFile, diagnostics)) return undefined;
  if (!base) return undefined;
  const size = lowerCollectionSize(node, base, sourceFile, diagnostics);
  if (size !== 'not-a-collection') return size;
  const rec = recordOf(base.type);
  if (rec !== undefined) return recordMember(node, base, rec, prop, sourceFile, diagnostics);
  if (prop === 'length' && base.type.kind === 'array') {
    if (base.type.size === undefined) {
      return arrayLengthOf(base, node, sourceFile, scope, diagnostics);
    }
    return { op: 'lit', type: i32T, value: base.type.size };
  }
  if (JS_ARRAY_METHODS.has(prop) && base.type.kind === 'array') {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      isArrayMethod(prop)
        ? `".${prop}" is a method of the array, and a shader has no function values: call it ` +
            `where its value is needed, "${node.expression.getText(sourceFile)}.${prop}(…)".`
        : otherArrayMethod(prop),
      TS_CODES.UNSUPPORTED,
    );
    return undefined;
  }
  if (base.type.kind === 'struct') {
    const ft = visibleField(base.type.name, prop, node.name, scope);
    if (!ft) {
      const read = lowerAccessorRead(node, base.type.name, base, sourceFile, scope, diagnostics);
      if (read !== 'none') return read;
      if (scope.isWithheld(base.type.name, emittedMemberName(prop))) return undefined;
      if (
        scope.structByName(base.type.name) === undefined &&
        !declaredTypeNamesOf(sourceFile).has(base.type.name) &&
        !isLibraryTypeName(base.type.name)
      ) {
        return undefined;
      }
      if (scope.ancestorsOf(base.type.name).some((a) => scope.structByName(a) === undefined)) {
        return undefined;
      }
      const hidden = isPrivateName(prop)
        ? scope.privateField(base.type.name, emittedMemberName(prop))
        : undefined;
      const owner = hidden?.owner.name?.text ?? base.type.name;
      pushDiag(
        diagnostics,
        sourceFile,
        hidden !== undefined ? node : node.name,
        hidden !== undefined && hidden.written === prop
          ? `"${prop}" is private to "${owner}", and this code is outside its class body. Reach ` +
              `it through a member "${owner}" declares without the "#".`
          : unknownNameSentence(`Unknown field "${prop}" on ${authorTypeText(base.type)}.`, prop, [
              publicFieldNames(base.type.name, scope),
            ]),
        hidden !== undefined ? TS_CODES.CLASS_MEMBER : TS_CODES.UNKNOWN_NAME,
      );
      return undefined;
    }
    if (!checkFieldAccess(base.type.name, prop, node.name, sourceFile, scope, diagnostics)) {
      return undefined;
    }
    if (refuseBareAtomic(ft, node, sourceFile, scope, diagnostics)) return undefined;
    const field = emittedMemberName(prop);
    const inferred = [base.type.name, ...scope.ancestorsOf(base.type.name)]
      .map((n) => inferredFieldOf(sourceFile, n, field))
      .find((v) => v !== undefined);
    return lowerOptionalMember(
      node,
      markInferredRead(
        markCarriedRead(
          { op: 'member', type: ft, base, field },
          node,
          carriedOf(undefined, inferred),
        ),
        node,
        inferred,
      ),
      sourceFile,
    );
  }
  const sw = parseSwizzle(base.type, prop);
  if (!sw.ok) {
    pushDiag(diagnostics, sourceFile, node, sw.message, TS_CODES.UNKNOWN_NAME);
    return undefined;
  }
  return { op: 'member', type: sw.type, base, field: sw.field };
}

export function lowerObjectLiteral(
  node: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
  contextual?: ShaderType,
): Expr | undefined {
  const rec = recordOf(contextual);
  if (rec !== undefined) {
    return lowerRecordLiteral(node, contextual!, rec, sourceFile, scope, diagnostics);
  }
  const props: LiteralProp[] = [];
  for (const prop of node.properties) {
    if (ts.isSpreadAssignment(prop)) {
      const spread = lowerSpreadInto(prop, sourceFile, scope, diagnostics);
      if (!spread) return undefined;
      props.push(...spread);
      continue;
    }
    if (ts.isShorthandPropertyAssignment(prop)) {
      if (prop.objectAssignmentInitializer) {
        pushDiag(
          diagnostics,
          sourceFile,
          prop,
          `"${prop.name.text} = ..." is a destructuring default, not a field value. Write "${prop.name.text}: ..." instead.`,
          TS_CODES.UNSUPPORTED,
        );
        return undefined;
      }
      props.push({ name: prop.name.text, value: prop.name, key: prop.name });
      continue;
    }
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) {
      pushDiag(
        diagnostics,
        sourceFile,
        prop,
        'Object literals must use identifier fields, e.g. { pos: vec4(...) }.',
        TS_CODES.UNSUPPORTED,
      );
      return undefined;
    }
    props.push({ name: prop.name.text, value: prop.initializer, key: prop.name });
  }
  const names = props.map((p) => p.name);
  const declared = contextual?.kind === 'struct' ? scope.structByName(contextual.name) : undefined;
  const hidden = declared === undefined ? undefined : scope.hiddenFieldOf(declared.name);
  if (declared !== undefined && hidden !== undefined) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `"${authorTypeText(structT(declared.name))}" has the ${hidden.access} field ` +
        `"${hidden.written}", which an object literal cannot set. Build it with ` +
        `"new ${authorTypeText(structT(declared.name))}(...)".`,
      TS_CODES.STRUCT_FIELD,
    );
    return undefined;
  }
  const match = declared ?? scope.matchStruct(names);
  if (!match) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `Object literal { ${names.join(', ')} } does not match a known struct.`,
      TS_CODES.UNKNOWN_NAME,
    );
    return undefined;
  }
  const written = authorTypeText(structT(match.name));
  const withheld = (p: LiteralProp): boolean =>
    declared !== undefined &&
    !('ready' in p) &&
    scope.isWithheld(match.name, emittedMemberName(p.name));
  if (declared) {
    for (const p of props) {
      if (match.fields.some((f) => f.name === p.name)) continue;
      if (withheld(p)) continue;
      if ('ready' in p) {
        pushDiag(
          diagnostics,
          sourceFile,
          p.at,
          `Struct ${written} has no field "${p.name}", which this spread brings in.`,
          TS_CODES.STRUCT_FIELD,
        );
        return undefined;
      }
      pushDiag(
        diagnostics,
        sourceFile,
        p.key,
        unknownNameSentence(`Struct ${written} has no field "${p.name}".`, p.name, [
          match.fields.map((f) => f.name),
        ]),
        TS_CODES.STRUCT_FIELD,
      );
      return undefined;
    }
  }
  const fieldType = new Map(match.fields.map((f) => [f.name, f.type]));
  const given: { name: string; expr: Expr; node: ts.Expression | undefined }[] = [];
  for (const p of props) {
    if ('ready' in p) {
      given.push({ name: p.name, expr: p.ready, node: undefined });
      continue;
    }
    if (withheld(p)) continue;
    const expr = lowerExpression(p.value, sourceFile, scope, diagnostics, fieldType.get(p.name));
    if (!expr) return undefined;
    given.push({ name: p.name, expr, node: p.value });
  }
  const byName = new Map(given.map((g) => [g.name, g.expr]));
  const nodeByName = new Map(given.map((g) => [g.name, g.node]));
  const args: Expr[] = [];
  for (const field of match.fields) {
    const named = byName.get(field.name);
    const namedNode = nodeByName.get(field.name);
    const retargeted = named && namedNode ? retargetIntLitCtx(named, namedNode, field.type) : named;
    const expr =
      retargeted && namedNode
        ? (reportIntLitRange(retargeted, namedNode, field.type, sourceFile, diagnostics) ??
          retargeted)
        : retargeted;
    if (!expr) {
      const inner = optionalInner(field.type);
      if (inner !== undefined && isOmittableField(sourceFile, match.name, field.name)) {
        args.push(absentOf(field.type, inner, (n) => scope.structByName(n)));
        continue;
      }
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `Missing field "${field.name}" for struct ${written}.`,
        TS_CODES.STRUCT_FIELD,
      );
      return undefined;
    }
    if (typeKey(expr.type) !== typeKey(field.type)) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        numericMismatch(`field ${written}.${field.name}`, field.type, expr.type),
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    }
    args.push(expr);
  }
  return { op: 'construct', type: structT(match.name), args };
}

export function publicFieldNames(struct: string, scope: LoweringScope): string[] {
  return (scope.structByName(struct)?.fields ?? [])
    .filter((f) => scope.privateField(struct, f.name) === undefined)
    .map((f) => f.name);
}

type LiteralProp =
  | { readonly name: string; readonly value: ts.Expression; readonly key: ts.Node }
  | { readonly name: string; readonly ready: Expr; readonly at: ts.Node };

function isPureRead(e: Expr): boolean {
  switch (e.op) {
    case 'varref':
    case 'param':
    case 'constref':
    case 'overrideref':
      return true;
    case 'member':
      return isPureRead(e.base);
    default:
      return false;
  }
}

function lowerSpreadInto(
  prop: ts.SpreadAssignment,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): LiteralProp[] | undefined {
  const value = lowerExpression(prop.expression, sourceFile, scope, diagnostics);
  if (!value) return undefined;
  if (value.type.kind !== 'struct') {
    pushDiag(
      diagnostics,
      sourceFile,
      prop,
      `"..." spreads the fields of a struct, and ${authorTypeText(value.type)} has none. Write the ` +
        `components by name.`,
      TS_CODES.UNSUPPORTED,
    );
    return undefined;
  }
  if (!isPureRead(value)) {
    pushDiag(
      diagnostics,
      sourceFile,
      prop,
      `"..." reads its value once per field, so it takes a name or a field of one; this would ` +
        `run again for every field. Bind it to a const first.`,
      TS_CODES.UNSUPPORTED,
    );
    return undefined;
  }
  const struct = scope.structByName(value.type.name);
  if (!struct) {
    pushDiag(
      diagnostics,
      sourceFile,
      prop,
      `"${value.type.name}" is not a struct this module emits, so its fields cannot be spread.`,
      TS_CODES.UNKNOWN_NAME,
    );
    return undefined;
  }
  return struct.fields
    .filter(
      (f) =>
        scope.privateField(struct.name, f.name) === undefined &&
        scope.restrictedField(struct.name, f.name) === undefined,
    )
    .map((f) => ({
      name: f.name,
      ready: { op: 'member', type: f.type, base: value, field: f.name } as Expr,
      at: prop,
    }));
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

function recordMember(
  node: ts.PropertyAccessExpression,
  base: Expr,
  rec: RecordKeys,
  prop: string,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const id = rec.keys.indexOf(prop);
  if (id < 0) {
    pushDiag(
      diagnostics,
      sourceFile,
      node.name,
      `"${prop}" is not a key of this Record, whose keys are ${recordKeyText(rec)}.`,
      TS_CODES.UNKNOWN_NAME,
    );
    return undefined;
  }
  const elem = (base.type as { elem: ShaderType }).elem;
  return { op: 'index', type: elem, base, idx: { op: 'lit', type: rec.key, value: id } };
}

function lowerRecordLiteral(
  node: ts.ObjectLiteralExpression,
  t: ShaderType,
  rec: RecordKeys,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const elem = (t as { elem: ShaderType }).elem;
  const values = new Map<string, ts.Expression>();
  for (const prop of node.properties) {
    let name =
      ts.isPropertyAssignment(prop) &&
      (ts.isIdentifier(prop.name) ||
        ts.isStringLiteral(prop.name) ||
        (rec.numeric === true && ts.isNumericLiteral(prop.name)))
        ? prop.name.text
        : ts.isShorthandPropertyAssignment(prop) && prop.objectAssignmentInitializer === undefined
          ? prop.name.text
          : undefined;
    if (
      rec.numeric === true &&
      ts.isPropertyAssignment(prop) &&
      ts.isComputedPropertyName(prop.name)
    ) {
      const expr = lowerExpression(prop.name.expression, sourceFile, scope, diagnostics);
      if (expr === undefined) return undefined;
      const value = foldConstValue(expr, scope);
      if (typeof value === 'number' && Number.isInteger(value)) name = String(value);
    }
    if (name === undefined) {
      pushDiag(
        diagnostics,
        sourceFile,
        prop,
        `A Record is written as an object literal of its keys, { key: value, ... }.`,
        TS_CODES.UNSUPPORTED,
      );
      return undefined;
    }
    if (!rec.keys.includes(name)) {
      pushDiag(
        diagnostics,
        sourceFile,
        prop,
        `"${name}" is not a key of this Record, whose keys are ${recordKeyText(rec)}.`,
        TS_CODES.STRUCT_FIELD,
      );
      return undefined;
    }
    if (values.has(name)) {
      pushDiag(
        diagnostics,
        sourceFile,
        prop,
        `"${name}" is written twice in this Record.`,
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    }
    values.set(
      name,
      ts.isPropertyAssignment(prop) ? prop.initializer : (prop.name as ts.Identifier),
    );
  }
  const missing = rec.keys.filter((k) => !values.has(k));
  if (missing.length > 0) {
    pushDiag(
      diagnostics,
      sourceFile,
      placeOf(node),
      `This Record has no value for ${missing.map((k) => JSON.stringify(k)).join(', ')}: a ` +
        `Record holds one value for each of its keys.`,
      TS_CODES.TYPE_MISMATCH,
    );
    return undefined;
  }
  const args: Expr[] = [];
  for (const k of rec.keys) {
    const v = values.get(k)!;
    const lowered = lowerExpression(v, sourceFile, scope, diagnostics, elem);
    if (!lowered) return undefined;
    const fixed = retargetIntLitCtx(lowered, v, elem);
    if (typeKey(fixed.type) !== typeKey(elem)) {
      pushDiag(
        diagnostics,
        sourceFile,
        v,
        `The value for ${JSON.stringify(k)} is ${authorTypeText(fixed.type)}, and this Record ` +
          `holds ${authorTypeText(elem)}.`,
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    }
    args.push(fixed);
  }
  return { op: 'construct', type: t, args };
}
