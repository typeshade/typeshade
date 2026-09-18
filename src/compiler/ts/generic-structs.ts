// === A generic class is one struct per set of type arguments the file writes (T9, #92) ===
//
// Neither target has a generic struct: a WGSL or GLSL struct is one layout. TypeScript has them,
// so a generic class is collected once per set of type arguments the file writes it with, the
// way a generic function is compiled once per set it is CALLED with. `Pair<f32>` and
// `Pair<vec3>` are the structs `Pair_f32` and `Pair_vec3`, each with its own methods.
//
// The instances are read off the SOURCE rather than discovered as the lowering runs, because a
// struct has to exist before anything is lowered against it: its methods are functions of the
// module, its fields decide every layout that holds it, and the inheritance splice runs over
// the collected list. Every use is a type node, an `extends`, or a `new`, and all three are
// visible syntactically, so one walk finds them all.
//
// A type argument that is itself a type parameter — `Pair<T>` inside a generic function — names
// no layout until that function is instantiated, which is after this walk. It is refused with
// that as the reason.
//
// A type parameter's default — `class Grid<T = f32>` — is read the way TypeScript reads it: a use
// that leaves the argument out takes the default, so `Grid` and `Grid<f32>` are one struct.

import ts from 'typescript'
import type { ShaderType } from '../../core/ir/types.js'
import type { TsCompilerDiagnostic } from './source-file.js'
import { makeDiagnostic } from './diagnostic.js'
import { TS_CODES } from './codes.js'
import { instanceName, typeParameterNames } from './generics.js'
import { mapTsTypeToShaderType } from './type-map.js'

/** One collection of a generic class: the name the module emits it under, and what its type
 *  parameters are bound to while its members are walked. */
export interface StructInstance {
  readonly name: string
  readonly binding: ReadonlyMap<string, ShaderType> | undefined
}

/** One type parameter of a generic class, with the default a use may leave to it. */
interface GenericParam {
  readonly name: string
  readonly fallback: ts.TypeNode | undefined
}

/** The generic classes a file declares, by the name the module emits them under — flattened for
 *  one inside a namespace, `N_Pair` (#107) — with their type parameters in order. A class with
 *  no type parameters is not here. */
export function genericClasses(sourceFile: ts.SourceFile): Map<string, readonly GenericParam[]> {
  const out = new Map<string, readonly GenericParam[]>()
  const walk = (statements: readonly ts.Statement[], prefix: string): void => {
    for (const stmt of statements) {
      if (ts.isModuleDeclaration(stmt) && stmt.body) {
        const inner = prefix === '' ? stmt.name.text : `${prefix}_${stmt.name.text}`
        if (ts.isModuleBlock(stmt.body)) walk(stmt.body.statements, inner)
        else if (ts.isModuleDeclaration(stmt.body)) walk([stmt.body], inner)
        continue
      }
      if (!ts.isClassDeclaration(stmt) || !stmt.name) continue
      const params = (stmt.typeParameters ?? []).map((p) => ({
        name: p.name.text,
        fallback: p.default,
      }))
      if (params.length > 0) {
        out.set(prefix === '' ? stmt.name.text : `${prefix}_${stmt.name.text}`, params)
      }
    }
  }
  walk(sourceFile.statements, '')
  return out
}

/** The key in {@link genericClasses} a name as WRITTEN stands for. `Pair` is itself, `N.Pair`
 *  the flattened `N_Pair`, and a short name written from inside its own namespace's bodies is
 *  the one flattened name that ends in it — the rule #107 already resolves annotations by, and
 *  it refuses rather than guesses when two namespaces declare the name. */
function resolveName(
  written: string,
  generics: ReadonlyMap<string, readonly GenericParam[]>,
): string | undefined {
  const dotted = written.split('.').join('_')
  if (generics.has(dotted)) return dotted
  const suffix = `_${dotted}`
  const hits = [...generics.keys()].filter((k) => k.endsWith(suffix))
  return hits.length === 1 ? hits[0]! : undefined
}

/** Every `Name<Args>` the file writes, as a type or after `new`, for a name in `generics`.
 *  Deduplicated by the emitted instance name, in the order first written, so the emitted
 *  structs are in a stable order whatever else the file does. */
export function writtenInstances(
  sourceFile: ts.SourceFile,
  generics: ReadonlyMap<string, readonly GenericParam[]>,
  mapType: (node: ts.TypeNode) => ShaderType | undefined,
  diagnostics: TsCompilerDiagnostic[],
): Map<string, StructInstance[]> {
  const out = new Map<string, StructInstance[]>()
  if (generics.size === 0) return out
  const seen = new Set<string>()
  // The type parameters in scope where a use is written: a use inside a generic declaration may
  // name one, and that is the case this cannot resolve.
  const inScope: string[] = []
  const record = (
    base: string,
    args: readonly ts.TypeNode[],
    at: ts.Node,
    shown: string,
    lenient?: true,
  ): void => {
    const key = resolveName(base, generics)
    if (key === undefined) return
    const params = generics.get(key)!
    const read = readArguments(args, params)
    if (read === undefined) {
      // A `new` that leaves its type arguments out is not a mistake — TypeScript infers them —
      // so it reports nothing and collects nothing here. It is answered at the use site, by
      // {@link newInstanceName}, from the instances the rest of the file writes.
      if (lenient) return
      diagnostics.push(
        makeDiagnostic(
          sourceFile,
          at,
          arityMessage(base, params, args.length),
          TS_CODES.ARITY_MISMATCH,
        ),
      )
      return
    }
    if (args.length > params.length) {
      // Surplus arguments are a mistake however they are written, lenient or not, and the
      // instance is still collected from the ones the class declares, so the use reads as that
      // one sentence and not as a cascade of everything the missing struct would have made
      // possible (T10, #111).
      diagnostics.push(
        makeDiagnostic(
          sourceFile,
          at,
          arityMessage(base, params, args.length),
          TS_CODES.ARITY_MISMATCH,
        ),
      )
    }
    const bound = new Map<string, ShaderType>()
    for (const [i, node] of read.entries()) {
      const written = node.getText(sourceFile)
      if (inScope.includes(written)) {
        diagnostics.push(
          makeDiagnostic(
            sourceFile,
            node,
            `"${shown}" is written with the type parameter "${written}", which names no layout ` +
              `until the declaration around it is instantiated. A struct is collected before ` +
              `anything is lowered against it, so its type arguments have to be concrete: ` +
              `write "${base}<f32>" (or whichever types this file uses) at the use sites.`,
            TS_CODES.UNKNOWN_TYPE,
          ),
        )
        return
      }
      const mapped = mapType(node)
      if (!mapped) return
      bound.set(params[i]!.name, mapped)
    }
    const name = instanceName(
      key,
      params.map((p) => bound.get(p.name)!),
    )
    if (seen.has(name)) return
    seen.add(name)
    const into = out.get(key) ?? []
    into.push({ name, binding: bound })
    out.set(key, into)
  }

  const visit = (node: ts.Node): void => {
    const own = ownTypeParameters(node)
    if (own.length > 0) inScope.push(...own)
    // Every use, written with arguments or not: a class whose parameters all declare defaults
    // is used by its bare name, and that use collects an instance as much as `Grid<f32>` does.
    // `record` ignores a name that is no generic class of this file, which is almost all of them.
    if (ts.isTypeReferenceNode(node)) {
      // Short or dotted: `Pair<f32>` and `N.Pair<f32>` both name the class, and `record`
      // resolves either to the one name the module emits it under.
      const written = entityName(node.typeName)
      if (written !== undefined) {
        record(written, node.typeArguments ?? [], node, node.getText(sourceFile))
      }
    }
    if (ts.isExpressionWithTypeArguments(node) && ts.isIdentifier(node.expression)) {
      // `class Small extends Box<f32>` — a heritage clause is not a type reference, and the
      // base it names has to be collected before the inheritance splice runs over the list.
      record(node.expression.text, node.typeArguments ?? [], node, node.getText(sourceFile))
    }
    // A `new` with its type arguments written collects an instance. One WITHOUT them is not an
    // arity mistake — TypeScript infers those from the constructor's arguments — so it is left
    // to {@link newInstanceName}, which answers it from the instances the rest of the file
    // writes. Recording it here would report the arguments it is allowed to leave out.
    if (ts.isNewExpression(node)) {
      // `new N.Pair<f32>(…)` as much as `new Pair<f32>(…)`: a namespaced class is reached
      // through a property access, which `record` resolves the same way as a dotted type (#107).
      // Leniently, because a `new` may leave its type arguments out: `new Fade(0.35)` on a class
      // whose every parameter has a default still names one definite instance and collects it,
      // and one that names none reports nothing here.
      const written = newTargetName(node.expression)
      if (written !== undefined) {
        record(
          written,
          node.typeArguments ?? [],
          node,
          `new ${node.getText(sourceFile).slice(4)}`,
          true,
        )
      }
    }
    ts.forEachChild(node, visit)
    if (own.length > 0) inScope.length -= own.length
  }
  ts.forEachChild(sourceFile, visit)
  return out
}

/** The type node each parameter of a generic class reads, or undefined when one is left with
 *  nothing to read — no argument written for it and no default declared for it, which is the
 *  only arity a use can get wrong beyond recovery.
 *
 *  A use that writes MORE arguments than the class declares is still read: the extra ones are
 *  surplus and the caller reports them, so the mistake stays one sentence instead of taking the
 *  struct, and every use of it, down with it. */
function readArguments(
  args: readonly ts.TypeNode[],
  params: readonly GenericParam[],
): readonly ts.TypeNode[] | undefined {
  const out: ts.TypeNode[] = []
  for (const [i, param] of params.entries()) {
    const node = args[i] ?? param.fallback
    if (node === undefined) return undefined
    out.push(node)
  }
  return out
}

/** "Pair" takes 1 type argument(s), got 2. — with the range spelled out when a default makes
 *  some of them optional, the way an optional parameter widens a call's arity message. */
function arityMessage(base: string, params: readonly GenericParam[], got: number): string {
  const required = params.filter((p) => p.fallback === undefined).length
  const takes =
    required === params.length
      ? String(params.length)
      : `${String(required)} to ${String(params.length)}`
  return `"${base}" takes ${takes} type argument(s), got ${String(got)}.`
}

/** The name a `new` is written against, with its namespace qualifiers kept: `Pair`, `N.Pair`.
 *  Undefined for a target this surface cannot spell, which is anything but a chain of names. */
function newTargetName(node: ts.Expression): string | undefined {
  if (ts.isIdentifier(node)) return node.text
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name)) {
    const left = newTargetName(node.expression)
    return left === undefined ? undefined : `${left}.${node.name.text}`
  }
  return undefined
}

/** A type name as written, with its namespace qualifiers kept: `Pair`, `N.Pair`. Undefined for
 *  a name this surface cannot spell, which is one qualified by anything but an identifier. */
function entityName(name: ts.EntityName): string | undefined {
  if (ts.isIdentifier(name)) return name.text
  const left = entityName(name.left)
  return left === undefined ? undefined : `${left}.${name.right.text}`
}

/** The type parameters a declaration introduces, which are in scope inside it. */
function ownTypeParameters(node: ts.Node): readonly string[] {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node)
  ) {
    return [...typeParameterNames(node.typeParameters)]
  }
  return []
}

/** The struct a `Name<Args>` names, when `Name` is a generic class this file declares and the
 *  arguments are concrete: `Pair<f32>` is `Pair_f32` (T9, #92). Undefined for every other
 *  generic name, which is the builtin ones — `array<T, N>`, `uniform<T>` — and for a class whose
 *  arguments this cannot resolve, which the collection walk has already reported.
 *
 *  Takes the arguments rather than the node, because the two places that write them are a type
 *  reference and an `extends` clause, and only one of those is a type node.
 *
 *  The file's generic classes are cached, because this is asked once per type annotation and the
 *  answer is a fact about the file's own declarations. */
export function genericStructName(
  name: string | undefined,
  typeArguments: readonly ts.TypeNode[] | undefined,
  sourceFile: ts.SourceFile,
): string | undefined {
  if (name === undefined) return undefined
  const generics = classesOf(sourceFile)
  const key = resolveName(name, generics)
  if (key === undefined) return undefined
  const read = readArguments(typeArguments ?? [], generics.get(key)!)
  if (read === undefined) return undefined
  const bound: ShaderType[] = []
  for (const node of read) {
    // No diagnostics: a type argument that names nothing was reported where the instance was
    // collected, and saying it again at every annotation is the cascade T10 removed.
    const mapped = mapTsTypeToShaderType(node, sourceFile, undefined)
    if (!mapped) return undefined
    bound.push(mapped)
  }
  return instanceName(key, bound)
}

/** Whether `name` is a generic class this file declares. The caller asks after
 *  {@link genericStructName} has come back undefined, to tell "a builtin generic name, or none
 *  of mine" from "mine, written with arguments that name no layout" — which the collection walk
 *  has already reported, and which must not be reported a second time. */
export function isGenericClass(name: string | undefined, sourceFile: ts.SourceFile): boolean {
  return name !== undefined && resolveName(name, classesOf(sourceFile)) !== undefined
}

const CLASSES = new WeakMap<ts.SourceFile, Map<string, readonly GenericParam[]>>()

/** The file's generic classes, computed once. */
function classesOf(sourceFile: ts.SourceFile): Map<string, readonly GenericParam[]> {
  const hit = CLASSES.get(sourceFile)
  if (hit !== undefined) return hit
  const made = genericClasses(sourceFile)
  CLASSES.set(sourceFile, made)
  return made
}

/** The instance struct a `new Name<Args>(…)` builds, or undefined when `Name` is no generic
 *  class of this file (T9, #92).
 *
 *  `new Pair<f32>(…)` says which one outright. `new Pair(…)` does not, and TypeScript reads it
 *  off the constructor's arguments — which this front end, being syntactic, has no types for at
 *  the point the structs are collected. It is answered instead from the instances the file
 *  writes elsewhere: when there is exactly one, a bare `new` can only be building that one, and
 *  the ordinary argument check on its constructor catches a call that does not fit. With several
 *  the expression really is ambiguous here, and {@link ambiguousNew} says what to write. */
export function newInstanceName(
  node: ts.NewExpression,
  written: string,
  sourceFile: ts.SourceFile,
): string | undefined {
  const args = node.typeArguments ?? []
  const generics = classesOf(sourceFile)
  const key = resolveName(written, generics)
  if (key === undefined) return undefined
  if (args.length === 0) {
    const only = instancesOf(sourceFile).get(key) ?? []
    if (only.length === 1) return only[0]!.name
  }
  const read = readArguments(args, generics.get(key)!)
  if (read === undefined) return undefined
  const bound: ShaderType[] = []
  for (const arg of read) {
    const mapped = mapTsTypeToShaderType(arg, sourceFile, undefined)
    if (!mapped) return undefined
    bound.push(mapped)
  }
  return instanceName(key, bound)
}

/** Why `new Pair(…)` names no struct, when `Pair` is a generic class this file writes at more
 *  than one set of type arguments — or at none at all. Undefined for every other name, which is
 *  every ordinary `new`, and leaves the message to the caller. */
export function ambiguousNew(written: string, sourceFile: ts.SourceFile): string | undefined {
  const key = resolveName(written, classesOf(sourceFile))
  if (key === undefined) return undefined
  const instances = (instancesOf(sourceFile).get(key) ?? []).map((i) => i.name)
  if (instances.length === 0) {
    return (
      `"${written}" is generic, and nothing in this file says what to build it at. A struct is ` +
      `one layout, so each set of type arguments is a struct of its own: write ` +
      `"new ${written}<f32>(…)" with the type you mean, the way TypeScript lets you write it.`
    )
  }
  return (
    `"${written}" is generic and this file writes it at ${String(instances.length)} sets of type ` +
    `arguments (${instances.join(', ')}), so "new ${written}(…)" does not say which one to ` +
    `build. Write the type argument: "new ${written}<f32>(…)".`
  )
}

const INSTANCES = new WeakMap<ts.SourceFile, Map<string, StructInstance[]>>()

/** The instances the file writes, computed once. The diagnostics are dropped: this is asked
 *  while an expression is lowered, long after {@link writtenInstances} reported them where the
 *  structs were collected, and saying them a second time is the cascade T10 removed. */
function instancesOf(sourceFile: ts.SourceFile): Map<string, StructInstance[]> {
  const hit = INSTANCES.get(sourceFile)
  if (hit !== undefined) return hit
  const made = writtenInstances(
    sourceFile,
    classesOf(sourceFile),
    (node) => mapTsTypeToShaderType(node, sourceFile, undefined),
    [],
  )
  INSTANCES.set(sourceFile, made)
  return made
}
