// === The mixin pattern, evaluated when the file is compiled (roadmap 0.3 item T8, #92) ===
//
// `class Body extends Positioned(Particle) { mass: f32 }` is a class whose base is decided by
// running a function. TypeScript runs it at run time and gets a constructor; there is no run
// time here, so this file runs it at compile time and gets a list of members.
//
// What makes that possible is what T5 already settled: a TypeShade struct is FLAT, and dispatch
// is STATIC. `Positioned(Particle)` has no observable existence of its own — no layout a value
// can have, no method anything can call through — so it is not collected as a struct. Its
// members are spliced into the class that applied it, ahead of that class's own and behind its
// base's, which is the order TypeScript's own mixin produces. Two classes applying one mixin
// each get their own copy of its methods, exactly as two classes extending one base do.
//
// The evaluation is deliberately small. A mixin is a function whose body is one
// `return class … { … }`; the class expression may extend the function's own parameter, which
// is where the argument goes, or a class this file declares, or nothing.

import ts from 'typescript'
import type { TsCompilerDiagnostic } from './source-file.js'
import { makeDiagnostic } from './diagnostic.js'
import { TS_CODES } from './codes.js'

/** What an `extends <expression>` clause comes to once the mixins in it have been run. */
export interface MixinApplication {
  /** The declared names left at the bottom of the chain, which are ordinary bases. */
  readonly bases: readonly string[]
  /** The class expressions applied, innermost first. Their members stand ahead of the applying
   *  class's own and behind its base's. */
  readonly bodies: readonly ts.ClassExpression[]
}

const diag = (sourceFile: ts.SourceFile, node: ts.Node, message: string): TsCompilerDiagnostic =>
  makeDiagnostic(sourceFile, node, message, TS_CODES.UNSUPPORTED)

/** The function `callee` names, when this file declares one at the top level. */
function mixinFunction(
  callee: ts.Expression,
  sourceFile: ts.SourceFile,
): ts.FunctionDeclaration | undefined {
  if (!ts.isIdentifier(callee)) return undefined
  for (const stmt of sourceFile.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === callee.text && stmt.body) return stmt
  }
  return undefined
}

/** The class expression a mixin function returns, when its body is exactly one return of one.
 *  A mixin has no other shape here: there is nothing for a second statement to do at compile
 *  time, and a body that returns something else returns no class. */
function returnedClass(fn: ts.FunctionDeclaration): ts.ClassExpression | undefined {
  const statements = fn.body?.statements ?? []
  if (statements.length !== 1) return undefined
  const only = statements[0]
  if (only === undefined || !ts.isReturnStatement(only) || !only.expression) return undefined
  return unwrapClass(only.expression)
}

/** The name a class expression extends, or undefined when it extends nothing. */
function extendsName(node: ts.ClassExpression): ts.Identifier | undefined {
  for (const h of node.heritageClauses ?? []) {
    if (h.token !== ts.SyntaxKind.ExtendsKeyword) continue
    const first = h.types[0]?.expression
    if (first !== undefined && ts.isIdentifier(first)) return first
  }
  return undefined
}

/** The module-level `const X = <call>` an identifier names, which is the other half of the
 *  spelling the TypeScript handbook uses: `const Mixed = Positioned(Particle)`, then
 *  `class Body extends Mixed`. */
function constBoundCall(
  name: ts.Identifier,
  sourceFile: ts.SourceFile,
): ts.CallExpression | undefined {
  for (const stmt of sourceFile.statements) {
    if (!ts.isVariableStatement(stmt)) continue
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || decl.name.text !== name.text) continue
      if (decl.initializer && ts.isCallExpression(decl.initializer)) return decl.initializer
    }
  }
  return undefined
}

/** Whether `fn` returns a class: a mixin, or an attempt at one. Such a function has no shader
 *  form — a class expression is no GPU value — so it emits no function, and what it is for
 *  happens where it is applied, in {@link applyMixins} (T8, #92).
 *
 *  Deliberately wider than {@link returnedClass}, which is what the evaluation accepts. A
 *  function whose body is a return of a class AND something else is a mixin this cannot run,
 *  and `applyMixins` says so where it is applied; lowering it as an ordinary function as well
 *  would add "Unsupported expression" about the class, on the same one mistake. */
export function isMixinDeclaration(fn: ts.FunctionDeclaration): boolean {
  if (fn.body === undefined) return false
  for (const stmt of fn.body.statements) {
    if (!ts.isReturnStatement(stmt) || !stmt.expression) continue
    if (unwrapClass(stmt.expression) !== undefined) return true
  }
  return false
}

/** The class expression `node` is, through the wrappers a mixin is usually written with:
 *  `class X {}`, `(class X {})`, `class X {} as Ctor`. */
function unwrapClass(node: ts.Expression): ts.ClassExpression | undefined {
  if (ts.isClassExpression(node)) return node
  if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node)) {
    return unwrapClass(node.expression)
  }
  return undefined
}

/** Whether `decl` is `const X = <mixin>(…)`: a mixin applied and given a name, the spelling
 *  the TypeScript handbook uses. It holds a class, not a value, so it is no module constant. */
export function isMixinApplication(
  decl: ts.VariableDeclaration,
  sourceFile: ts.SourceFile,
): boolean {
  const init = decl.initializer
  if (init === undefined || !ts.isCallExpression(init)) return false
  const fn = mixinFunction(init.expression, sourceFile)
  return fn !== undefined && isMixinDeclaration(fn)
}

/** Whether `expression` is a heritage this file has to run rather than resolve: a call, or a
 *  name bound to one. Read before the ordinary identifier path, so an `extends Base` naming a
 *  class stays exactly what it was. */
export function isMixinHeritage(expression: ts.Expression, sourceFile: ts.SourceFile): boolean {
  if (ts.isCallExpression(expression)) return true
  return ts.isIdentifier(expression) && constBoundCall(expression, sourceFile) !== undefined
}

/** Run the mixins in one `extends` clause and return what is left: the declared bases, and the
 *  class expressions whose members the applying class carries. Reports and returns undefined
 *  for a shape this cannot run, naming what a mixin looks like here. */
export function applyMixins(
  owner: string,
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  seen: ReadonlySet<string> = new Set(),
): MixinApplication | undefined {
  if (ts.isIdentifier(expression)) {
    const bound = constBoundCall(expression, sourceFile)
    if (bound !== undefined) return applyMixins(owner, bound, sourceFile, diagnostics, seen)
    return { bases: [expression.text], bodies: [] }
  }
  if (!ts.isCallExpression(expression)) {
    diagnostics.push(
      diag(
        sourceFile,
        expression,
        `"${owner}" extends an expression this file cannot run when it is compiled. A base is ` +
          `a declared class, or a mixin: a call to a function of this file whose body is one ` +
          `"return class … { … }".`,
      ),
    )
    return undefined
  }
  const callee = expression.expression
  const shown = callee.getText(sourceFile)
  const fn = mixinFunction(callee, sourceFile)
  if (fn === undefined) {
    diagnostics.push(
      diag(
        sourceFile,
        expression,
        `"${owner}" extends "${shown}(…)", and this file declares no function "${shown}". A ` +
          `mixin is a function of this file, since its class expression is read where it is ` +
          `written.`,
      ),
    )
    return undefined
  }
  const name = fn.name?.text ?? shown
  if (seen.has(name)) {
    diagnostics.push(
      diag(
        sourceFile,
        expression,
        `Mixin "${name}" is applied to itself, so it has no members to give. A mixin chain ` +
          `has to end at a declared class or at nothing.`,
      ),
    )
    return undefined
  }
  const body = returnedClass(fn)
  if (body === undefined) {
    diagnostics.push(
      diag(
        sourceFile,
        fn.name ?? fn,
        `"${name}" is applied as a mixin by "${owner}", so its body has to be one ` +
          `"return class … { … }". There is no run time here for anything else in it to ` +
          `happen in.`,
      ),
    )
    return undefined
  }
  if (expression.arguments.length > 1) {
    diagnostics.push(
      diag(
        sourceFile,
        expression.arguments[1] ?? expression,
        `"${name}(…)" takes the one base its class expression extends, and got ` +
          `${String(expression.arguments.length)} arguments.`,
      ),
    )
    return undefined
  }
  const extended = extendsName(body)
  const parameter = fn.parameters[0]
  const parameterName =
    parameter !== undefined && ts.isIdentifier(parameter.name) ? parameter.name.text : undefined
  const argument = expression.arguments[0]
  const next = new Set([...seen, name])
  // The class expression extends the mixin function's own parameter: that is the substitution
  // point, and the argument written at the call site goes there. A class expression extending
  // anything else names a base of its own, and one extending nothing has none.
  if (extended !== undefined && extended.text === parameterName) {
    if (argument === undefined) {
      diagnostics.push(
        diag(
          sourceFile,
          expression,
          `"${name}(…)" extends its parameter "${parameterName}", so it needs the base to ` +
            `extend; "${owner}" passes none.`,
        ),
      )
      return undefined
    }
    const inner = applyMixins(owner, argument, sourceFile, diagnostics, next)
    if (inner === undefined) return undefined
    return { bases: inner.bases, bodies: [...inner.bodies, body] }
  }
  if (argument !== undefined) {
    diagnostics.push(
      diag(
        sourceFile,
        argument,
        `"${name}(…)" was given a base, and the class it returns extends ` +
          `${extended === undefined ? 'nothing' : `"${extended.text}"`}, so the base would go ` +
          `nowhere. Write "class ${extended === undefined ? 'X' : extended.text} extends ` +
          `${parameterName ?? 'Base'}" in "${name}", or drop the argument.`,
      ),
    )
    return undefined
  }
  return { bases: extended === undefined ? [] : [extended.text], bodies: [body] }
}

/** The name a class member is declared under, when it has a plain one. A constructor answers
 *  `constructor`, so a class writing its own drops the mixin's. */
const isAccessorHalf = (member: ts.ClassElement): member is ts.AccessorDeclaration =>
  ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)

function memberKey(member: ts.ClassElement): string | undefined {
  if (ts.isConstructorDeclaration(member)) return 'constructor'
  if (member.name !== undefined && ts.isIdentifier(member.name)) return member.name.text
  return undefined
}

/** The type a property member is written with, for the one collision that is not an override
 *  but a change of layout. Compared as written: two spellings of one type read as different
 *  here, which is the safe direction — it asks rather than silently picking one. */
function writtenType(member: ts.ClassElement, sourceFile: ts.SourceFile): string | undefined {
  if (!ts.isPropertyDeclaration(member)) return undefined
  return member.type?.getText(sourceFile) ?? ''
}

/** The members a class carries once its mixins are applied: each mixin's in the order the
 *  chain applied them, innermost first, then the class's own. That is the order TypeScript's
 *  mixin produces, and it is what puts a field where the base's fields end.
 *
 *  A name declared more than once in the chain is an override, and the declaration closest to
 *  the value wins: the class over every mixin, an outer mixin over an inner one. Silently, the
 *  way a subclass method overrides a base's. Two FIELDS of that name written with different
 *  types are the one case that is not an override but a change of layout, and it is reported.
 */
export function mixedMembers(
  bodies: readonly ts.ClassExpression[],
  own: ts.NodeArray<ts.ClassElement>,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  owner: string,
): readonly ts.ClassElement[] {
  if (bodies.length === 0) return own
  const winner = new Map<string, ts.ClassElement>()
  for (const member of own) {
    const key = memberKey(member)
    if (key !== undefined) winner.set(key, member)
  }
  // Outermost first, so the first declaration seen for a name is the one that wins; the kept
  // members are collected per body so they can be emitted innermost first below.
  const kept: ts.ClassElement[][] = bodies.map(() => [])
  for (let i = bodies.length - 1; i >= 0; i--) {
    for (const member of bodies[i]!.members) {
      const key = memberKey(member)
      if (key === undefined) {
        kept[i]!.push(member)
        continue
      }
      const held = winner.get(key)
      // The getter and the setter of one property share its name and are one member, so the
      // second half of a pair one body declares is kept beside the first (Rule 8.11).
      if (held !== undefined && isAccessorHalf(held) && isAccessorHalf(member)) {
        if (held.parent === member.parent) kept[i]!.push(member)
        continue
      }
      if (held !== undefined) {
        const a = writtenType(held, sourceFile)
        const b = writtenType(member, sourceFile)
        if (a !== undefined && b !== undefined && a !== b) {
          diagnostics.push(
            diag(
              sourceFile,
              member,
              `"${owner}" gets the field "${key}" twice through its mixins, written "${b}" in ` +
                `one and "${a}" in another. One of them decides the layout, and picking either ` +
                `silently would change what the other's code reads. Give them one type, or ` +
                `two names.`,
            ),
          )
        }
        continue
      }
      winner.set(key, member)
      kept[i]!.push(member)
    }
  }
  return [...kept.flat(), ...own]
}
