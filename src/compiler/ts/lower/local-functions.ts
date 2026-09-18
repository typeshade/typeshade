// ═══ A local function (roadmap 0.3 item T7, #92) ═══
//
// `const f = (x: f32): f32 => x * 2.` is how a TypeScript developer writes a helper they only
// need in one place, and `const f = function (x: f32): f32 { ... }` is the older spelling of
// it. Both were "TS8099 Unsupported expression", and the call after them "Unknown function".
//
// Neither target has a function value, so a local function is a FUNCTION OF THE MODULE, named
// after the body that declares it: `f` inside `fs` emits `fn fs_f`. The name is what makes two
// helpers called `f` in two functions not collide, and the call site resolves through an alias
// the scope carries, so the body still writes `f(x)`.
//
// What a local function may not do is CAPTURE. A shader function takes its arguments and reads
// the module; there is no environment to carry, and no closure to allocate one in. A name from
// the enclosing body is refused where it is written, with the parameter to add instead. That is
// the one rule that separates this from an ordinary function declaration, which is why the
// check is here and not in the shared signature parsing.

import ts from 'typescript'
import type { FuncDecl } from '../../../core/ir/nodes.js'
import type { TsCompilerDiagnostic } from '../source-file.js'
import type { CollectedStruct } from '../structs.js'
import { TS_CODES } from '../codes.js'
import { makeDiagnostic } from '../diagnostic.js'
import { spanOf } from '../span.js'
import { parseParams, parseReturnType } from './function.js'

/** The two spellings of a function written as a value. */
export type LocalFunctionNode = ts.ArrowFunction | ts.FunctionExpression

/** One local function, ready to have its body filled like any other. */
export interface LocalFunction {
  readonly node: LocalFunctionNode
  readonly stub: FuncDecl
  /** The name the source calls it by, inside the body that declares it. */
  readonly localName: string
  /** The function whose body declares it, by its emitted name, or '' at the module top level. */
  readonly ownerName: string
  /** The declaration, to anchor a diagnostic and to know which statement to drop. */
  readonly decl: ts.VariableDeclaration
}

/** The emitted name of a local function: `fs_f` for `f` inside `fs`, and `f` at the top level,
 *  where it is a module function already. */
export const localFnName = (owner: string, local: string): string =>
  owner === '' ? local : `${owner}_${local}`

/** The function a `const f = ...` declares, or undefined when the initializer is not one. */
export function localFunctionOf(decl: ts.VariableDeclaration): LocalFunctionNode | undefined {
  const init = decl.initializer
  if (!init) return undefined
  if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) return init
  return undefined
}

/** Every local function declared directly in `body`'s statements, with its signature parsed.
 *  Nested ones are found too, since a local function's own body is walked as an owner in turn.
 *
 *  `ownerName` is the emitted name of the body being walked, which is what the local functions
 *  in it are named after. `enclosing` is every name in scope from that body, which a local
 *  function may not read. */
export function collectLocalFunctions(
  decls: readonly ts.VariableDeclaration[],
  ownerName: string,
  enclosing: ReadonlySet<string>,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  structs: readonly CollectedStruct[],
  /** The file's refused-declaration set (roadmap 0.3 item T10, #92), which each refusal below
   *  adds its emitted name to, so a call to it in the same body says nothing on top of the
   *  reason this function already gave. */
  refused?: Set<string>,
): LocalFunction[] {
  const out: LocalFunction[] = []
  for (const decl of decls) {
    const node = localFunctionOf(decl)
    if (!node) continue
    if (!ts.isIdentifier(decl.name)) continue
    const local = decl.name.text
    const shown = ownerName === '' ? local : `${local}" in "${ownerName}`
    const refuse = (): void => {
      refused?.add(localFnName(ownerName, local))
    }
    if (!isConst(decl)) {
      push(
        diagnostics,
        sourceFile,
        decl,
        `"${local}" is a function, so it is declared with const; a "let" would let the name ` +
          `point at another one, which no shader value does.`,
        TS_CODES.FUNCTION_SHAPE,
      )
      refuse()
      continue
    }
    if (decl.type) {
      push(
        diagnostics,
        sourceFile,
        decl.type,
        `"${local}" is a function; its types are written on its own parameters and after ` +
          `them, not as a type on the const.`,
        TS_CODES.FUNCTION_SHAPE,
      )
      refuse()
      continue
    }
    if (ts.isArrowFunction(node) && !ts.isBlock(node.body) && !node.type) {
      push(
        diagnostics,
        sourceFile,
        node,
        `"${local}" returns a value straight away, so it needs a return type: write ` +
          `"(x: f32): f32 => ...".`,
        TS_CODES.FUNCTION_SHAPE,
      )
      refuse()
      continue
    }
    if (node.asteriskToken || node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) {
      push(
        diagnostics,
        sourceFile,
        node,
        `"${local}" is a plain function or nothing: no async, no generator.`,
        TS_CODES.FUNCTION_SHAPE,
      )
      refuse()
      continue
    }
    const name = localFnName(ownerName, local)
    const params = parseParams(node.parameters, sourceFile, diagnostics, structs, undefined, {
      owner: shown,
    })
    if (!params) {
      refuse()
      continue
    }
    if (
      refuseCapture(
        node,
        new Set(params.map((p) => p.name)),
        enclosing,
        local,
        sourceFile,
        diagnostics,
      )
    ) {
      refuse()
      continue
    }
    const ret = parseReturnType(node.type, shown, node, sourceFile, diagnostics, structs, undefined)
    if (!ret) {
      refuse()
      continue
    }
    const stub: FuncDecl = { name, params, ret, body: [] }
    ;(stub as { span?: unknown }).span = spanOf(sourceFile, node)
    ;(stub as { nameSpan?: unknown }).nameSpan = spanOf(sourceFile, decl.name)
    out.push({ node, stub, localName: local, ownerName, decl })
  }
  return out
}

/** The names a body binds, which a local function inside it may not read: the enclosing
 *  function's parameters and every `let`/`const` it declares, at any depth. */
export function boundNamesOf(node: ts.Node, params: readonly string[]): Set<string> {
  const out = new Set<string>(params)
  const walk = (n: ts.Node): void => {
    // A nested function's parameters and locals are ITS names, not this body's, so a helper
    // inside a helper is checked against its own enclosing body and not against both.
    if (ownsItsBody(n)) return
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) out.add(n.name.text)
    ts.forEachChild(n, walk)
  }
  ts.forEachChild(node, walk)
  return out
}

/** True for a node that owns its own body, and so its own local functions and bound names:
 *  the walks below stop at one rather than reading its insides as this body's. */
function ownsItsBody(n: ts.Node): boolean {
  return (
    ts.isArrowFunction(n) ||
    ts.isFunctionExpression(n) ||
    ts.isFunctionDeclaration(n) ||
    ts.isMethodDeclaration(n) ||
    ts.isConstructorDeclaration(n) ||
    ts.isModuleDeclaration(n) ||
    ts.isClassDeclaration(n)
  )
}

/** Every variable declaration written directly in `body`, without descending into anything
 *  that owns its own body: those belong to it, as its own owner. */
export function declarationsIn(body: ts.Node): ts.VariableDeclaration[] {
  const out: ts.VariableDeclaration[] = []
  const walk = (n: ts.Node): void => {
    if (ownsItsBody(n)) return
    if (ts.isVariableDeclaration(n)) out.push(n)
    ts.forEachChild(n, walk)
  }
  ts.forEachChild(body, walk)
  return out
}

function isConst(decl: ts.VariableDeclaration): boolean {
  const list = decl.parent
  return ts.isVariableDeclarationList(list) && (list.flags & ts.NodeFlags.Const) !== 0
}

/** Refuse, having reported it, a name the local function reads from the body around it. */
function refuseCapture(
  node: LocalFunctionNode,
  params: ReadonlySet<string>,
  enclosing: ReadonlySet<string>,
  local: string,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): boolean {
  const own = new Set<string>(params)
  let found: { at: ts.Node; name: string } | undefined
  const walk = (n: ts.Node): void => {
    if (found) return
    // A function written inside this one checks its own body against its own enclosing names.
    if (n !== node.body && ownsItsBody(n)) return
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) own.add(n.name.text)
    if (ts.isPropertyAccessExpression(n)) {
      walk(n.expression)
      return
    }
    if (ts.isPropertyAssignment(n)) {
      walk(n.initializer)
      return
    }
    if (ts.isIdentifier(n) && enclosing.has(n.text) && !own.has(n.text)) {
      found = { at: n, name: n.text }
      return
    }
    ts.forEachChild(n, walk)
  }
  walk(node.body)
  if (!found) return false
  push(
    diagnostics,
    sourceFile,
    found.at,
    `"${local}" reads "${found.name}" from the function around it. A shader function takes its ` +
      `arguments and reads the module; there is no environment for it to carry one in. Pass ` +
      `"${found.name}" as a parameter.`,
    TS_CODES.UNSUPPORTED,
  )
  return true
}

function push(
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
  node: ts.Node,
  message: string,
  code: (typeof TS_CODES)[keyof typeof TS_CODES],
): void {
  diagnostics.push(makeDiagnostic(sourceFile, node, message, code))
}
