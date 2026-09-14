import ts from 'typescript'
import type { StructDecl, StructField } from '../../core/ir/nodes.js'
import { structT } from '../../core/ir/types.js'
import type { TsCompilerDiagnostic } from './source-file.js'
import { mapTsTypeToShaderType } from './type-map.js'
import { recordDeclaration, type DeclaredSymbolSink } from './symbols.js'
import { TS_CODES } from './codes.js'
import { makeDiagnostic } from './diagnostic.js'
import { builtinDecoratorArg, checkAttributeName, checkBuiltinName } from './builtin-check.js'

/** Which of the three spellings declared a struct. Only a `class` can carry a field
 *  decorator, so a diagnostic that asks for `@builtin` or `@location` has to know: on the
 *  other two the author cannot comply without changing the declaration itself. */
export type StructSpelling = 'class' | 'interface' | 'type'

export type CollectedStruct = {
  readonly decl: StructDecl
  readonly packing: 'wgsl'
  readonly spelling: StructSpelling
}

/** An `interface X { … }` or a `type X = { … }` — the two spellings that are collected only
 *  when something refers to them (see {@link collectStructs}). */
type Candidate = {
  readonly name: string
  readonly nameNode: ts.Identifier
  readonly members: readonly ts.TypeElement[]
  readonly spelling: 'interface' | 'type'
  readonly generic: boolean
  readonly heritage: readonly ts.HeritageClause[] | undefined
}

/** Every struct the file declares, in source order, whichever of the three spellings the
 *  author used. A `class` is the only one that can carry per-field metadata, because
 *  TypeScript decorators cannot appear on a type-literal or interface member; `type X = { … }`
 *  and `interface X { … }` are the plain-data spellings §2 of the surface document names, and
 *  produce the same {@link StructDecl} a class with no field decorators does.
 *
 *  A class is collected whether or not anything refers to it, exactly as before. An interface
 *  or an object-type alias is collected only when its name is USED as a struct — see
 *  {@link reachableCandidates}. That gate is what keeps this addition additive: a
 *  `"use typeshade"` file may hold host-shaped declarations that are not shader types at all
 *  (`type P = { seed: number }`, `{ cb: () => f32 }`), and before this they were simply
 *  invisible. Collecting every declaration would turn each of them into a type error and
 *  would put an unreferenced shape into the emitted WGSL. */
export function collectStructs(
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  symbols?: DeclaredSymbolSink,
): CollectedStruct[] {
  const candidates = collectCandidates(sourceFile)
  const reachable = reachableCandidates(sourceFile, candidates)
  const out: CollectedStruct[] = []
  const declared = new Set<string>()

  /** Records one struct, or says why it is not one. `before` is the diagnostic count from
   *  before the members were walked, so an empty field list is only reported when nothing
   *  else already explained it. */
  const add = (
    name: string,
    node: ts.Node,
    fields: StructField[],
    spelling: StructSpelling,
    before: number,
  ): void => {
    if (declared.has(name)) {
      diagnostics.push(
        makeDiagnostic(
          sourceFile,
          node,
          `Struct "${name}" is declared more than once. A class, an interface and a type alias ` +
            `are three spellings of one struct, not declarations that merge — TypeScript would ` +
            `merge two interfaces, and the merged layout would disagree with this one at every ` +
            `use site.`,
          TS_CODES.DUPLICATE_SYMBOL,
        ),
      )
      return
    }
    if (fields.length === 0) {
      if (diagnostics.length === before) {
        diagnostics.push(
          diag(
            sourceFile,
            node,
            `Struct "${name}" has no fields. WGSL requires a struct to declare at least one ` +
              `member, so an empty one cannot be emitted.`,
          ),
        )
      }
      return
    }
    declared.add(name)
    out.push({ decl: { name, fields }, packing: 'wgsl', spelling })
  }

  for (const stmt of sourceFile.statements) {
    const candidate = candidateOf(stmt)
    if (candidate) {
      if (!reachable.has(candidate.name)) continue
      if (candidate.generic) {
        diagnostics.push(
          diag(
            sourceFile,
            candidate.nameNode,
            `"${candidate.name}" takes type parameters. A TypeShade struct is one concrete ` +
              `layout, so a generic declaration has no single set of field types to emit.`,
          ),
        )
        continue
      }
      if (heritageRejected(candidate.name, candidate.heritage, sourceFile, diagnostics)) continue
      const before = diagnostics.length
      add(
        candidate.name,
        candidate.nameNode,
        signatureFields(candidate.members, candidate.name, sourceFile, diagnostics),
        candidate.spelling,
        before,
      )
      continue
    }
    if (!ts.isClassDeclaration(stmt) || !stmt.name) continue
    const structName = stmt.name.text
    recordDeclaration(symbols, sourceFile, stmt.name, {
      name: structName,
      kind: 'struct',
      type: structT(structName),
    })
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
    // A class `extends` drops the base's fields just as an interface one does; `implements`
    // carries no layout and is left alone.
    if (heritageRejected(stmt.name.text, stmt.heritageClauses, sourceFile, diagnostics)) continue
    const before = diagnostics.length
    const fields: StructField[] = []
    for (const member of stmt.members) {
      if (ts.isMethodDeclaration(member) || ts.isConstructorDeclaration(member)) {
        diagnostics.push(
          diag(sourceFile, member, `Data class "${stmt.name.text}" cannot have methods.`),
        )
        continue
      }
      if (!ts.isPropertyDeclaration(member)) continue
      if (!ts.isIdentifier(member.name)) {
        diagnostics.push(memberNameDiag(sourceFile, member, stmt.name.text))
        continue
      }
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
      recordDeclaration(symbols, sourceFile, member.name, {
        name: field.name,
        kind: 'field',
        type: field.type,
        struct: structName,
      })
    }
    add(stmt.name.text, stmt.name, fields, 'class', before)
  }
  return out
}

/** The interface / object-type-alias declaration a statement is, or undefined. Generic ones
 *  are candidates too: whether they deserve a diagnostic depends on whether anything refers
 *  to them, which is not known here. */
function candidateOf(stmt: ts.Statement): Candidate | undefined {
  if (ts.isInterfaceDeclaration(stmt)) {
    return {
      name: stmt.name.text,
      nameNode: stmt.name,
      members: stmt.members,
      spelling: 'interface',
      generic: (stmt.typeParameters?.length ?? 0) > 0,
      heritage: stmt.heritageClauses,
    }
  }
  if (ts.isTypeAliasDeclaration(stmt) && ts.isTypeLiteralNode(stmt.type)) {
    return {
      name: stmt.name.text,
      nameNode: stmt.name,
      members: stmt.type.members,
      spelling: 'type',
      generic: (stmt.typeParameters?.length ?? 0) > 0,
      heritage: undefined,
    }
  }
  return undefined
}

function collectCandidates(sourceFile: ts.SourceFile): Map<string, Candidate> {
  const out = new Map<string, Candidate>()
  for (const stmt of sourceFile.statements) {
    const candidate = candidateOf(stmt)
    // First declaration wins the map slot; a second one of the same name is reported by `add`.
    if (candidate && !out.has(candidate.name)) out.set(candidate.name, candidate)
  }
  return out
}

/** Every type name mentioned anywhere under `node`, including type arguments, so
 *  `uniform<Camera>` and `storage<array<P>>` both yield their element name. */
function eachTypeName(node: ts.Node, f: (name: string) => void): void {
  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) f(node.typeName.text)
  node.forEachChild((child) => {
    eachTypeName(child, f)
  })
}

/** The candidate names a program actually USES as a struct.
 *
 *  The roots are every type reference outside a candidate's own body: a `declare` binding's
 *  `uniform<T>` / `storage<T>` argument, a parameter or return annotation, a local
 *  annotation, a class field's type — anywhere a type can be written. From there it closes
 *  over the fields of the candidates already reached, so a struct referenced only as another
 *  struct's field is found too. A name nothing mentions stays exactly as invisible as it was
 *  before interfaces and aliases were collected at all. */
function reachableCandidates(
  sourceFile: ts.SourceFile,
  candidates: ReadonlyMap<string, Candidate>,
): Set<string> {
  const reachable = new Set<string>()
  const pending: string[] = []
  const see = (name: string): void => {
    if (!candidates.has(name) || reachable.has(name)) return
    reachable.add(name)
    pending.push(name)
  }
  for (const stmt of sourceFile.statements) {
    if (candidateOf(stmt)) continue
    eachTypeName(stmt, see)
  }
  while (pending.length > 0) {
    const candidate = candidates.get(pending.pop()!)
    if (!candidate) continue
    for (const member of candidate.members) {
      if (ts.isPropertySignature(member) && member.type) eachTypeName(member.type, see)
    }
  }
  return reachable
}

/** True, having reported it, when the declaration inherits — a TypeShade struct is exactly the
 *  members written in it, so a base type's fields would silently vanish from the layout. */
function heritageRejected(
  name: string,
  clauses: readonly ts.HeritageClause[] | undefined,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): boolean {
  const extendsClause = clauses?.find((h) => h.token === ts.SyntaxKind.ExtendsKeyword)
  if (!extendsClause) return false
  diagnostics.push(
    diag(
      sourceFile,
      extendsClause,
      `"${name}" extends another type. A TypeShade struct is exactly the members written here, ` +
        `so the inherited ones would be dropped; write them out.`,
    ),
  )
  return true
}

function memberNameDiag(
  sourceFile: ts.SourceFile,
  member: ts.Node,
  owner: string,
): TsCompilerDiagnostic {
  return diag(
    sourceFile,
    member,
    `Field names on "${owner}" must be plain identifiers: a WGSL struct member has no other ` +
      `spelling, and a quoted or computed name would not reach the emitted layout.`,
  )
}

/** The fields of a `type X = { … }` or an `interface X { … }`. The member list is the field
 *  list: no decorator can reach a type-literal or interface member, so there is no
 *  `@location` / `@builtin` / `@align` handling here and a struct that needs per-field
 *  metadata (entry I/O in particular) stays a class. The shapes that would otherwise lose
 *  meaning on the way to a WGSL struct — a method, a call or index signature, an optional
 *  member, a quoted name — are named rather than dropped. */
function signatureFields(
  members: readonly ts.TypeElement[],
  owner: string,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): StructField[] {
  const fields: StructField[] = []
  for (const member of members) {
    if (ts.isMethodSignature(member)) {
      diagnostics.push(diag(sourceFile, member, `Data type "${owner}" cannot have methods.`))
      continue
    }
    if (ts.isCallSignatureDeclaration(member) || ts.isConstructSignatureDeclaration(member)) {
      diagnostics.push(
        diag(
          sourceFile,
          member,
          `Data type "${owner}" cannot be callable or constructable — a struct is data, and a ` +
            `signature has no layout.`,
        ),
      )
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
    if (!ts.isPropertySignature(member)) continue
    if (!ts.isIdentifier(member.name)) {
      diagnostics.push(memberNameDiag(sourceFile, member, owner))
      continue
    }
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
