import ts from 'typescript'
import type { StructDecl, StructField } from '../../core/ir/nodes.js'
import { structT } from '../../core/ir/types.js'
import type { TsCompilerDiagnostic } from './source-file.js'
import { mapTsTypeToShaderType } from './type-map.js'
import { TS_CODES } from './codes.js'
import { makeDiagnostic } from './diagnostic.js'
import { builtinDecoratorArg, checkAttributeName, checkBuiltinName } from './builtin-check.js'

export type CollectedStruct = {
  readonly decl: StructDecl
  readonly packing: 'wgsl'
}

/** Every struct the file declares, in source order, whichever of the three spellings the
 *  author used. A `class` is the only one that can carry per-field metadata, because
 *  TypeScript decorators cannot appear on a type-literal or interface member; `type X = { … }`
 *  and `interface X { … }` are the plain-data spellings §2 of the surface document names, and
 *  produce the same {@link StructDecl} a class with no field decorators does. */
export function collectStructs(
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): CollectedStruct[] {
  const out: CollectedStruct[] = []
  const declared = new Set<string>()
  const add = (name: string, node: ts.Node, fields: StructField[]): void => {
    if (declared.has(name)) {
      diagnostics.push(
        diag(
          sourceFile,
          node,
          `Struct "${name}" is declared more than once. A class, a type alias and an interface ` +
            `are three spellings of one struct, not declarations that merge.`,
        ),
      )
      return
    }
    declared.add(name)
    out.push({ decl: { name, fields }, packing: 'wgsl' })
  }
  for (const stmt of sourceFile.statements) {
    if (ts.isInterfaceDeclaration(stmt)) {
      if (stmt.heritageClauses?.length) {
        diagnostics.push(
          diag(
            sourceFile,
            stmt.heritageClauses[0]!,
            `interface "${stmt.name.text}" extends another type. A TypeShade struct is exactly ` +
              `the members written here, so the inherited ones would be dropped; write them out.`,
          ),
        )
      }
      add(
        stmt.name.text,
        stmt.name,
        signatureFields(stmt.members, stmt.name.text, sourceFile, diagnostics),
      )
      continue
    }
    if (ts.isTypeAliasDeclaration(stmt) && ts.isTypeLiteralNode(stmt.type)) {
      add(
        stmt.name.text,
        stmt.name,
        signatureFields(stmt.type.members, stmt.name.text, sourceFile, diagnostics),
      )
      continue
    }
    if (!ts.isClassDeclaration(stmt) || !stmt.name) continue
    for (const d of stmt.modifiers ?? []) {
      if (!ts.isDecorator(d)) continue
      checkAttributeName(diagnostics, sourceFile, d)
      const text = d.getText(sourceFile)
      if (/@std140/.test(text) || /@align/.test(text)) {
        diagnostics.push(diag(sourceFile, d, `${text.split('(')[0]} on a class is not applied.`))
      }
      if (/@compute|@vertex|@fragment/.test(text)) {
        diagnostics.push(diag(sourceFile, d, `${text} does not belong on a data class.`))
      }
    }
    const fields: StructField[] = []
    for (const member of stmt.members) {
      if (ts.isMethodDeclaration(member) || ts.isConstructorDeclaration(member)) {
        diagnostics.push(
          diag(sourceFile, member, `Data class "${stmt.name.text}" cannot have methods.`),
        )
        continue
      }
      if (!ts.isPropertyDeclaration(member) || !ts.isIdentifier(member.name)) continue
      for (const d of member.modifiers ?? []) {
        if (!ts.isDecorator(d)) continue
        checkAttributeName(diagnostics, sourceFile, d)
        const text = d.getText(sourceFile)
        if (/@align/.test(text)) {
          diagnostics.push(diag(sourceFile, d, `@align on a field is not applied.`))
        }
      }
      const type = member.type
        ? (mapTsTypeToShaderType(member.type, sourceFile, diagnostics) ??
          structT(member.type.getText(sourceFile)))
        : undefined
      if (!type) continue
      const field: StructField = { name: member.name.text, type }
      const loc = numberDecorator(member, 'location')
      const decos = ts.canHaveDecorators(member) ? (ts.getDecorators(member) ?? []) : []
      const builtinArg = builtinDecoratorArg(decos)
      const builtin =
        builtinArg && checkBuiltinName(diagnostics, sourceFile, builtinArg.argNode, builtinArg.name)
          ? builtinArg.name
          : undefined
      if (loc !== undefined) (field as { location?: number }).location = loc
      if (builtin) (field as { builtin?: string }).builtin = builtin
      if (builtin) (field as { attr?: string }).attr = `@builtin(${builtin})`
      else if (loc !== undefined) (field as { attr?: string }).attr = `@location(${loc})`
      fields.push(field)
    }
    add(stmt.name.text, stmt.name, fields)
  }
  return out
}

/** The fields of a `type X = { … }` or an `interface X { … }`. The member list is the field
 *  list: no decorator can reach a type-literal or interface member, so there is no
 *  `@location` / `@builtin` / `@align` handling here and a struct that needs per-field
 *  metadata (entry I/O in particular) stays a class. The shapes that would otherwise lose
 *  meaning on the way to a WGSL struct — a method, a call or index signature, an optional
 *  member — are named rather than dropped. */
function signatureFields(
  members: readonly ts.TypeElement[],
  owner: string,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): StructField[] {
  const fields: StructField[] = []
  for (const member of members) {
    if (
      ts.isMethodSignature(member) ||
      ts.isCallSignatureDeclaration(member) ||
      ts.isConstructSignatureDeclaration(member)
    ) {
      diagnostics.push(diag(sourceFile, member, `Data type "${owner}" cannot have methods.`))
      continue
    }
    if (ts.isIndexSignatureDeclaration(member)) {
      diagnostics.push(
        diag(
          sourceFile,
          member,
          `Data type "${owner}" cannot have an index signature. Use array<T, N> for a field of many.`,
        ),
      )
      continue
    }
    if (!ts.isPropertySignature(member) || !ts.isIdentifier(member.name)) continue
    if (member.questionToken) {
      diagnostics.push(
        diag(
          sourceFile,
          member,
          `Optional field "${member.name.text}?" on "${owner}" is not supported: a struct field ` +
            `is always present in the buffer the host fills.`,
        ),
      )
      continue
    }
    const type = member.type
      ? (mapTsTypeToShaderType(member.type, sourceFile, diagnostics) ??
        structT(member.type.getText(sourceFile)))
      : undefined
    if (!type) continue
    fields.push({ name: member.name.text, type })
  }
  return fields
}

function numberDecorator(node: ts.Node, name: string): number | undefined {
  for (const d of ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : []) {
    if (!ts.isCallExpression(d.expression)) continue
    if (!ts.isIdentifier(d.expression.expression) || d.expression.expression.text !== name) continue
    const a = d.expression.arguments[0]
    if (a && ts.isNumericLiteral(a)) return Number(a.text)
  }
  return undefined
}

function diag(sf: ts.SourceFile, node: ts.Node, message: string): TsCompilerDiagnostic {
  return makeDiagnostic(sf, node, message, TS_CODES.STRUCT_FIELD)
}
