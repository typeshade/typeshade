// Top-level resource declarations.
//   const scale = uniform<f32>()
//   declare const camera: uniform<Camera>

import ts from 'typescript'
import type { BindingDecl } from '../../core/ir/nodes.js'
import { structT } from '../../core/ir/types.js'
import type { TsCompilerDiagnostic } from './source-file.js'
import { mapTsTypeToShaderType, HANDLE_TYPE_NAMES } from './type-map.js'
import { atomicWithin } from './lower/atomics.js'
import { recordDeclaration, type DeclaredSymbolSink } from './symbols.js'
import { isOverrideType } from './overrides.js'
import { TS_CODES } from './codes.js'
import { makeDiagnostic } from './diagnostic.js'

/** The type names that are a resource HANDLE rather than a buffer: written bare in a
 *  `declare const`, with no address-space wrapper. `sampler` and the texture names are the
 *  whole set — {@link mapTsTypeToShaderType} owns what each one maps to. */
export function isResourceCall(expr: ts.Expression): expr is ts.CallExpression {
  return (
    ts.isCallExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    (expr.expression.text === 'uniform' || expr.expression.text === 'storage')
  )
}

export function collectBindings(
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  symbols?: DeclaredSymbolSink,
): BindingDecl[] {
  const out: BindingDecl[] = []
  let next = 0
  for (const stmt of sourceFile.statements) {
    if (!ts.isVariableStatement(stmt)) continue
    const isConst = (stmt.declarationList.flags & ts.NodeFlags.Const) !== 0
    const isLet = (stmt.declarationList.flags & ts.NodeFlags.Let) !== 0
    if (!isConst && !isLet) continue
    const declared = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword) ?? false
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name)) continue
      if (decl.initializer && isResourceCall(decl.initializer)) {
        const b = fromCall(decl.name.text, decl.initializer, isConst, sourceFile, diagnostics, next)
        if (b) {
          out.push(b)
          recordDeclaration(symbols, sourceFile, decl.name, {
            name: b.name,
            kind: 'binding',
            type: b.type,
            mutable: !isConst,
          })
          next = Math.max(next, b.binding + 1)
        }
        continue
      }
      // An override occupies no bind slot, so it must not take a binding number on the way
      // past — overrides.ts collects it (#8 A7).
      if (isOverrideType(decl.type)) continue
      if (declared && decl.type) {
        const b = fromType(decl.name.text, decl.type, isConst, sourceFile, diagnostics, next)
        if (b) {
          out.push(b)
          recordDeclaration(symbols, sourceFile, decl.name, {
            name: b.name,
            kind: 'binding',
            type: b.type,
            mutable: !isConst,
          })
          next = Math.max(next, b.binding + 1)
        }
      }
    }
  }
  // A repeated NAME, reported here rather than thrown from the scope later. Two
  // `declare const tex` threw `Duplicate binding "tex" in current scope frame` out of
  // `compile()` and out of the language service's `getDiagnostics()`, so the editor raised an
  // exception where it had shown a squiggle.
  const names = new Set<string>()
  const duplicates: BindingDecl[] = []
  for (const b of out) {
    if (names.has(b.name)) {
      diagnostics.push(
        makeDiagnostic(
          sourceFile,
          undefined,
          `Duplicate resource "${b.name}".`,
          TS_CODES.DUPLICATE_SYMBOL,
        ),
      )
      duplicates.push(b)
      continue
    }
    names.add(b.name)
  }
  for (const b of duplicates) out.splice(out.indexOf(b), 1)
  const seen = new Map<string, string>()
  for (const b of out) {
    const key = `${b.group}:${b.binding}`
    const prev = seen.get(key)
    if (prev) {
      diagnostics.push(
        makeDiagnostic(
          sourceFile,
          undefined,
          `@binding(${b.binding}) in group ${b.group} is used by "${prev}" and "${b.name}".`,
          TS_CODES.UNSUPPORTED,
        ),
      )
    } else seen.set(key, b.name)
  }
  return out
}

function fromType(
  name: string,
  type: ts.TypeNode,
  isConst: boolean,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  autoBinding: number,
): BindingDecl | undefined {
  if (!ts.isTypeReferenceNode(type) || !ts.isIdentifier(type.typeName)) {
    diagnostics.push(
      diag(
        sourceFile,
        type,
        `declare "${name}" must be uniform<T>, storage<T>, a texture, a sampler or override<T>.`,
      ),
    )
    return undefined
  }
  const kind = type.typeName.text
  // A texture or a sampler is a HANDLE resource: it is written as the type itself, with no
  // uniform<> or storage<> wrapper, because it lives in no address space (#8 A7). It takes
  // the 'uniform' space the EDSL's `resource()` gives it — the field is not optional and
  // every backend keys the declaration off the TYPE, not off the space.
  if (HANDLE_TYPE_NAMES.has(kind)) {
    const handle = mapTsTypeToShaderType(type, sourceFile, diagnostics)
    if (!handle) return undefined
    if (!isConst) {
      diagnostics.push(diag(sourceFile, type, `"${name}" is a ${kind}; declare it const, not let.`))
      return undefined
    }
    return { group: 0, binding: autoBinding, name, space: 'uniform', type: handle }
  }
  if (kind !== 'uniform' && kind !== 'storage') {
    diagnostics.push(
      diag(
        sourceFile,
        type,
        `declare "${name}" must be uniform<T>, storage<T>, a texture, a sampler or override<T>.`,
      ),
    )
    return undefined
  }
  const inner = type.typeArguments?.[0]
  if (!inner) {
    diagnostics.push(diag(sourceFile, type, `${kind}<T> needs a type argument.`))
    return undefined
  }
  const mapped =
    mapTsTypeToShaderType(inner, sourceFile, diagnostics) ??
    (ts.isTypeReferenceNode(inner) && ts.isIdentifier(inner.typeName)
      ? structT(inner.typeName.text)
      : undefined)
  if (!mapped) return undefined
  // An atomic lives in storage memory only (WGSL §6.2.8): `uniform<array<atomic<u32>>>` is
  // refused here, where the address space is decided. A struct's fields are not looked into;
  // the struct collector has no address space to check them against.
  const atomic = kind === 'uniform' ? atomicWithin(mapped) : undefined
  if (atomic !== undefined) {
    diagnostics.push(
      diag(
        sourceFile,
        type,
        `"${name}" holds an atomic<${atomic.elem}>, which lives in storage memory only: ` +
          `write "declare let ${name}: storage<${inner.getText(sourceFile)}>".`,
      ),
    )
    return undefined
  }
  // A handle is written BARE — `declare const smp: sampler`. Wrapped, it was accepted and took
  // the wrapper's address space, which is not what either backend emits for one, and the doc
  // says bare. Caught here rather than in the type map, because this is the one path that
  // resolves a binding's declared type.
  if (mapped.kind === 'sampler' || mapped.kind === 'texture') {
    diagnostics.push(
      diag(
        sourceFile,
        type,
        `"${name}" is a ${mapped.kind === 'sampler' ? 'sampler' : 'texture'}; it is declared ` +
          `bare, not inside ${kind}<...>: write "declare const ${name}: ${inner.getText(sourceFile)}".`,
      ),
    )
    return undefined
  }
  return {
    group: 0,
    binding: autoBinding,
    name,
    space: kind === 'storage' ? 'storage' : 'uniform',
    access: kind === 'storage' ? (isConst ? 'read' : 'read_write') : undefined,
    type: mapped,
  }
}

function fromCall(
  name: string,
  call: ts.CallExpression,
  isConst: boolean,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  autoBinding: number,
): BindingDecl | undefined {
  const kind = ts.isIdentifier(call.expression) ? call.expression.text : ''
  const typeArg = call.typeArguments?.[0]
  if (!typeArg) {
    diagnostics.push(diag(sourceFile, call, `${kind}<T>() needs a type argument.`))
    return undefined
  }
  const type =
    mapTsTypeToShaderType(typeArg, sourceFile, diagnostics) ??
    (ts.isTypeReferenceNode(typeArg) && ts.isIdentifier(typeArg.typeName)
      ? structT(typeArg.typeName.text)
      : undefined)
  if (!type) return undefined
  if (kind === 'uniform' && !isConst) {
    diagnostics.push(
      diag(sourceFile, call, `uniform "${name}" must be const. Use const ${name} = uniform<T>().`),
    )
    return undefined
  }
  let group = 0
  let binding = autoBinding
  let access: 'read' | 'read_write' | undefined =
    kind === 'storage' ? (isConst ? 'read' : 'read_write') : undefined
  const arg0 = call.arguments[0]
  if (arg0 && ts.isNumericLiteral(arg0)) {
    binding = Number(arg0.text)
    if (call.arguments[1] && ts.isNumericLiteral(call.arguments[1])) {
      group = binding
      binding = Number(call.arguments[1].text)
    }
  } else if (arg0 && ts.isObjectLiteralExpression(arg0)) {
    const opt = parseOptions(arg0)
    if (opt.group !== undefined) group = opt.group
    if (opt.binding !== undefined) binding = opt.binding
    if (opt.access) access = kind === 'storage' ? opt.access : undefined
  }
  return { group, binding, name, space: kind === 'storage' ? 'storage' : 'uniform', access, type }
}

function parseOptions(obj: ts.ObjectLiteralExpression): {
  group?: number
  binding?: number
  access?: 'read' | 'read_write'
} {
  const out: { group?: number; binding?: number; access?: 'read' | 'read_write' } = {}
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue
    const key = prop.name.text
    if ((key === 'group' || key === 'binding') && ts.isNumericLiteral(prop.initializer)) {
      out[key] = Number(prop.initializer.text)
    }
    if (key === 'access' && ts.isStringLiteral(prop.initializer)) {
      if (prop.initializer.text === 'read' || prop.initializer.text === 'read_write')
        out.access = prop.initializer.text
    }
  }
  return out
}

function diag(sourceFile: ts.SourceFile, node: ts.Node, message: string): TsCompilerDiagnostic {
  return makeDiagnostic(sourceFile, node, message, TS_CODES.UNSUPPORTED)
}
