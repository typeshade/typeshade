// ═══ Parameter qualifiers: `@inout` and `@out` (Rule 8.25, surface §70, proposal 0040) ═══
//
// A function of the file may take the caller's place instead of a copy of its value: `@inout p:
// T` or `@out p: T` on the parameter, and the variable itself, unmarked, at the call. The model is
// the one a method that changes its object already has (Rule 8.10): the IR marks the parameter
// `mode: 'inout'`, the callee's body reads and writes it as a local, and each target spells it its
// own way, a pointer on WGSL (`swap(&x, &y)`, `*a = *b`), an `inout` qualifier on GLSL ES 3.00, a
// copy in and a store back on the CPU. Nothing new reaches the IR: `@out`'s definite writes
// (`definite.ts`) make it equal to `@inout` on every target.
//
// This file is the front end's half that is new: what such a parameter may be handed (the place
// rule a method's object already follows), which parameters are `@out`, and the one check a call
// with references gets, two references to one place (`checkReferenceAliases`).

import ts from 'typescript';
import type {
  BindingDecl,
  Expr,
  FuncDecl,
  ModuleDecl,
  ModuleVarDecl,
  Stmt,
} from '../../../core/ir/nodes.js';
import { typeKey, type ShaderType } from '../../../core/ir/types.js';
import { eachExpr, eachStmtExpr } from '../../../core/ir/visit.js';
import { fnReads, fnWrites } from '../../../core/passes/effects.js';
import { sourceSpanOf } from '../../../core/ir/span.js';
import type { TsCompilerDiagnostic } from '../source-file.js';
import {
  authorTypeText,
  irNameOf,
  readOnlyPhrase,
  writableRemedy,
  writeRules,
  type LoweringScope,
} from '../context.js';
import { diagnosticAtSpan, makeDiagnostic } from '../diagnostic.js';
import { TS_CODES } from '../codes.js';
import { lowerLValue } from './statement.js';
import { QUALIFIER_NAMES } from '../builtin-check.js';

/** The parameters declared `@out`, which `definite.ts` holds to their definite writes and
 *  whose argument assigns the caller's local (proposal 0043). The IR keeps one mode for `@inout`
 *  and `@out`, so the front end keeps this mark beside it. */
const OUT_PARAMS = new WeakSet<object>();

/** Mark `param` as one written `@out`. */
export function markOutParam(param: FuncDecl['params'][number]): void {
  OUT_PARAMS.add(param);
}

/** Whether `param` was written `@out`. */
export function isOutParam(param: FuncDecl['params'][number] | undefined): boolean {
  return param !== undefined && OUT_PARAMS.has(param);
}

/** The qualifier decorators written on `p` (`@inout`, `@out`), in source order. */
export function qualifiersOf(p: ts.ParameterDeclaration): { name: string; node: ts.Decorator }[] {
  const out: { name: string; node: ts.Decorator }[] = [];
  for (const d of ts.canHaveDecorators(p) ? (ts.getDecorators(p) ?? []) : []) {
    if (ts.isIdentifier(d.expression) && QUALIFIER_NAMES.includes(d.expression.text)) {
      out.push({ name: d.expression.text, node: d });
    }
  }
  return out;
}

/** The function of the file a call written `callee(...)` or `N.callee(...)` names, read off the
 *  source before any body is lowered, or `undefined` for anything else. */
export function fileFunctionCalled(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
): ts.FunctionDeclaration | undefined {
  const path: string[] = [];
  let at: ts.Expression = call.expression;
  while (ts.isPropertyAccessExpression(at)) {
    path.unshift(at.name.text);
    at = at.expression;
  }
  if (!ts.isIdentifier(at)) return undefined;
  path.unshift(at.text);
  let statements: readonly ts.Statement[] = sourceFile.statements;
  for (const [i, name] of path.entries()) {
    const last = i === path.length - 1;
    let next: readonly ts.Statement[] | undefined;
    for (const st of statements) {
      if (last && ts.isFunctionDeclaration(st) && st.name?.text === name && st.body) return st;
      if (!last && ts.isModuleDeclaration(st) && st.name.text === name) {
        let b = st.body;
        while (b !== undefined && ts.isModuleDeclaration(b)) b = b.body;
        if (b !== undefined && ts.isModuleBlock(b)) next = b.statements;
      }
    }
    if (next === undefined) return undefined;
    statements = next;
  }
  return undefined;
}

/** Whether `call` hands its argument at `index` to an `@inout` or `@out` parameter of a function
 *  of the file. */
export function writesThroughArgument(
  call: ts.CallExpression,
  index: number,
  sourceFile: ts.SourceFile,
): boolean {
  const p = fileFunctionCalled(call, sourceFile)?.parameters[index];
  return p !== undefined && qualifiersOf(p).length > 0;
}

/** `e` without the parentheses around it. */
function bare(e: ts.Expression): ts.Expression {
  let x = e;
  while (ts.isParenthesizedExpression(x)) x = x.expression;
  return x;
}

/** The argument an `@inout` or `@out` parameter takes, lowered as the place it names: `x`,
 *  `o.a`, `xs[i]`, `buf[i]` on a `read_write` storage binding, or a qualified parameter the
 *  caller holds itself, passed on as it is. Anything else is refused, with the edit, having said
 *  why.
 *
 *  The argument takes what a method that changes its object takes as that object (Rule 8.10): a
 *  `let`, a `const` whose initializer built its value (Rule 6.10), a module variable, a storage
 *  element, `this` where it is written, or a field or an element of one; and in addition a
 *  vector's component is refused, whose address WGSL does not take. */
export function lowerReferenceArgument(
  arg: ts.Expression,
  param: FuncDecl['params'][number],
  shown: string,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const push = (node: ts.Node, message: string): undefined => {
    diagnostics.push(makeDiagnostic(sourceFile, node, message, TS_CODES.REFERENCE));
    return undefined;
  };
  const qualifier = isOutParam(param) ? '@out' : '@inout';
  const takes =
    `"${shown}" writes "${param.name}" back to the caller (${qualifier} ` +
    `${param.name}: ${authorTypeText(param.type)})`;
  const place = bare(arg);
  // A qualified parameter the caller holds is passed on as the same place (Rule 8.25), and so is
  // one a local function captures, which the local function then takes by reference (Rule 8.17).
  if (ts.isIdentifier(place)) {
    const held = scope.resolve(place.text);
    if (held !== undefined && writeRules(held).reference === true) {
      held.capture?.byRef();
      return {
        op: held.kind === 'param' ? 'param' : 'varref',
        type: held.type,
        name: irNameOf(held),
      };
    }
  }
  // The root of the chain decides, as it does for a method's object: `o.a` and `xs[i]` are
  // places when `o` and `xs` are.
  const root = rootIdentifier(place);
  if (root !== undefined) {
    const found = scope.resolve(root.text);
    const b = found === undefined ? undefined : writeRules(found);
    if (b !== undefined && b.reference !== true && b.kind === 'param' && b.space !== 'storage') {
      return push(
        place,
        `${takes}, and "${root.text}" is a parameter that holds a copy of its caller's value, ` +
          `which this function cannot hand on as a place. Declare it "@inout ${root.text}: ` +
          `${authorTypeText(b.type)}" to pass its caller's place on, or copy it into a let.`,
      );
    }
    // `const v = new V(); f(v)`: a `const` that holds a value nothing else does is written
    // through as TypeScript's is, and becomes a `var` (Rule 6.10).
    if (b !== undefined && !b.mutable && b.toVar !== undefined) b.toVar();
    if (b !== undefined && !b.mutable) {
      const shared = b.kind === 'local' && b.type.kind === 'struct';
      return push(
        place,
        shared
          ? `${takes}, and "${root.text}" is a const whose value may be one something else ` +
              `holds, which the call would change with it. Declare it with let.`
          : b.kind === 'binding'
            ? `${takes}, and "${root.text}" is ${readOnlyPhrase(b.kind)}.` +
              writableRemedy(b, sourceFile)
            : `${takes}, and "${root.text}" is ${readOnlyPhrase(b.kind)}; declare it with let.`,
      );
    }
  }
  if (
    ts.isCallExpression(place) ||
    ts.isNewExpression(place) ||
    ts.isLiteralExpression(place) ||
    place.kind === ts.SyntaxKind.TrueKeyword ||
    place.kind === ts.SyntaxKind.FalseKeyword ||
    ts.isBinaryExpression(place) ||
    ts.isPrefixUnaryExpression(place) ||
    ts.isConditionalExpression(place) ||
    ts.isObjectLiteralExpression(place) ||
    ts.isArrayLiteralExpression(place)
  ) {
    return push(
      place,
      `${takes}, and "${place.getText(sourceFile)}" is a value nothing holds, so there is no ` +
        `place to write. Keep it in a let and pass the let.`,
    );
  }
  const lowered = lowerLValue(place, sourceFile, scope, diagnostics, true);
  if (lowered === undefined) return undefined;
  const part = partIn(lowered);
  if (part !== undefined) {
    return push(
      place,
      `${takes}, and "${place.getText(sourceFile)}" is a component of the vector ` +
        `${authorTypeText(part)}, which no target takes the address of. Pass the whole ` +
        `vector, or copy the component into a let and pass the let.`,
    );
  }
  if (typeKey(lowered.type) !== typeKey(param.type)) {
    return push(
      place,
      `${takes}, and "${place.getText(sourceFile)}" is ${authorTypeText(lowered.type)}. The ` +
        `place must be of exactly the parameter's type.`,
    );
  }
  return lowered;
}

/** The name at the root of a place as written: `o` for `o.a[i]`, `x` for `x`. */
function rootIdentifier(place: ts.Expression): ts.Identifier | undefined {
  let at = bare(place);
  while (ts.isPropertyAccessExpression(at) || ts.isElementAccessExpression(at)) {
    at = bare(at.expression);
  }
  return ts.isIdentifier(at) ? at : undefined;
}

/** The vector `place` reaches into, when it is a component of one: `v.x`, `v.xy`, `v[i]`, and
 *  `m[i].x` through a matrix's column. WGSL takes no address of a vector's component. A matrix's
 *  column itself, `m[i]`, is a place, as WGSL has it, and the CPU paths store it back through
 *  their column helpers. */
function partIn(place: Expr): ShaderType | undefined {
  for (let at = place; ;) {
    if (at.op !== 'member' && at.op !== 'index') return undefined;
    const kind = at.base.type.kind;
    if (kind === 'vec' || kind === 'vec64') return at.base.type;
    at = at.base;
  }
}

/** The name an l-value is reached through: `ps[i].pos` is reached through `ps`. */
function rootOf(e: Expr): string | undefined {
  for (let at = e; ;) {
    if (at.op === 'varref' || at.op === 'param') return at.name;
    if (at.op === 'member' || at.op === 'index') {
      at = at.base;
      continue;
    }
    return undefined;
  }
}

/** Two references to one place in one call, refused where the call is written (Rule 8.25).
 *
 *  Every argument a callee takes by reference counts: an `@inout` or `@out` parameter's, the object of a
 *  method that changes it, and a variable a local function writes (Rules 8.10 and 8.17), which
 *  the IR carries alike as `mode: 'inout'`. Two of them whose places share a root, when the
 *  callee writes either, are one place reached two ways: WGSL's alias analysis refuses the
 *  call, and GLSL's copy-in and copy-out and the CPU's store back would each settle it in an
 *  order of their own. So is a reference to a module variable or a binding the callee reads or
 *  writes by its name, when either side is written. Run once every body is lowered, since a
 *  callee's reads and writes are read off its body.
 *
 *  Measured on Tint (Chromium's WebGPU on SwiftShader, 2026-10-05, whose
 *  `wgslLanguageFeatures` list `unrestricted_pointer_parameters`), each with `fn f(a: ptr<…>,
 *  b: ptr<…>)` or `fn g(p: ptr<private, f32>)`:
 *
 *    f(&x, &x), f writes *a                      REFUSED "invalid aliased pointer argument"
 *    f(&o.a, &o.b), f writes *a                  REFUSED "invalid aliased pointer argument"
 *    f(&o.a, &o.b), f only reads                 accepted
 *    f(&x, &y)                                   accepted
 *    g(&c), g writes c and *p                    REFUSED "invalid aliased pointer argument"
 *    g(&c), g reads c and writes *p              REFUSED "invalid aliased pointer argument"
 *    g(&c), g reads c and *p                     accepted
 *    g(&c), g touches *p only                    accepted
 *    g(&xs[1]) on a function-space array         accepted
 *
 *  So the rule below refuses exactly the refused rows, in the author's words, before Tint
 *  (Rules 12.6 and 13.3). */
export function checkReferenceAliases(
  funcs: readonly FuncDecl[],
  bindings: readonly BindingDecl[],
  vars: readonly ModuleVarDecl[],
  shownOf: (fn: string) => string,
  fallbackOf: (fn: string) => ts.Node | undefined,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): void {
  if (!funcs.some((f) => f.params.some((p) => p.mode === 'inout'))) return;
  // The tables the optimizer reads, on the module as far as the front end has it.
  const module = { funcs, bindings, vars, structs: [], consts: [] } as unknown as ModuleDecl;
  const reads = fnReads(module);
  const writes = fnWrites(module);
  const byName = new Map(funcs.map((f) => [f.name, f]));
  const moduleNames = new Set([...bindings.map((b) => b.name), ...vars.map((v) => v.name)]);
  const said = new Set<string>();
  for (const f of funcs) {
    const visit = (x: Expr): void => {
      if (x.op !== 'call') return;
      const callee = byName.get(x.fn);
      if (callee === undefined) return;
      const written = writes.get(callee.name) ?? new Set<string>();
      const touched = new Set([...(reads.get(callee.name) ?? []), ...written]);
      const refs: { root: string; writes: boolean }[] = [];
      callee.params.forEach((p, i) => {
        if (p.mode !== 'inout') return;
        const root = x.args[i] === undefined ? undefined : rootOf(x.args[i]!);
        if (root !== undefined) refs.push({ root, writes: written.has(p.name) });
      });
      const report = (message: string): void => {
        const span = sourceSpanOf(x);
        const key = `${f.name}|${String(span?.start)}|${message}`;
        if (said.has(key)) return;
        said.add(key);
        diagnostics.push(
          diagnosticAtSpan(sourceFile, span, fallbackOf(f.name), message, TS_CODES.REFERENCE_ALIAS),
        );
      };
      const shown = shownOf(callee.name);
      for (let i = 0; i < refs.length; i++) {
        for (let j = i + 1; j < refs.length; j++) {
          if (refs[i]!.root !== refs[j]!.root || !(refs[i]!.writes || refs[j]!.writes)) continue;
          report(
            `This call hands "${refs[i]!.root}" to "${shown}" by reference twice, as two places ` +
              `it may change: one variable reached two ways, which WGSL refuses and which ` +
              `GLSL's copy-in and copy-out would settle in no fixed order (Rule 8.25). Pass ` +
              `distinct variables, or copy one into a let and pass the let.`,
          );
        }
      }
      for (const r of refs) {
        if (!moduleNames.has(r.root) || !touched.has(r.root)) continue;
        if (!r.writes && !written.has(r.root)) continue;
        report(
          `This call hands "${r.root}" to "${shown}" by reference, and "${shown}" also reads ` +
            `or writes "${r.root}" by its name: one variable reached two ways, which WGSL ` +
            `refuses (Rule 8.25). Use the reference alone inside "${shown}", or pass a copy.`,
        );
      }
    };
    for (const s of f.body as readonly Stmt[]) eachStmtExpr(s, (e) => eachExpr(e, visit));
  }
}
