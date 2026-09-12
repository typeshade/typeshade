import ts from 'typescript'
import type { StructDecl, StructField } from '../../core/ir/nodes.js'
import { structT } from '../../core/ir/types.js'
import type { TsCompilerDiagnostic } from './source-file.js'
import { mapTsTypeToShaderType } from './type-map.js'
import { TS_CODES } from './codes.js'

export type CollectedStruct = {
  readonly decl: StructDecl
  readonly packing: 'wgsl'
}

export function collectStructs(
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): CollectedStruct[] {
  const out: CollectedStruct[] = []
  for (const stmt of sourceFile.statements) {
    if (!ts.isClassDeclaration(stmt) || !stmt.name) continue
    for (const d of stmt.modifiers ?? []) {
      if (!ts.isDecorator(d)) continue
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
        diagnostics.push(diag(sourceFile, member, `Data class "${stmt.name.text}" cannot have methods.`))
        continue
      }
      if (!ts.isPropertyDeclaration(member) || !ts.isIdentifier(member.name)) continue
      for (const d of member.modifiers ?? []) {
        if (!ts.isDecorator(d)) continue
        const text = d.getText(sourceFile)
        if (/@align/.test(text)) {
          diagnostics.push(diag(sourceFile, d, `@align on a field is not applied.`))
        }
      }
      const type = member.type
        ? mapTsTypeToShaderType(member.type, sourceFile, diagnostics) ?? structT(member.type.getText(sourceFile))
        : undefined
      if (!type) continue
      const field: StructField = { name: member.name.text, type }
      const loc = numberDecorator(member, 'location')
      const builtin = stringDecorator(member, 'builtin')
      if (loc !== undefined) (field as { location?: number }).location = loc
      if (builtin) (field as { builtin?: string }).builtin = builtin
      if (builtin) (field as { attr?: string }).attr = `@builtin(${builtin})`
      else if (loc !== undefined) (field as { attr?: string }).attr = `@location(${loc})`
      fields.push(field)
    }
    out.push({ decl: { name: stmt.name.text, fields }, packing: 'wgsl' })
  }
  return out
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

function stringDecorator(node: ts.Node, name: string): string | undefined {
  for (const d of ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : []) {
    if (!ts.isCallExpression(d.expression)) continue
    if (!ts.isIdentifier(d.expression.expression) || d.expression.expression.text !== name) continue
    const a = d.expression.arguments[0]
    if (a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a))) return a.text
  }
  return undefined
}

function diag(sf: ts.SourceFile, node: ts.Node, message: string): TsCompilerDiagnostic {
  const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
  return { message, fileName: sf.fileName, line: line + 1, character: character + 1, category: 'error', code: TS_CODES.STRUCT_FIELD }
}
