import ts from 'typescript'
import type { Expr } from '../../../core/ir/nodes.js'
import type { ShaderType } from '../../../core/ir/types.js'
import { f32T, i32T, structT, typeKey, u32T } from '../../../core/ir/types.js'
import type { TsCompilerDiagnostic } from '../source-file.js'
import type { LoweringScope } from '../context.js'
import { resolveMathConst, resolveMathExpand, resolveMathFn } from '../math-alias.js'
import { staticConstName } from '../module-const.js'
import { methodFnName } from './class-methods.js'
import { parseSwizzle } from '../swizzle.js'
import { numericMismatch } from '../numeric.js'
import { retargetIntLitCtx } from '../lit-coerce.js'
import { lowerExpression } from './expression.js'
import { refuseBareAtomic } from './atomics.js'
import { makeDiagnostic } from '../diagnostic.js'
import { TS_CODES, type TsCode } from '../codes.js'

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
])

export { JS_ARRAY_METHODS }

/** Whether `e` bottoms out in a STORAGE resource binding — the binding itself, a field of one,
 *  or an element of one. Only that shape gets the `arrayLength` sentence, because only that
 *  shape is what `arrayLength` accepts (`ptr<storage, array<E>, AM>`); a `uniform<array<T>>`,
 *  a local or a parameter needs an explicit `N` instead. */
export function storageRooted(e: Expr, scope: LoweringScope): boolean {
  return rootedIn(e, scope, ['storage'])
}

/** Whether `e` bottoms out in a module-level name declared in one of `spaces`: a binding or a
 *  module variable, a field of one, or an element of one. The atomic builtins ask for
 *  `['storage', 'workgroup']`, the two spaces WGSL allows an atomic in (§23, §24). */
export function rootedIn(e: Expr, scope: LoweringScope, spaces: readonly string[]): boolean {
  switch (e.op) {
    case 'varref': {
      // A local that copies a binding (`const a = src`) denotes what the binding denotes; the
      // chain is followed rather than stopped at the local, which answered "give it a size"
      // for a runtime-sized storage array the author could not size (#46).
      const b = scope.resolveIr(e.name)
      if (b === undefined) return false
      if (b.space !== undefined && spaces.includes(b.space)) return true
      return b.aliasOf !== undefined && rootedIn({ ...e, name: b.aliasOf }, scope, spaces)
    }
    case 'member':
      return rootedIn(e.base, scope, spaces)
    case 'index':
      return rootedIn(e.base, scope, spaces)
    default:
      return false
  }
}

/** The `arrayLength(&x)` call for `base`, or a diagnostic and `undefined` when `base` is not
 *  what the builtin takes. WGSL's `arrayLength` accepts exactly a pointer to a runtime-sized
 *  array in the storage space, which is the binding itself or a trailing struct member;
 *  measured on Tint, `arrayLength(&src[0])` is refused and `arrayLength(&b.xs)` accepted. Shared
 *  by `.length` on such an array and by the explicit `arrayLength(x)` call, so the two forms
 *  agree about what they accept and what they say (#46). The result is `u32`, as it is in WGSL.
 *  The CPU oracle reads the bound buffer's length. GLSL ES 3.00 has no form: a module with a
 *  runtime-sized storage array emits WGSL alone, as it did before this. */
export function arrayLengthOf(
  base: Expr,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
  spelled: '.length' | 'arrayLength',
): Expr | undefined {
  if (base.type.kind !== 'array') {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `arrayLength takes a runtime-sized storage array, not a ${typeKey(base.type)}.`,
      TS_CODES.TYPE_MISMATCH,
    )
    return undefined
  }
  if (base.type.size !== undefined) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `arrayLength takes a runtime-sized array; this one has a fixed size of ${base.type.size}. Write ${base.type.size}, or read ".length".`,
      TS_CODES.TYPE_MISMATCH,
    )
    return undefined
  }
  if (!storageRooted(base, scope)) {
    // The guard fires on FOUR shapes, and only the storage one has a runtime length. `arrayLength`
    // is spelled `ptr<storage, array<E>, AM>` and exists for nothing else, so naming it to the
    // author of a local `array<f32>(1., 2., 3.)` or a `uniform<array<f32>>` sends them to an
    // intrinsic Tint would refuse on their program, and never tells them the one fix that does
    // work: write the `N`. Both shapes were already invalid GPU code (Tint: "cannot construct a
    // runtime-sized array"; "runtime-sized arrays can only be used in the <storage> address
    // space"), so rejecting them is right; it is only the advice that has to be true.
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      spelled === '.length'
        ? `".length" on an array with no size is not known at compile time. Give the type a size: array<f32, 3> rather than array<f32>.`
        : `arrayLength takes a runtime-sized array in storage; this one is not in storage, so it has no runtime length. Give the type a size: array<f32, 3> rather than array<f32>.`,
      TS_CODES.UNSIZED_ARRAY_LENGTH,
    )
    return undefined
  }
  return { op: 'call', type: u32T, fn: 'arrayLength', args: [base] }
}

export function lowerPropertyAccess(
  node: ts.PropertyAccessExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const obj = node.expression
  const prop = node.name.text
  if (ts.isIdentifier(obj) && obj.text === 'Math') {
    const value = resolveMathConst(prop)
    if (value !== undefined) return { op: 'lit', type: f32T, value }
    if (resolveMathFn(prop) || resolveMathExpand(prop)) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `"Math.${prop}" is a function alias. Call it.`,
        TS_CODES.UNSUPPORTED,
      )
      return undefined
    }
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `"Math.${prop}" is not a TypeShade alias.`,
      TS_CODES.UNKNOWN_NAME,
    )
    return undefined
  }
  // `K.PI` on a class name: a static field is the module constant `K_PI` the collector made
  // of it (roadmap 0.3 item T3, #92). Read before the receiver is lowered, because a class
  // name is a type and not a value, so lowering it would report an unknown identifier.
  if (ts.isIdentifier(obj) && scope.resolve(obj.text) === undefined) {
    const binding = scope.resolve(staticConstName(obj.text, prop))
    if (binding?.kind === 'module') {
      return { op: 'constref', type: binding.type, name: binding.name }
    }
    // The name is a type, not a value, so lowering the receiver would report an unknown
    // identifier. Say what it is instead, when it is a class or an enum the file declares.
    if (scope.structByName(obj.text) !== undefined) {
      const asFunction = scope.resolveCallee(methodFnName(obj.text, prop)) !== undefined
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        asFunction
          ? `"${obj.text}.${prop}" is a function; call it: ${obj.text}.${prop}(...).`
          : `"${obj.text}" has no static field "${prop}".`,
        TS_CODES.UNKNOWN_NAME,
      )
      return undefined
    }
    if (scope.isEnum(obj.text)) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `"${obj.text}" has no member "${prop}".`,
        TS_CODES.UNKNOWN_NAME,
      )
      return undefined
    }
  }
  const base = lowerExpression(obj, sourceFile, scope, diagnostics)
  if (!base) return undefined
  if (prop === 'length' && base.type.kind === 'array') {
    // `?? 0` used to be the whole of this line, and 0 is not a length — it is the absence of
    // one. A runtime-sized array carries no `size`, so the standard bounds guard folded to
    // `if (gid.x >= 0u) { return; }`, which is TRUE for every unsigned invocation: the kernel
    // returned immediately and wrote nothing, with zero diagnostics, as valid WGSL, on a real
    // GPU (#46). A runtime-sized STORAGE array now reads its length from the buffer, as
    // `arrayLength(&x)`, a `u32`; every other unsized shape is refused with the one fix that
    // works for it, and the sized array stays the compile-time `i32` it always was.
    if (base.type.size === undefined) {
      return arrayLengthOf(base, node, sourceFile, scope, diagnostics, '.length')
    }
    return { op: 'lit', type: i32T, value: base.type.size }
  }
  if (JS_ARRAY_METHODS.has(prop)) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `JS Array method ".${prop}" is not a shader op. Use sum/min/any/all/zip/fill.`,
      TS_CODES.UNSUPPORTED,
    )
    return undefined
  }
  if (base.type.kind === 'struct') {
    const ft = scope.fieldType(base.type.name, prop)
    if (!ft) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `Unknown field "${prop}" on ${typeKey(base.type)}.`,
        TS_CODES.UNKNOWN_NAME,
      )
      return undefined
    }
    if (refuseBareAtomic(ft, node, sourceFile, scope, diagnostics)) return undefined
    return { op: 'member', type: ft, base, field: prop }
  }
  const sw = parseSwizzle(base.type, prop)
  if (!sw.ok) {
    pushDiag(diagnostics, sourceFile, node, sw.message, TS_CODES.UNKNOWN_NAME)
    return undefined
  }
  return { op: 'member', type: sw.type, base, field: sw.field }
}

/**
 * Lower `{ pos: …, uv: … }` into the `construct` of the struct it builds.
 *
 * WHICH struct comes from `contextual` when the position declares one — a function's return
 * type, a `let`/`const` annotation, a parameter type (#8 A11). Matching the field NAMES
 * against the struct table is the fallback for a position that declares nothing, and it is
 * only a fallback because it cannot answer at all when two structs have the same shape: a
 * vertex `VsOut` and a fragment `FsIn` with the same fields made `return { pos, uv }` an
 * error in a function that says exactly which one it returns.
 *
 * A contextual type that is not a struct is ignored rather than reported here: the mismatch
 * belongs to the position's own type check, which says what was declared and what it got.
 *
 * @param contextual - the type the position declares, if it declares one.
 * @returns the `construct`, or `undefined` after pushing a diagnostic.
 */
export function lowerObjectLiteral(
  node: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
  contextual?: ShaderType,
): Expr | undefined {
  // The struct is resolved BEFORE the initializers are lowered, so each one can be lowered
  // against the type of the field it fills. That is what carries the context inward: a nested
  // `{ i: { x: 1. } }` used to lower its inner literal with nothing, so a twin at the inner
  // level was as unresolvable as the outer one was before this item.
  // A property is either written here, and lowered below once the field's type is known, or
  // it came from a spread and is already the read it stands for (roadmap 0.3 item T7, #92).
  const props: LiteralProp[] = []
  for (const prop of node.properties) {
    // `{ ...p, y: 1. }` is the fields of `p` with `y` written over one of them, so it spreads
    // to one read per field of `p`'s struct, in that struct's order. Later wins, which is
    // TypeScript's rule and already how a repeated field is taken below.
    if (ts.isSpreadAssignment(prop)) {
      const spread = lowerSpreadInto(prop, sourceFile, scope, diagnostics)
      if (!spread) return undefined
      props.push(...spread)
      continue
    }
    // `{ pos, uv }` is `{ pos: pos, uv: uv }` — the shorthand TypeScript gives a property
    // whose value is its own name, and the shape `return { pos, uv }` is written in (#8 A10).
    // The name is the field and the same identifier is the value, so it lowers through the
    // ordinary identifier path and reaches matchStruct exactly as the long form does.
    if (ts.isShorthandPropertyAssignment(prop)) {
      // `{ a = 1. }` parses as a shorthand carrying an "object assignment initializer", which
      // is only legal in a destructuring PATTERN. TypeScript itself reports it in an
      // expression, but this surface does not run the checker, so without this the `= 1.` was
      // read as nothing at all and the field silently took the value of `a`.
      if (prop.objectAssignmentInitializer) {
        pushDiag(
          diagnostics,
          sourceFile,
          prop,
          `"${prop.name.text} = ..." is a destructuring default, not a field value. Write "${prop.name.text}: ..." instead.`,
          TS_CODES.UNSUPPORTED,
        )
        return undefined
      }
      // The value IS the name, so it joins the list like any other — the struct is resolved
      // before any of them is lowered.
      props.push({ name: prop.name.text, value: prop.name })
      continue
    }
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) {
      pushDiag(
        diagnostics,
        sourceFile,
        prop,
        'Object literals must use identifier fields, e.g. { pos: vec4(...) }.',
        TS_CODES.UNSUPPORTED,
      )
      return undefined
    }
    props.push({ name: prop.name.text, value: prop.initializer })
  }
  const names = props.map((p) => p.name)
  const declared = contextual?.kind === 'struct' ? scope.structByName(contextual.name) : undefined
  const match = declared ?? scope.matchStruct(names)
  if (!match) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `Object literal { ${names.join(', ')} } does not match a known struct.`,
      TS_CODES.UNKNOWN_NAME,
    )
    return undefined
  }
  // Only where the struct is DECLARED. On the fallback path `matchStruct` has already equated
  // the struct's field count with the literal's UNIQUE name count and checked that every field
  // is among those names, so a name it does not have cannot reach here — and the count guard
  // that used to stand beside this could fire on one input alone, a REPEATED field.
  // `const o = { a: 1., a: 2., b: 3. }` emitted `P(2.0, 3.0)` before this item and would have
  // been refused after it, while the same literal in a return position stayed accepted. A
  // repeated field is TypeScript's own TS1117 and the editor says so; the compiler keeps
  // taking the last, in every position, as it always did.
  if (declared) {
    for (const p of props) {
      if (match.fields.some((f) => f.name === p.name)) continue
      if ('ready' in p) {
        // A spread of a struct the target does not have every field of: the literal names a
        // field the struct has not got, and says which, rather than "does not match".
        pushDiag(
          diagnostics,
          sourceFile,
          p.at,
          `Struct ${match.name} has no field "${p.name}", which this spread brings in.`,
          TS_CODES.STRUCT_FIELD,
        )
        return undefined
      }
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `Struct ${match.name} has no field "${p.name}".`,
        TS_CODES.STRUCT_FIELD,
      )
      return undefined
    }
  }
  const fieldType = new Map(match.fields.map((f) => [f.name, f.type]))
  const given: { name: string; expr: Expr; node: ts.Expression | undefined }[] = []
  for (const p of props) {
    if ('ready' in p) {
      given.push({ name: p.name, expr: p.ready, node: undefined })
      continue
    }
    const expr = lowerExpression(p.value, sourceFile, scope, diagnostics, fieldType.get(p.name))
    if (!expr) return undefined
    given.push({ name: p.name, expr, node: p.value })
  }
  const byName = new Map(given.map((g) => [g.name, g.expr]))
  const nodeByName = new Map(given.map((g) => [g.name, g.node]))
  const args: Expr[] = []
  for (const field of match.fields) {
    // `{ id: 0 }` takes the field's type when it is i32 or u32 (#8 A3). Distinct from the
    // context this item passes down: that decides which STRUCT a nested literal builds, this
    // retypes an integer literal once the field's own type is known. Both need the struct
    // resolved first, which is why they sit on the same side of that decision.
    const named = byName.get(field.name)
    const namedNode = nodeByName.get(field.name)
    const expr = named && namedNode ? retargetIntLitCtx(named, namedNode, field.type) : named
    if (!expr) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `Missing field "${field.name}" for struct ${match.name}.`,
        TS_CODES.STRUCT_FIELD,
      )
      return undefined
    }
    if (typeKey(expr.type) !== typeKey(field.type)) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        numericMismatch(`field ${match.name}.${field.name}`, field.type, expr.type),
        TS_CODES.TYPE_MISMATCH,
      )
      return undefined
    }
    args.push(expr)
  }
  return { op: 'construct', type: structT(match.name), args }
}

/** One field of an object literal: written, and lowered once the field's type is known, or
 *  brought in by a spread and already the read it stands for. */
type LiteralProp =
  | { readonly name: string; readonly value: ts.Expression }
  | { readonly name: string; readonly ready: Expr; readonly at: ts.Node }

/** True when reading `e` again costs nothing and runs nothing: a name, a parameter, a module
 *  const, or a field of one. A spread reads its operand once per field, so anything else would
 *  run a second time, and a call twice. */
function isPureRead(e: Expr): boolean {
  switch (e.op) {
    case 'varref':
    case 'param':
    case 'constref':
    case 'overrideref':
      return true
    case 'member':
      return isPureRead(e.base)
    default:
      return false
  }
}

/** `...p` inside an object literal: the fields of `p`'s struct, each as a read of `p`
 *  (roadmap 0.3 item T7, #92).
 *
 *  Refused with the reason where a spread has no such form: an operand that is not a struct,
 *  since a vector's components are read by name and there is nothing else with fields; and an
 *  operand that is not a plain read, since the spread reads it once per field and a call would
 *  run once per field with it. */
function lowerSpreadInto(
  prop: ts.SpreadAssignment,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): LiteralProp[] | undefined {
  const value = lowerExpression(prop.expression, sourceFile, scope, diagnostics)
  if (!value) return undefined
  if (value.type.kind !== 'struct') {
    pushDiag(
      diagnostics,
      sourceFile,
      prop,
      `"..." spreads the fields of a struct, and ${typeKey(value.type)} has none. Write the ` +
        `components by name.`,
      TS_CODES.UNSUPPORTED,
    )
    return undefined
  }
  if (!isPureRead(value)) {
    pushDiag(
      diagnostics,
      sourceFile,
      prop,
      `"..." reads its value once per field, so it takes a name or a field of one; this would ` +
        `run again for every field. Bind it to a const first.`,
      TS_CODES.UNSUPPORTED,
    )
    return undefined
  }
  const struct = scope.structByName(value.type.name)
  if (!struct) {
    pushDiag(
      diagnostics,
      sourceFile,
      prop,
      `"${value.type.name}" is not a struct this module emits, so its fields cannot be spread.`,
      TS_CODES.UNKNOWN_NAME,
    )
    return undefined
  }
  return struct.fields.map((f) => ({
    name: f.name,
    ready: { op: 'member', type: f.type, base: value, field: f.name } as Expr,
    at: prop,
  }))
}

function pushDiag(
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
  node: ts.Node,
  message: string,
  code: TsCode,
): void {
  diagnostics.push(makeDiagnostic(sourceFile, node, message, code))
}
