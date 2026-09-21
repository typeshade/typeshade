import ts from 'typescript'
import type { StructDecl, StructField } from '../../core/ir/nodes.js'
import type { ShaderType } from '../../core/ir/types.js'
import { structT, typeKey as typeKeyOf } from '../../core/ir/types.js'
import type { TsCompilerDiagnostic } from './source-file.js'
import { mapTsTypeToShaderType } from './type-map.js'
import { recordDeclaration, type DeclaredSymbolSink } from './symbols.js'
import { TS_CODES } from './codes.js'
import { makeDiagnostic } from './diagnostic.js'
import { builtinDecoratorArg, checkAttributeName, checkBuiltinName } from './builtin-check.js'
import { applyMixins, isMixinHeritage, mixedMembers, type MixinApplication } from './mixins.js'
import { pushTypeArguments } from './generics.js'
import {
  genericClasses,
  genericStructName,
  writtenInstances,
  type StructInstance,
} from './generic-structs.js'
import {
  eachNamespaceStatement,
  namespaceMemberName,
  refuseNamespaceStatement,
} from './namespaces.js'

/** Which of the three spellings declared a struct. Only a `class` can carry a field
 *  decorator, so a diagnostic that asks for `@builtin` or `@location` has to know: on the
 *  other two the author cannot comply without changing the declaration itself. */
export type StructSpelling = 'class' | 'interface' | 'type'

export type CollectedStruct = {
  readonly decl: StructDecl
  readonly packing: 'wgsl'
  readonly spelling: StructSpelling
  /** A `class`'s methods, constructor and field initializers (#86); absent on the other two
   *  spellings and on a class that declares none. */
  readonly members?: ClassMembers
  /** A class whose members are all static (roadmap 0.3 item T3, #92): a namespace of
   *  functions and constants rather than a value type. It is collected so `Util.half(x)`
   *  resolves and its statics become functions, and it is NOT emitted, because it has no
   *  fields and WGSL has no empty struct. */
  readonly namespace?: true
  /** The names this declaration extends, in the order written (roadmap 0.3 item T5, #92).
   *  Their fields stand ahead of this one's, base first, which is what makes a derived struct
   *  a superset of its base rather than a different shape. An interface may extend several. */
  readonly bases?: readonly string[]
  /** What this collection's type parameters are bound to, for a generic class (roadmap 0.3
   *  item T9, #92). `Pair_f32` carries `T -> f32`, and its methods are parsed and lowered with
   *  that in force, since their signatures and bodies are written in terms of `T`. Absent on
   *  every class that is not generic. */
  readonly binding?: ReadonlyMap<string, ShaderType>
  /** An `abstract class`: a base to inherit from and never a value. Its struct is emitted, so
   *  a derived one can be described in terms of it, and its method bodies are lowered into
   *  each concrete class that inherits them rather than into a function of its own — an
   *  abstract method has no body for such a function to call. */
  readonly abstract?: true
}

/** The structs a module emits: every collected one but the static-only classes, which are
 *  namespaces of functions and have no layout. One helper, because four callers build a
 *  module out of the collected list and all four must leave the same ones out. */
export const emittedStructDecls = (structs: readonly CollectedStruct[]): StructDecl[] =>
  structs.filter((s) => !s.namespace).map((s) => s.decl)

/** A field declared with an initializer, `hits: u32 = 0`: what a constructor assigns before
 *  its own body runs, and what `new P()` gives a class with no constructor. */
export interface FieldInit {
  readonly name: string
  readonly type: ShaderType
  readonly init: ts.Expression
}

/** What a class declares beyond its fields (#86). Each method becomes a function whose first
 *  parameter is the struct (`Ray_at(self_: Ray, t: f32)`), a static one a function with no
 *  receiver, and the constructor `Ray_new(...)`, which starts from the zero struct. */
export interface ClassMembers {
  readonly node: ts.ClassDeclaration
  readonly methods: readonly ts.MethodDeclaration[]
  readonly ctor: ts.ConstructorDeclaration | undefined
  readonly fieldInits: readonly FieldInit[]
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
  // Which classes are generic, and which sets of type arguments the file writes them with
  // (roadmap 0.3 item T9, #92). Read before the walk below, because a generic class is
  // collected once per set and the walk emits them all.
  const genericParams = genericClasses(sourceFile)
  const instances = writtenInstances(
    sourceFile,
    genericParams,
    (node) => mapTsTypeToShaderType(node, sourceFile, undefined),
    diagnostics,
  )
  const candidates = collectCandidates(sourceFile)
  const reachable = reachableCandidates(sourceFile, candidates)
  const out: CollectedStruct[] = []
  const declared = new Set<string>()
  /** Where to anchor a diagnostic about a struct's inheritance, which is reported after the
   *  walk and so no longer has the declaration in hand. */
  const nodeOf = new Map<string, ts.Node>()

  /** Records one struct, or says why it is not one. `before` is the diagnostic count from
   *  before the members were walked, so an empty field list is only reported when nothing
   *  else already explained it. */
  const add = (
    name: string,
    node: ts.Node,
    fields: StructField[],
    spelling: StructSpelling,
    before: number,
    members?: ClassMembers,
    isNamespace?: true,
    bases: readonly string[] = [],
    isAbstract?: true,
    binding?: ReadonlyMap<string, ShaderType>,
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
    // A class whose members are all static is a namespace of functions and constants, not a
    // value type, so the empty-struct rule does not reach it (T3, #92). Registered so that
    // `Util.half(x)` resolves and `collectClassFunctions` walks its statics; left out of the
    // emitted structs by `emittedStructDecls`.
    if (fields.length === 0 && isNamespace) {
      declared.add(name)
      out.push({
        decl: { name, fields },
        packing: 'wgsl',
        spelling,
        namespace: true,
        ...(members !== undefined ? { members } : {}),
        ...(binding !== undefined ? { binding } : {}),
      })
      return
    }
    // A declaration with a base gets its fields from `applyInheritance`, which reports an
    // empty one once what it extends is known (T5, #92).
    if (fields.length === 0 && bases.length === 0) {
      if (diagnostics.length === before) {
        diagnostics.push(
          diag(
            sourceFile,
            node,
            `Struct "${name}" has no fields. WGSL requires a struct to declare at least one ` +
              `member, so an empty one cannot be emitted.` +
              (members !== undefined && members.methods.length > 0
                ? ` A class holding only functions is not a struct; write them as functions.`
                : ''),
          ),
        )
      }
      return
    }
    declared.add(name)
    nodeOf.set(name, node)
    out.push({
      decl: { name, fields },
      packing: 'wgsl',
      spelling,
      ...(members !== undefined ? { members } : {}),
      ...(bases.length > 0 ? { bases } : {}),
      ...(isAbstract ? { abstract: isAbstract } : {}),
      ...(binding !== undefined ? { binding } : {}),
    })
  }

  // A class inside a `namespace` is the struct `Ns_P`, the same flattening a function and a
  // constant already take (#107). The walk below visits the file's own statements and each
  // namespace body, so one loop serves both; `prefix` is '' at the top level, where the struct
  // keeps the name it was written under.
  const seen: { stmt: ts.Statement; prefix: string }[] = []
  eachNamespaceStatement(sourceFile.statements, sourceFile, [], (stmt, prefix) => {
    seen.push({ stmt, prefix })
  })
  for (const { stmt, prefix } of seen) {
    const candidate = candidateOf(stmt)
    if (candidate) {
      if (prefix !== '') {
        // An interface or a type alias inside a namespace is collected by REACHABILITY rather
        // than by declaration, so flattening its name is a separate step; refused for now, with
        // the same sentence every other namespace member had.
        refuseNamespaceStatement(stmt, prefix, sourceFile, diagnostics)
        continue
      }
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
      const heritage = basesOf(candidate.name, candidate.heritage, sourceFile, diagnostics)
      if (heritage === undefined) continue
      const before = diagnostics.length
      // An interface and a type alias are two of the three spellings of one struct, and the
      // emitters spell all three the same way — so their names have to reach the declared-symbol
      // table too, or a check that reads it sees a `class` field and not the `interface` field
      // beside it (issue #103: `interface S { half: f32 }` is the uniform block ANGLE refuses).
      recordDeclaration(symbols, sourceFile, candidate.nameNode, {
        name: candidate.name,
        kind: 'struct',
        type: structT(candidate.name),
      })
      add(
        candidate.name,
        candidate.nameNode,
        signatureFields(candidate.members, candidate.name, sourceFile, diagnostics, symbols),
        candidate.spelling,
        before,
        undefined,
        undefined,
        heritage.bases,
      )
      continue
    }
    if (!ts.isClassDeclaration(stmt) || !stmt.name) continue
    const declared = stmt.name
    const written = prefix === '' ? declared.text : namespaceMemberName(prefix, declared.text)
    // A generic class is collected once per set of type arguments the file writes it with
    // (roadmap 0.3 item T9, #92): `Pair<f32>` and `Pair<vec3>` are the structs `Pair_f32` and
    // `Pair_vec3`, each with its own methods. A class with no type parameters has exactly one
    // collection, under its own name and with nothing bound, which is what every class had
    // before; a generic one nothing writes has none, and emits nothing.
    const cases: readonly StructInstance[] = genericParams.has(written)
      ? (instances.get(written) ?? [])
      : [{ name: written, binding: undefined }]
    for (const instance of cases) {
      const structName = instance.name
      // Imperative rather than a callback: the body below `continue`s, and a callback would
      // make that cross a function boundary. A `continue` here skips this INSTANCE, which is
      // what a member the walk refuses should do.
      const unbind = pushTypeArguments(instance.binding)
      try {
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
            diagnostics.push(
              diag(sourceFile, d, `${text.split('(')[0]} on a class is not applied.`),
            )
          }
          if (/@compute|@vertex|@fragment/.test(text)) {
            diagnostics.push(diag(sourceFile, d, `${text} does not belong on a data class.`))
          }
        }
        // A class `extends` puts the base's fields ahead of its own, just as an interface one does
        // (T5, #92); `implements` carries no layout and is left alone.
        const heritage = basesOf(structName, stmt.heritageClauses, sourceFile, diagnostics)
        if (heritage === undefined) continue
        const bases = heritage.bases
        const isAbstract =
          (stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.AbstractKeyword) ?? false) ||
          undefined
        const before = diagnostics.length
        const fields: StructField[] = []
        // Static members seen, which is what decides whether a fieldless class is a namespace of
        // functions (T3) or the empty struct WGSL has no form for.
        let staticMethods = 0
        let staticFields = 0
        const methods: ts.MethodDeclaration[] = []
        const fieldInits: FieldInit[] = []
        let ctor: ts.ConstructorDeclaration | undefined
        const methodNames = new Set<string>()
        // A mixin's members are this class's, ahead of its own and behind its base's, which is the
        // order TypeScript's own mixin produces (T8, #92). A member this class declares under the
        // same name is an override and wins, silently, the way a subclass member does.
        for (const member of mixedMembers(
          heritage.bodies,
          stmt.members,
          sourceFile,
          diagnostics,
          structName,
        )) {
          // A method, a constructor and a static function are functions of the module (#86), the
          // shapes below are what the surface does not take, each with its fix.
          if (ts.isConstructorDeclaration(member)) {
            if (!member.body) continue // an overload signature; the body is the declaration
            if (ctor !== undefined) {
              diagnostics.push(
                classDiag(
                  sourceFile,
                  member,
                  `"${structName}" declares two constructors; a shader function has one body.`,
                ),
              )
              continue
            }
            ctor = member
            continue
          }
          if (ts.isMethodDeclaration(member)) {
            if (!member.body) continue // an overload signature
            if (member.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword))
              staticMethods++
            if (!ts.isIdentifier(member.name)) {
              diagnostics.push(memberNameDiag(sourceFile, member, structName))
              continue
            }
            if (methodNames.has(member.name.text)) {
              diagnostics.push(
                classDiag(
                  sourceFile,
                  member.name,
                  `"${structName}.${member.name.text}" is declared twice; a method has one body ` +
                    `and no overloads.`,
                ),
              )
              continue
            }
            methodNames.add(member.name.text)
            methods.push(member)
            continue
          }
          if (ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) {
            const what = ts.isGetAccessorDeclaration(member) ? 'getter' : 'setter'
            const shown = ts.isIdentifier(member.name) ? member.name.text : 'this member'
            diagnostics.push(
              classDiag(
                sourceFile,
                member,
                `A ${what} has no shader form; write "${shown}" as a method and call it.`,
              ),
            )
            continue
          }
          if (ts.isIndexSignatureDeclaration(member)) {
            diagnostics.push(
              classDiag(
                sourceFile,
                member,
                `An index signature has no layout; a struct is exactly the fields written here.`,
              ),
            )
            continue
          }
          if (!ts.isPropertyDeclaration(member)) continue
          if (!ts.isIdentifier(member.name)) {
            diagnostics.push(memberNameDiag(sourceFile, member, stmt.name.text))
            continue
          }
          // The same rule an interface member already had: a struct field is always present in
          // the buffer the host fills, so `y?: f32` describes a layout WGSL has no form for.
          // Measured before this: a class took the `?` and emitted the field as required, with no
          // diagnostic, so the three spellings of one struct disagreed about it silently.
          if (member.questionToken) {
            diagnostics.push(
              diag(
                sourceFile,
                member,
                `Optional field "${member.name.text}?" on "${structName}" is not supported: a ` +
                  `struct field is always present in the buffer the host fills.`,
              ),
            )
            continue
          }
          // A static field is a module constant named `Cls_Field` (T3, #92); `module-const.ts`
          // collects and folds it, exactly as it does a top-level `const`. Before this it was
          // refused, and the fix it named was to write the const by hand.
          if (member.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword)) {
            staticFields++
            continue
          }
          if (
            member.initializer !== undefined &&
            (ts.isArrowFunction(member.initializer) || ts.isFunctionExpression(member.initializer))
          ) {
            diagnostics.push(
              classDiag(
                sourceFile,
                member,
                `A field holding a function is a method: write "${member.name.text}(...) { ... }".`,
              ),
            )
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
            builtinArg &&
            checkBuiltinName(diagnostics, sourceFile, builtinArg.argNode, builtinArg.name)
              ? builtinArg.name
              : undefined
          if (loc !== undefined) (field as { location?: number }).location = loc
          if (builtin) (field as { builtin?: string }).builtin = builtin
          if (builtin) (field as { attr?: string }).attr = `@builtin(${builtin})`
          else if (loc !== undefined) (field as { attr?: string }).attr = `@location(${loc})`
          fields.push(field)
          if (member.initializer !== undefined) {
            fieldInits.push({ name: field.name, type: field.type, init: member.initializer })
          }
          recordDeclaration(symbols, sourceFile, member.name, {
            name: field.name,
            kind: 'field',
            type: field.type,
            struct: structName,
          })
        }
        const members: ClassMembers | undefined =
          methods.length > 0 || ctor !== undefined || fieldInits.length > 0
            ? { node: stmt, methods, ctor, fieldInits }
            : undefined
        // Every member static and no field: a namespace (T3). An instance method or a constructor
        // needs a receiver, so a class that declares one keeps the empty-struct refusal and its
        // "write them as functions" fix.
        const isNamespace =
          fields.length === 0 &&
          staticMethods + staticFields > 0 &&
          methods.length === staticMethods &&
          ctor === undefined
            ? (true as const)
            : undefined
        add(
          structName,
          declared,
          fields,
          'class',
          before,
          members,
          isNamespace,
          bases,
          isAbstract,
          instance.binding,
        )
        // A static of a generic class cannot mention the class's type parameters — TypeScript
        // refuses that outright (TS2302) — so it is ONE function, not one per instance. It is
        // carried by a fieldless collection under the class's own name, which is the shape a
        // class of only statics already takes (T3, #92); that is what makes `Op.unit()` resolve
        // while `Op` itself names no layout. Emitted from the first instance, so a class the
        // file writes at three types still contributes each static once.
        if (instance === cases[0] && genericParams.has(written) && staticMethods > 0) {
          add(
            written,
            declared,
            [],
            'class',
            diagnostics.length,
            members && {
              node: members.node,
              methods: members.methods.filter((m) =>
                m.modifiers?.some((x) => x.kind === ts.SyntaxKind.StaticKeyword),
              ),
              ctor: undefined,
              fieldInits: [],
            },
            true,
          )
        }
      } finally {
        unbind()
      }
    }
  }
  return applyInheritance(out, sourceFile, nodeOf, diagnostics)
}

function classDiag(sf: ts.SourceFile, node: ts.Node, message: string): TsCompilerDiagnostic {
  return makeDiagnostic(sf, node, message, TS_CODES.CLASS_MEMBER)
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
 *  The roots are the places a type is CONSUMED: a `declare` binding's `uniform<T>` /
 *  `storage<T>` argument, a parameter or return annotation, a local annotation, a class
 *  field's type, a module const's annotation. From there it closes over the fields of the
 *  candidates already reached, so a struct referenced only as another struct's field is found
 *  too. A name nothing consumes stays exactly as invisible as it was before interfaces and
 *  aliases were collected at all.
 *
 *  What is NOT a root is another TYPE DECLARATION. `type Params = Config` mentions `Config`
 *  and consumes nothing, and rooting on it made a dead alias enough to pull a host-shaped
 *  `Config` into the collector: `type Config = { seed: number }` next to an unused
 *  `type Params = Config` compiles on main and reported TS8002 here. The same went for
 *  `Config[]`, `Config | undefined` and `Readonly<Config>` — every way a declaration can name
 *  a type without a value ever having it. */
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
    // Every type DECLARATION is skipped, not just the candidates: an alias or an interface
    // that mentions a name is describing a type, not using one, and a chain of dead aliases
    // must not make a candidate reachable. A candidate's own members are walked below,
    // through the fixpoint, and only once something has actually reached it.
    if (ts.isTypeAliasDeclaration(stmt) || ts.isInterfaceDeclaration(stmt)) continue
    eachTypeName(stmt, see)
  }
  // A class is always collected, and a base it names must be too: an `extends` clause holds an
  // expression rather than a type node, so the walk above does not see it (T5, #92).
  for (const stmt of sourceFile.statements) {
    if (!ts.isClassDeclaration(stmt)) continue
    eachHeritageName(stmt.heritageClauses, see)
  }
  while (pending.length > 0) {
    const candidate = candidates.get(pending.pop()!)
    if (!candidate) continue
    for (const member of candidate.members) {
      if (ts.isPropertySignature(member) && member.type) eachTypeName(member.type, see)
    }
    eachHeritageName(candidate.heritage, see)
  }
  return reachable
}

/** The names an `extends` clause writes. `implements` is left alone: it carries no layout, so
 *  an interface named only there is not a struct this file has to collect. */
function eachHeritageName(
  clauses: readonly ts.HeritageClause[] | undefined,
  f: (name: string) => void,
): void {
  for (const h of clauses ?? []) {
    if (h.token !== ts.SyntaxKind.ExtendsKeyword) continue
    for (const type of h.types) if (ts.isIdentifier(type.expression)) f(type.expression.text)
  }
}

/** What an `extends` clause comes to, or `undefined` after reporting one this cannot follow
 *  (roadmap 0.3 item T5, #92). `implements` carries no layout and is left alone, as before.
 *
 *  A base written with type arguments is the instance struct they name: `extends Box<f32>`
 *  inherits from `Box_f32`, which the same walk that found the annotation collected (T9, #92).
 *  A base that is a CALL is the mixin pattern, and is run rather than refused (T8) — see
 *  `mixins.ts` for what running it means. */
function basesOf(
  name: string,
  clauses: readonly ts.HeritageClause[] | undefined,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): MixinApplication | undefined {
  const extendsClause = clauses?.find((h) => h.token === ts.SyntaxKind.ExtendsKeyword)
  if (!extendsClause) return { bases: [], bodies: [] }
  const out: string[] = []
  const bodies: ts.ClassExpression[] = []
  for (const type of extendsClause.types) {
    if (type.typeArguments && type.typeArguments.length > 0) {
      // `class Small extends Box<f32>` inherits from the instance, not from the generic class:
      // `Box_f32` is a layout and `Box` is not one (T9, #92). Before that item a base with type
      // arguments was refused outright, with "one declaration per argument set" as the reason —
      // which is exactly what this now is.
      const instance = ts.isIdentifier(type.expression)
        ? genericStructName(type.expression.text, type.typeArguments, sourceFile)
        : undefined
      if (instance === undefined) {
        diagnostics.push(
          diag(
            sourceFile,
            type,
            `"${name}" extends "${type.getText(sourceFile)}", which names no layout. A base has ` +
              `to be a class this file declares, at type arguments it can resolve.`,
          ),
        )
        return undefined
      }
      out.push(instance)
      continue
    }
    if (isMixinHeritage(type.expression, sourceFile)) {
      const applied = applyMixins(name, type.expression, sourceFile, diagnostics)
      if (applied === undefined) return undefined
      out.push(...applied.bases)
      bodies.push(...applied.bodies)
      continue
    }
    if (!ts.isIdentifier(type.expression)) {
      diagnostics.push(
        diag(
          sourceFile,
          type,
          `"${name}" extends an expression. A base has to be a declared class or interface ` +
            `here, or a mixin: a call to a function of this file whose body is one ` +
            `"return class … { … }".`,
        ),
      )
      return undefined
    }
    out.push(type.expression.text)
  }
  return { bases: out, bodies }
}

/** Splice each struct's bases into it, base fields first (roadmap 0.3 item T5, #92). Runs
 *  after the whole file is collected, because TypeScript lets a derived declaration stand
 *  above its base, and resolves depth first so a chain of three inherits the whole prefix.
 *
 *  A field the derived redeclares with the base's type is the same field and keeps the base's
 *  place, which is TypeScript's own rule; one that redeclares it with a different type is
 *  refused, since a struct has one layout and two use sites would disagree about it. */
function applyInheritance(
  structs: readonly CollectedStruct[],
  sourceFile: ts.SourceFile,
  nodeOf: ReadonlyMap<string, ts.Node>,
  diagnostics: TsCompilerDiagnostic[],
): CollectedStruct[] {
  const byName = new Map(structs.map((s) => [s.decl.name, s]))
  const done = new Map<string, readonly StructField[]>()
  const onStack: string[] = []
  const at = (n: string): ts.Node => nodeOf.get(n) ?? sourceFile

  const resolve = (name: string): readonly StructField[] => {
    const cached = done.get(name)
    if (cached) return cached
    const struct = byName.get(name)
    if (!struct) return []
    if (onStack.includes(name)) {
      diagnostics.push(
        diag(
          sourceFile,
          at(name),
          `"${name}" extends itself, through ${[...onStack.slice(onStack.indexOf(name)), name]
            .map((n) => `"${n}"`)
            .join(' -> ')}. A struct cannot contain its own fields.`,
        ),
      )
      done.set(name, struct.decl.fields)
      return struct.decl.fields
    }
    onStack.push(name)
    const fields: StructField[] = []
    const seen = new Map<string, { field: StructField; from: string }>()
    const put = (f: StructField, from: string): void => {
      const prior = seen.get(f.name)
      if (prior === undefined) {
        seen.set(f.name, { field: f, from })
        fields.push(f)
        return
      }
      if (typeKeyOf(prior.field.type) === typeKeyOf(f.type)) return
      diagnostics.push(
        diag(
          sourceFile,
          at(name),
          `"${from}" declares "${f.name}" as ${typeKeyOf(f.type)}, and "${prior.from}" declares ` +
            `it as ${typeKeyOf(prior.field.type)}. A struct has one layout, so a field cannot ` +
            `change type on the way down.`,
        ),
      )
    }
    for (const base of struct.bases ?? []) {
      if (!byName.has(base)) {
        diagnostics.push(
          diag(
            sourceFile,
            at(name),
            `"${name}" extends "${base}", which this file does not declare as a struct. A base ` +
              `has to be a class or an interface whose fields are shader types.`,
          ),
        )
        continue
      }
      for (const f of resolve(base)) put(f, base)
    }
    for (const f of struct.decl.fields) put(f, name)
    onStack.pop()
    done.set(name, fields)
    return fields
  }

  const out = structs.map((s) => {
    const fields = resolve(s.decl.name)
    if (fields === s.decl.fields) return s
    return { ...s, decl: { ...s.decl, fields } }
  })
  // The empty-struct rule is checked here for a declaration with a base, since what it
  // inherits is only known now.
  for (const s of out) {
    if (s.namespace || s.decl.fields.length > 0 || (s.bases ?? []).length === 0) continue
    diagnostics.push(
      diag(
        sourceFile,
        at(s.decl.name),
        `Struct "${s.decl.name}" has no fields, and neither has what it extends. WGSL requires ` +
          `a struct to declare at least one member.`,
      ),
    )
  }
  return out
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
  symbols?: DeclaredSymbolSink,
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
    recordDeclaration(symbols, sourceFile, member.name, {
      name: member.name.text,
      kind: 'field',
      type,
      struct: owner,
    })
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
