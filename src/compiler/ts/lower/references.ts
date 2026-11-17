// Rule 7.10, Rule 8.25 (docs/language-design.md; the keyword that reqs/ reads in this file).

import { logicalTypeKey as typeKey } from '../optional.js';
import ts from 'typescript';
import { isNewObject } from '../new-object.js';
import type {
  BindingDecl,
  Expr,
  FuncDecl,
  ModuleDecl,
  ModuleVarDecl,
  Stmt,
} from '../../../core/ir/nodes.js';
import { type ShaderType } from '../../../core/ir/types.js';
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
import { lowerExpression } from './expression.js';
import { lowerLValue } from './statement.js';
import { checkPlaceWritable } from './statement/writable.js';
import { isWrittenObjectParameter } from '../object-reference/written.js';

export function referenceOf(
  p: ts.ParameterDeclaration,
  sourceFile: ts.SourceFile = p.getSourceFile(),
): 'inout' | undefined {
  return isWrittenObjectParameter(p, sourceFile) ? 'inout' : undefined;
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

export function writesThroughArgument(
  call: ts.CallExpression,
  index: number,
  sourceFile: ts.SourceFile,
): boolean {
  const p = fileFunctionCalled(call, sourceFile)?.parameters[index];
  return p !== undefined && referenceOf(p, sourceFile) !== undefined;
}

/** `e` without the parentheses around it. */
function bare(e: ts.Expression): ts.Expression {
  let x = e;
  while (ts.isParenthesizedExpression(x)) x = x.expression;
  return x;
}

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
  const takes =
    `"${shown}" writes its parameter "${param.name}", the caller's object ` +
    `(${param.name}: ${authorTypeText(param.type)})`;
  const place = bare(arg);
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
  const alias = root === undefined ? undefined : scope.chainAlias(root);
  if (alias !== undefined && !checkPlaceWritable(alias(), place, sourceFile, scope, diagnostics))
    return undefined;
  if (root !== undefined && alias === undefined) {
    const found = scope.resolve(root.text);
    const b = found === undefined ? undefined : writeRules(found);
    if (b !== undefined && b.reference !== true && b.kind === 'param' && b.space !== 'storage') {
      return push(
        place,
        `${takes}, and "${root.text}" is a parameter that holds a copy of its caller's value, ` +
          `which this function cannot hand on as a place. Copy it into a let.`,
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
    const object = param.type.kind === 'struct' || param.type.kind === 'array';
    if (object && !isNewObject(place, sourceFile)) {
      return push(
        place,
        `"${shown}" writes its parameter "${param.name}", and "${place.getText(sourceFile)}" ` +
          `may be an object that already has a name. Passing it on from an expression is not ` +
          `supported yet (change 0142, stage 2): name it first, const r = ` +
          `${place.getText(sourceFile)}, and pass r.`,
      );
    }
    if (object && scope.canHoist()) {
      const value = lowerExpression(place, sourceFile, scope, diagnostics, param.type);
      if (value === undefined) return undefined;
      if (typeKey(value.type) === typeKey(param.type)) return scope.hoistVar('_arg', value);
    }
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

function stepsOfPlace(e: Expr): (string | number | undefined)[] {
  const steps: (string | number | undefined)[] = [];
  for (let at = e; at.op === 'member' || at.op === 'index'; at = at.base) {
    if (at.op === 'member') steps.unshift(at.field);
    else
      steps.unshift(
        at.idx.op === 'lit' && typeof at.idx.value === 'number' ? at.idx.value : undefined,
      );
  }
  return steps;
}

function partAtOnce(a: Expr, b: Expr): boolean {
  const x = stepsOfPlace(a);
  const y = stepsOfPlace(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const p = x[i];
    const q = y[i];
    if (typeof p === 'string' || typeof q === 'string') {
      if (p !== q) return true;
    } else if (p !== undefined && q !== undefined && p !== q) return true;
  }
  return false;
}

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
      const refs: { root: string; writes: boolean; place: Expr; taken: boolean }[] = [];
      callee.params.forEach((p, i) => {
        const object = p.type.kind === 'struct' || p.type.kind === 'array';
        if (p.mode !== 'inout' && !object) return;
        const root = x.args[i] === undefined ? undefined : rootOf(x.args[i]!);
        if (root !== undefined)
          refs.push({
            root,
            writes: p.mode === 'inout' && written.has(p.name),
            place: x.args[i]!,
            taken: p.mode === 'inout',
          });
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
          if (!(refs[i]!.taken && refs[j]!.taken) && partAtOnce(refs[i]!.place, refs[j]!.place))
            continue;
          report(
            `This call hands "${refs[i]!.root}" to "${shown}" twice, and "${shown}" writes one ` +
              `of the two: one object under two names inside "${shown}", which is not ` +
              `supported yet (change 0142, stage 2). Pass two variables, or give "${shown}" one ` +
              `parameter for it.`,
          );
        }
      }
      for (const r of refs) {
        if (!moduleNames.has(r.root) || !touched.has(r.root)) continue;
        if (!r.writes && !written.has(r.root)) continue;
        report(
          `This call hands "${r.root}" to "${shown}", which writes its parameter, and ` +
            `"${shown}" also reads or writes "${r.root}" by its name: one object under two ` +
            `names inside "${shown}", which is not supported yet (change 0142, stage 2). Use ` +
            `the parameter alone inside "${shown}", or the name alone.`,
        );
      }
    };
    for (const s of f.body as readonly Stmt[]) eachStmtExpr(s, (e) => eachExpr(e, visit));
  }
}
