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
// A local function reads the variables of the function around it as TypeScript's closure does:
// each is a parameter the emitted function takes and every call passes, by value, or by
// reference once the body writes it (closures.ts, Rule 8.17). A `function` declaration written
// in a body is one too, callable anywhere in its block, as TypeScript hoists it.

import ts from 'typescript';
import type { Expr, FuncDecl } from '../../../core/ir/nodes.js';
import type { ShaderType } from '../../../core/ir/types.js';
import { voidT } from '../../../core/ir/types.js';
import type { TsCompilerDiagnostic } from '../source-file.js';
import type { CollectedStruct } from '../structs.js';
import { TS_CODES } from '../codes.js';
import { makeDiagnostic } from '../diagnostic.js';
import { spanOf } from '../span.js';
import {
  THIS_CAPTURE,
  irNameOf,
  type Binding,
  type CaptureKey,
  type FileFunctions,
  type LoweringScope,
} from '../context.js';
import { parseParams, parseReturnType } from './function.js';
import type { Receiver } from './class-methods.js';
import { closureUse, functionAround, type ClosureUse } from './closures.js';
import { functionTypeOf } from './function-types.js';
import { eachExpr, eachStmtExpr } from '../../../core/ir/visit.js';

/** Whether `decl` declares a function a body calls by name: a local function, or a parameter
 *  of function type, whose name stands for the function a call handed over (Rule 8.18). */
export function declaresFunction(decl: ts.Node): boolean {
  if (ts.isVariableDeclaration(decl) || ts.isFunctionDeclaration(decl)) {
    return localFunctionOf(decl) !== undefined;
  }
  return ts.isParameter(decl) && functionTypeOf(decl.type) !== undefined;
}

/** The spellings of a local function: a function written as a value, and a `function`
 *  declaration inside a body. */
export type LocalFunctionNode = ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration;

/** What declares a local function: the `const` that holds it, or the declaration itself. */
export type LocalFunctionDecl = ts.VariableDeclaration | ts.FunctionDeclaration;

/** One local function, ready to have its body filled like any other. */
export interface LocalFunction {
  readonly node: LocalFunctionNode;
  readonly stub: FuncDecl;
  /** The name the source calls it by, inside the body that declares it. */
  readonly localName: string;
  /** The function whose body declares it, by its emitted name, or '' at the module top level. */
  readonly ownerName: string;
  /** The declaration, to anchor a diagnostic and to know which statement to drop. */
  readonly decl: LocalFunctionDecl;
}

/** The emitted name of a local function: `fs_f` for `f` inside `fs`, and `f` at the top level,
 *  where it is a module function already. */
export const localFnName = (owner: string, local: string): string =>
  owner === '' ? local : `${owner}_${local}`;

/** The function a `const f = ...` declares, or a `function f() {}` is, or undefined when the
 *  declaration holds no function. */
export function localFunctionOf(decl: LocalFunctionDecl): LocalFunctionNode | undefined {
  if (ts.isFunctionDeclaration(decl)) return decl.body !== undefined ? decl : undefined;
  const init = decl.initializer;
  if (!init) return undefined;
  if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) return init;
  return undefined;
}

/** Every local function declared directly in `body`'s statements, with its signature parsed.
 *  Nested ones are found too, since a local function's own body is walked as an owner in turn.
 *
 *  `ownerName` is the emitted name of the body being walked, which is what the local functions
 *  in it are named after. */
export function collectLocalFunctions(
  decls: readonly LocalFunctionDecl[],
  ownerName: string,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  structs: readonly CollectedStruct[],
  /** The file's refused-declaration set (roadmap 0.3 item T10, #92), which each refusal below
   *  adds its emitted name to, so a call to it in the same body says nothing on top of the
   *  reason this function already gave. */
  refused?: Set<string>,
): LocalFunction[] {
  const out: LocalFunction[] = [];
  for (const decl of decls) {
    const node = localFunctionOf(decl);
    if (!node) continue;
    if (decl.name === undefined || !ts.isIdentifier(decl.name)) continue;
    const local = decl.name.text;
    const shown = ownerName === '' ? local : `${local}" in "${ownerName}`;
    const refuse = (): void => {
      refused?.add(localFnName(ownerName, local));
    };
    if (ts.isVariableDeclaration(decl) && !isConst(decl)) {
      push(
        diagnostics,
        sourceFile,
        decl,
        `"${local}" is a function, so it is declared with const; a "let" would let the name ` +
          `point at another one, which no shader value does.`,
        TS_CODES.FUNCTION_SHAPE,
      );
      refuse();
      continue;
    }
    if (ts.isVariableDeclaration(decl) && decl.type) {
      push(
        diagnostics,
        sourceFile,
        decl.type,
        `"${local}" is a function; its types are written on its own parameters and after ` +
          `them, not as a type on the const.`,
        TS_CODES.FUNCTION_SHAPE,
      );
      refuse();
      continue;
    }
    if (ts.isArrowFunction(node) && !ts.isBlock(node.body) && !node.type) {
      push(
        diagnostics,
        sourceFile,
        node,
        `"${local}" returns a value straight away, so it needs a return type: write ` +
          `"(x: f32): f32 => ...".`,
        TS_CODES.FUNCTION_SHAPE,
      );
      refuse();
      continue;
    }
    if (node.asteriskToken || node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) {
      push(
        diagnostics,
        sourceFile,
        node,
        `"${local}" is a plain function or nothing: no async, no generator.`,
        TS_CODES.FUNCTION_SHAPE,
      );
      refuse();
      continue;
    }
    const name = localFnName(ownerName, local);
    const params = parseParams(node.parameters, sourceFile, diagnostics, structs, undefined, {
      owner: shown,
    });
    if (!params) {
      refuse();
      continue;
    }
    const ret = parseReturnType(
      node.type,
      shown,
      node,
      sourceFile,
      diagnostics,
      structs,
      undefined,
    );
    if (!ret) {
      refuse();
      continue;
    }
    const stub: FuncDecl = { name, params, ret, body: [] };
    (stub as { span?: unknown }).span = spanOf(sourceFile, node);
    (stub as { nameSpan?: unknown }).nameSpan = spanOf(sourceFile, decl.name);
    out.push({ node, stub, localName: local, ownerName, decl });
  }
  return out;
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
  );
}

/** Every variable declaration and `function` declaration written directly in `body`, without
 *  descending into anything that owns its own body: those belong to it, as its own owner. */
export function declarationsIn(body: ts.Node): LocalFunctionDecl[] {
  const out: LocalFunctionDecl[] = [];
  const walk = (n: ts.Node): void => {
    if (ts.isFunctionDeclaration(n)) {
      out.push(n);
      return;
    }
    if (ownsItsBody(n)) return;
    if (ts.isVariableDeclaration(n)) out.push(n);
    ts.forEachChild(n, walk);
  };
  ts.forEachChild(body, walk);
  return out;
}

function isConst(decl: ts.VariableDeclaration): boolean {
  const list = decl.parent;
  return ts.isVariableDeclarationList(list) && (list.flags & ts.NodeFlags.Const) !== 0;
}

function push(
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
  node: ts.Node,
  message: string,
  code: (typeof TS_CODES)[keyof typeof TS_CODES],
): void {
  diagnostics.push(makeDiagnostic(sourceFile, node, message, code));
}

/** A local function, with where it stands: the function whose body declares it and each one
 *  around that, by node, to the stub each is emitted as, and whose `this` it sees. */
export interface Lifted {
  readonly fn: LocalFunction;
  readonly around: ReadonlyMap<ts.Node, FuncDecl>;
  readonly self: LiftedThis | undefined;
  /** Where its body's diagnostics go when not to the file's list: those of a body a class
   *  inherits, which the class that declared it has said once already (Rule 12.4). */
  readonly said?: TsCompilerDiagnostic[];
}

/** What `this` is in a local function inside a class's function. */
export interface LiftedThis {
  /** The object of the method around it. */
  readonly receiver?: {
    readonly type: ShaderType;
    readonly mode: 'param' | 'inout';
    readonly superMethods?: ReadonlyMap<string, string>;
  };
  /** The class a static member around it runs for (Rule 8.13). */
  readonly staticOwner?: string;
  readonly staticSuper?: ReadonlyMap<string, string>;
  /** Whether `this` in its own body is that one: an arrow function, out to the method. */
  readonly bindsThis: boolean;
  /** How messages name the class's function around it. */
  readonly shown: string;
}

/** One parameter a local function takes for what it captures, as its body binds it. */
export interface CaptureBinding {
  readonly key: CaptureKey;
  readonly binding: Binding;
  /** Whether the body reads it under the variable's own name, which it does unless one of the
   *  function's own parameters takes that name first. */
  readonly byName: boolean;
}

/** The name a captured declaration is read under. */
export function capturedName(key: ts.Node): string {
  const n = (key as { name?: ts.Node }).name;
  return n !== undefined && ts.isIdentifier(n) ? n.text : '?';
}

/** The variables each local function captures, found for all of them at once (closures.ts),
 *  and the parameters it takes for them, ahead of its own: `self_` for the method's object,
 *  then each variable under its own name. A local function that calls another passes the
 *  callee's captures on, so it captures them too, to a fixed point. A parameter's type is the
 *  variable's, known once the body that declares the variable is lowered; until then it is
 *  `void`, which no variable has (Rule 8.17). */
export function liftCaptures(
  lifted: readonly Lifted[],
  callees: ReadonlyMap<string, FuncDecl>,
  file: FileFunctions,
  /** In an instance of a function that takes a function (Rule 8.18), the function each such
   *  parameter was handed, by the parameter's declaration: a local function that calls it
   *  passes what it captures, so captures that too. */
  handed: ReadonlyMap<ts.Node, FuncDecl> = new Map(),
): void {
  const isLocalFunction = declaresFunction;
  // Each local function by its declaration, under the function whose body declares it: a body
  // a class inherits is lowered once per class, and so is every local function in it.
  const at = new Map<FuncDecl, Map<ts.Node, Lifted>>();
  for (const l of lifted) {
    const owner = callees.get(l.fn.ownerName);
    if (owner === undefined) continue;
    let mine = at.get(owner);
    if (mine === undefined) at.set(owner, (mine = new Map()));
    mine.set(l.fn.decl, l);
  }
  const keys = new Map<Lifted, CaptureKey[]>();
  const uses = new Map<Lifted, ClosureUse>();
  for (const l of lifted) {
    const use = closureUse(l.fn.node, isLocalFunction);
    uses.set(l, use);
    const mine: CaptureKey[] = use.captures.map((c) => c.decl);
    if (use.usesThis && l.self?.bindsThis === true && l.self.receiver !== undefined) {
      mine.unshift(THIS_CAPTURE);
    }
    keys.set(l, mine);
  }
  for (let grew = true; grew;) {
    grew = false;
    for (const l of lifted) {
      const mine = keys.get(l)!;
      for (const g of uses.get(l)!.calls) {
        const target = handed.get(g);
        let theirs: readonly CaptureKey[] | undefined;
        if (target !== undefined) {
          theirs = file.captures.get(target.name) ?? [];
        } else {
          const around = functionAround(g);
          const owner = around === undefined ? undefined : l.around.get(around);
          const callee = owner === undefined ? undefined : at.get(owner)?.get(g);
          if (callee === undefined) continue;
          theirs = keys.get(callee)!;
        }
        for (const k of theirs) {
          if (mine.includes(k)) continue;
          if (k === THIS_CAPTURE) {
            // A method's object handed on: through the method's own, or through what the
            // instance around it was handed (Rule 8.18).
            if (l.self?.receiver === undefined && handed.size === 0) continue;
            mine.unshift(k);
          } else {
            mine.push(k);
          }
          grew = true;
        }
      }
    }
  }
  for (const l of lifted) {
    const mine = keys.get(l)!;
    if (mine.length === 0) continue;
    const stub = l.fn.stub;
    const taken = new Set(stub.params.map((p) => p.name));
    taken.add('self_');
    const hidden: FuncDecl['params'][number][] = mine.map((k) => {
      if (k === THIS_CAPTURE) {
        // Typed from the method around it, or, inside an instance that was handed a function
        // that captures one, when the body declaring it is lowered (`captureBindings`).
        const r = l.self?.receiver;
        if (r === undefined) return { name: 'self_', type: voidT };
        return {
          name: 'self_',
          type: r.type,
          ...(r.mode === 'inout' ? { mode: 'inout' as const } : {}),
        };
      }
      const base = capturedName(k);
      let name = base;
      for (let n = 1; taken.has(name); n++) name = `${base}_${n}`;
      taken.add(name);
      return { name, type: voidT };
    });
    (stub as { params: FuncDecl['params'] }).params = [...hidden, ...stub.params];
    file.captures.set(stub.name, mine);
  }
}

/** How the body of `l` binds what it captures: a parameter for each variable, judged on a write
 *  by the variable's own binding and made a reference by the first write through it
 *  (`Binding.capture`), and the method's object, `this` in an arrow function and a value to
 *  hand on in any other. Undefined when the body that declares a variable did not lower it,
 *  which has said why. */
export function captureBindings(
  l: Lifted,
  file: FileFunctions,
): { captures: CaptureBinding[]; receiver: Receiver | undefined } | undefined {
  const keys = file.captures.get(l.fn.stub.name) ?? [];
  const captures: CaptureBinding[] = [];
  let receiver: Receiver | undefined;
  for (const [i, k] of keys.entries()) {
    const param = l.fn.stub.params[i]!;
    if (k === THIS_CAPTURE && l.self?.receiver === undefined) {
      // Inside an instance of a function that takes a function (Rule 8.18): the object the
      // function it was handed captures, which the instance holds and this one hands on.
      const around = functionAround(l.fn.node);
      const owner = around === undefined ? undefined : l.around.get(around);
      const of = owner === undefined ? undefined : file.declared.get(owner)?.get(k);
      if (of === undefined) return undefined;
      (param as { type: ShaderType }).type = of.type;
      captures.push({
        key: k,
        byName: false,
        binding: { kind: 'param', name: 'self_', type: of.type, mutable: true },
      });
      continue;
    }
    if (k === THIS_CAPTURE) {
      const self = l.self!;
      const r = self.receiver!;
      if (self.bindsThis) {
        receiver = {
          type: r.type,
          mode: r.mode,
          fieldInits: [],
          shown: self.shown,
          ...(r.superMethods !== undefined ? { superMethods: r.superMethods } : {}),
        };
      } else {
        captures.push({
          key: k,
          byName: false,
          binding: { kind: 'param', name: 'self_', type: r.type, mutable: r.mode === 'inout' },
        });
      }
      continue;
    }
    const around = functionAround(k);
    const declaring = around === undefined ? undefined : l.around.get(around);
    if (declaring === undefined) {
      // Not a variable of a function around this one: one a function handed to the instance
      // around it captures (Rule 8.18), which that instance holds and this one only hands on,
      // since no name in its body can reach it.
      const here = functionAround(l.fn.node);
      const owner = here === undefined ? undefined : l.around.get(here);
      const held = owner === undefined ? undefined : file.declared.get(owner)?.get(k);
      if (held === undefined) return undefined;
      (param as { type: ShaderType }).type = held.type;
      captures.push({
        key: k,
        byName: false,
        binding: { kind: 'param', name: param.name, type: held.type, mutable: true },
      });
      continue;
    }
    const of = file.declared.get(declaring)?.get(k);
    if (of === undefined) return undefined;
    (param as { type: ShaderType }).type = of.type;
    const writable = param as { mode?: 'inout' };
    captures.push({
      key: k,
      byName: true,
      // The variable's own mutability and constant, so a `const` read in a loop bound still
      // counts the loop (Rule 7.5); a write is judged by `of` (`writeRules`).
      binding: {
        kind: 'param',
        name: capturedName(k),
        type: of.type,
        mutable: of.mutable,
        ...(of.constValue !== undefined ? { constValue: of.constValue } : {}),
        irName: param.name,
        capture: {
          of,
          byRef: () => {
            writable.mode = 'inout';
          },
        },
      },
    });
  }
  return { captures, receiver };
}

/** What a call of the local function `callee`, written `written`, passes ahead of its written
 *  arguments: each variable it captures, as the calling body holds it (Rule 8.17), the type of
 *  the parameter taking it settled if nothing had yet. Undefined, having said why, when one is
 *  not declared yet where the call stands, where TypeScript throws; undefined and silent when
 *  its declaration stands before the call and did not lower, which said why there. */
export function captureArguments(
  callee: FuncDecl,
  written: string,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr[] | undefined {
  const out: Expr[] = [];
  for (const [i, k] of scope.capturesOf(callee.name).entries()) {
    const b =
      scope.bindingOfDeclaration(k) ?? (k === THIS_CAPTURE ? scope.resolve('this') : undefined);
    if (b === undefined) {
      if (k !== THIS_CAPTURE && k.getSourceFile() === sourceFile && k.end <= node.pos) {
        return undefined;
      }
      const name = k === THIS_CAPTURE ? 'this' : capturedName(k);
      push(
        diagnostics,
        sourceFile,
        node,
        `"${written}" reads "${name}", which is not declared yet where "${written}" is called: ` +
          `a let or a const is not there before its declaration, and TypeScript throws. Call ` +
          `"${written}" after "${name}" is declared.`,
        TS_CODES.UNKNOWN_NAME,
      );
      return undefined;
    }
    const param = callee.params[i]!;
    if (param.type.kind === 'void') (param as { type: ShaderType }).type = b.type;
    out.push({ op: b.kind === 'param' ? 'param' : 'varref', type: b.type, name: irNameOf(b) });
  }
  return out;
}

/** Make each parameter a local function takes for a capture a reference when a call it makes
 *  hands that parameter to one a callee writes through: the variable is the caller's to write
 *  back, so the caller must hold it by reference too. To a fixed point, since the chain of
 *  calls may be any length (Rule 8.17). */
export function propagateCaptureRefs(
  stubs: readonly FuncDecl[],
  callees: ReadonlyMap<string, FuncDecl>,
  file: FileFunctions,
): void {
  for (let grew = true; grew;) {
    grew = false;
    for (const stub of stubs) {
      const count = file.captures.get(stub.name)?.length ?? 0;
      if (count === 0) continue;
      const hidden = new Map(stub.params.slice(0, count).map((p) => [p.name, p]));
      const visit = (e: Expr): void => {
        if (e.op !== 'call') return;
        const callee = callees.get(e.fn);
        if (callee === undefined || !file.captures.has(e.fn)) return;
        callee.params.forEach((p, i) => {
          if (p.mode !== 'inout') return;
          const a = e.args[i];
          if (a === undefined || (a.op !== 'param' && a.op !== 'varref')) return;
          const mine = hidden.get(a.name) as { mode?: 'inout' } | undefined;
          if (mine === undefined || mine.mode === 'inout') return;
          mine.mode = 'inout';
          grew = true;
        });
      };
      for (const st of stub.body) eachStmtExpr(st, (e) => eachExpr(e, visit));
    }
  }
}
