// ═══ Reference parameters: `p: Ref<T>` and `ref(place)` (Rule 8.25, surface §70, proposal 0040) ═══
//
// A function of the file may take the caller's place instead of a copy of its value: `p: Ref<T>`
// on the parameter, `ref(x)` at the call. The model is the one a method that changes its object
// already has (Rule 8.10): the IR marks the parameter `mode: 'inout'`, the callee's body reads
// and writes it as a local, and each target spells it its own way, a pointer on WGSL
// (`swap(&x, &y)`, `*a = *b`), an `inout` qualifier on GLSL ES 3.00, a copy in and a store back
// on the CPU. Nothing new reaches the IR.
//
// This file is the front end's half that is new: what `ref(...)` may be handed (the place rule a
// method's object already follows), where `ref(...)` and a reference may stand, and the one
// check a call with references gets, two references to one place (`checkReferenceAliases`).

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
  readOnlyPhrase,
  writableRemedy,
  writeRules,
  type LoweringScope,
} from '../context.js';
import { diagnosticAtSpan, makeDiagnostic } from '../diagnostic.js';
import { TS_CODES } from '../codes.js';
import { lowerLValue } from './statement.js';

/** The library's function that passes a place, `ref(x)` (Rule 9.6). */
export const REFERENCE_FUNCTION = 'ref';

/** `e` without the parentheses around it. */
function bare(e: ts.Expression): ts.Expression {
  let x = e;
  while (ts.isParenthesizedExpression(x)) x = x.expression;
  return x;
}

/** Whether `node` is a call of the library's `ref`, and not of a function the file declares
 *  under that name, which is the file's (Rule 2.1). */
export function isReferenceCall(node: ts.Expression, scope: LoweringScope): boolean {
  const call = bare(node);
  return (
    ts.isCallExpression(call) &&
    ts.isIdentifier(call.expression) &&
    call.expression.text === REFERENCE_FUNCTION &&
    scope.resolveCallee(REFERENCE_FUNCTION) === undefined &&
    scope.resolve(REFERENCE_FUNCTION) === undefined
  );
}

/** What `ref(...)` written anywhere but as the argument of a reference parameter is told: the
 *  argument of a generic function, whose instance is made from argument values (Rule 8.25), or
 *  anywhere else, as a value. */
export function refuseMisplacedReference(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): undefined {
  const written = `ref(${node.arguments[0]?.getText(sourceFile) ?? 'x'})`;
  let at: ts.Node = node;
  while (ts.isParenthesizedExpression(at.parent)) at = at.parent;
  const call = at.parent;
  const generic =
    ts.isCallExpression(call) &&
    call.arguments.includes(at as ts.Expression) &&
    ts.isIdentifier(call.expression) &&
    scope.isGenericFunction(call.expression.text)
      ? call.expression.text
      : undefined;
  diagnostics.push(
    makeDiagnostic(
      sourceFile,
      node,
      generic !== undefined
        ? `"${generic}" is a generic function, which takes its parameters by value: its ` +
            `instance is made from the types of the values it is handed, and ${written} hands a ` +
            `place (Rule 8.25). Declare a function for the one type, with a Ref<T> parameter.`
        : `${written} passes a place to a parameter declared Ref<T>, and is written only as ` +
            `that argument: it is no value to keep, return or compute with (Rule 8.25). Write ` +
            `the value itself here.`,
      TS_CODES.REFERENCE,
    ),
  );
  return undefined;
}

/** The argument a `Ref<T>` parameter takes, lowered as the place it names: `ref(x)`, `ref(o.a)`,
 *  `ref(xs[i])`, `ref(buf[i])` on a `read_write` storage binding, or a reference the caller
 *  holds itself, passed on as it is. Anything else is refused, with the edit, having said why.
 *
 *  `ref(...)` takes what a method that changes its object takes as that object (Rule 8.10): a
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
  const takes = `"${shown}" takes "${param.name}" by reference, Ref<${authorTypeText(param.type)}>`;
  const written = bare(arg);
  if (!isReferenceCall(written, scope) || !ts.isCallExpression(written)) {
    // A reference the caller holds is passed on as the same place (Rule 8.25).
    if (ts.isIdentifier(written)) {
      const held = scope.resolve(written.text);
      if (held?.reference === true) {
        return { op: 'varref', type: held.type, name: held.irName ?? held.name };
      }
    }
    return push(
      arg,
      `${takes}: pass the place with ref(${written.getText(sourceFile)}), which marks at the ` +
        `call that "${shown}" may change it.`,
    );
  }
  if (written.arguments.length !== 1) {
    return push(written, `ref(...) takes one argument, the place to pass: ref(x).`);
  }
  const place = bare(written.arguments[0]!);
  // The root of the chain decides, as it does for a method's object: `ref(o.a)` and `ref(xs[i])`
  // are places when `o` and `xs` are.
  const root = rootIdentifier(place);
  if (root !== undefined) {
    const found = scope.resolve(root.text);
    const b = found === undefined ? undefined : writeRules(found);
    if (b !== undefined && b.reference !== true && b.kind === 'param' && b.space !== 'storage') {
      return push(
        place,
        `${takes}, and "${root.text}" is a parameter that holds a copy of its caller's value, ` +
          `which this function cannot hand on as a place. Declare it "${root.text}: ` +
          `Ref<${authorTypeText(b.type)}>" to pass its caller's place on, or copy it into a let.`,
      );
    }
    // `const v = new V(); f(ref(v))`: a `const` that holds a value nothing else does is written
    // through as TypeScript's is, and becomes a `var` (Rule 6.10).
    if (b !== undefined && !b.mutable && b.toVar !== undefined) b.toVar();
    if (b !== undefined && !b.mutable) {
      const shared = b.kind === 'local' && b.type.kind === 'struct';
      return push(
        place,
        shared
          ? `${takes}, and "${root.text}" is a const whose value may be one something else ` +
              `holds, which a reference would change with it. Declare it with let.`
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
        `place to pass. Keep it in a let and pass ref of that.`,
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
        `vector, or copy the component into a let and pass ref of that.`,
    );
  }
  if (typeKey(lowered.type) !== typeKey(param.type)) {
    return push(
      place,
      `${takes}, and "${place.getText(sourceFile)}" is ${authorTypeText(lowered.type)}. A ` +
        `reference names a place of exactly its type.`,
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
 *  Every argument a callee takes by reference counts: a `Ref<T>` parameter's, the object of a
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
              `distinct variables, or copy one into a let and pass ref of that.`,
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
