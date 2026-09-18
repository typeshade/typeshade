// === Generics by monomorphisation (roadmap 0.3 item T9, #92) ===
//
// WGSL and GLSL ES 3.00 have no generics: every function has one signature and every struct one
// layout. TypeScript has generics and a shader author reaches for them, so this file compiles a
// generic declaration once per set of argument types the file uses it with, which is what
// monomorphisation is. `pick<T>` called on an f32 and on a vec3 emits `pick_f32` and
// `pick_vec3`, two ordinary functions, and each call site names the one it meant.
//
// The substitution is not an AST rewrite. A type parameter is a NAME, and `type-map.ts` is the
// one place a name becomes a `ShaderType`, so an instantiation binds `T` there and lowers the
// declaration's own nodes unchanged. {@link withTypeArguments} is what holds the binding, and
// it is dynamically scoped because the lowering that consults it runs many frames down: a local
// `const x: T` inside the body reaches the same map the signature did.
//
// What is NOT here is inference by a type checker. The front end reads syntax, so a type
// argument is either written at the call site or read off the lowered arguments by matching the
// parameter's type node against them, which covers `a: T`, `xs: array<T, N>` and nothing else.
// A parameter the match cannot reach is refused, naming the type argument as the fix.

import ts from 'typescript'
import { typeKey, type ShaderType } from '../../core/ir/types.js'
import type { TsCompilerDiagnostic } from './source-file.js'
import { makeDiagnostic } from './diagnostic.js'
import { TS_CODES } from './codes.js'

/** The type arguments in force, or undefined outside an instantiation. Dynamically scoped: see
 *  the file comment. One variable rather than a stack because an instantiation's body is lowered
 *  to completion before the next one starts, and {@link withTypeArguments} restores what it
 *  found — a generic calling a generic nests correctly. */
let BOUND: ReadonlyMap<string, ShaderType> | undefined

/** Run `f` with `args` bound as the type arguments, restoring whatever was bound before. */
export function withTypeArguments<R>(
  args: ReadonlyMap<string, ShaderType> | undefined,
  f: () => R,
): R {
  const saved = BOUND
  BOUND = args
  try {
    return f()
  } finally {
    BOUND = saved
  }
}

/** Bind `args` as the type arguments and return the undo. The imperative twin of
 *  {@link withTypeArguments}, for a caller whose body is a loop with `continue` in it: an
 *  arrow function would make that `continue` cross a function boundary. */
export function pushTypeArguments(args: ReadonlyMap<string, ShaderType> | undefined): () => void {
  const saved = BOUND
  BOUND = args
  return () => {
    BOUND = saved
  }
}

/** The type `name` is bound to right now, when it is a type parameter of the instantiation being
 *  lowered. Read by `type-map.ts` ahead of every other meaning of a type name, because a type
 *  parameter shadows in TypeScript too. */
export function boundTypeArgument(name: string): ShaderType | undefined {
  return BOUND?.get(name)
}

/** The emitted name of one instantiation: `pick` at f32 is `pick_f32`, at vec3 `pick_vec3`, and
 *  at a struct `pick_Ray`. One name per set of argument types, so two calls with the same types
 *  reach one function. */
export function instanceName(base: string, args: readonly ShaderType[]): string {
  return [base, ...args.map(typeSuffix)].join('_')
}

/** A type as it reads in a name: the spelling the author would have written. `typeKey` gives
 *  `vec3<f32>` and `struct:Ray`, neither of which is an identifier. */
export function typeSuffix(t: ShaderType): string {
  switch (t.kind) {
    case 'scalar':
      return t.scalar
    case 'f64':
      return 'f64'
    case 'vec':
      return `vec${String(t.n)}${t.elem === 'f32' ? '' : t.elem[0]!}`
    case 'vec64':
      return `vec${String(t.n)}f64`
    case 'mat':
      return `mat${String(t.n)}x${String(t.n)}`
    case 'struct':
      return t.name
    case 'array':
      return `array${t.size === undefined ? '' : String(t.size)}${typeSuffix(t.elem)}`
    default:
      return typeKey(t).replace(/[^A-Za-z0-9]/g, '')
  }
}

/** Read one type argument off a parameter: the parameter's WRITTEN type node matched against the
 *  type its argument lowered to. `a: T` against f32 gives T = f32; `xs: array<T, 3>` against
 *  `array<f32, 3>` gives the same. Anything else yields nothing, and the caller says so.
 *
 *  Deliberately structural and shallow. A checker would infer through any shape; this reads
 *  syntax, and a shape it cannot read is a type argument the author writes instead of one this
 *  guesses at. */
export function inferFrom(
  node: ts.TypeNode,
  actual: ShaderType,
  parameters: ReadonlySet<string>,
  out: Map<string, ShaderType>,
): void {
  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
    const name = node.typeName.text
    if (parameters.has(name)) {
      if (!out.has(name)) out.set(name, actual)
      return
    }
    // `array<T, N>` and any other generic name: match the arguments against the actual's parts.
    const args = node.typeArguments ?? []
    if (name === 'array' && args[0] !== undefined && actual.kind === 'array') {
      inferFrom(args[0], actual.elem, parameters, out)
    }
    return
  }
  if (ts.isTupleTypeNode(node) && actual.kind === 'array') {
    for (const element of node.elements) {
      inferFrom(
        ts.isNamedTupleMember(element) ? element.type : element,
        actual.elem,
        parameters,
        out,
      )
    }
  }
}

/** The names a declaration's type parameters bind, or an empty set when it has none. */
export const typeParameterNames = (
  parameters: ts.NodeArray<ts.TypeParameterDeclaration> | undefined,
): Set<string> => new Set((parameters ?? []).map((p) => p.name.text))

export const genericDiag = (
  sourceFile: ts.SourceFile,
  node: ts.Node,
  message: string,
): TsCompilerDiagnostic => makeDiagnostic(sourceFile, node, message, TS_CODES.UNKNOWN_TYPE)
