import { hasNoWrittenResult } from '../abstract-const.js';
import ts from 'typescript';
import type { Expr, FuncDecl } from '../../../core/ir/nodes.js';
import type { ShaderType } from '../../../core/ir/types.js';
import { voidT } from '../../../core/ir/types.js';
import type { TsCompilerDiagnostic } from '../source-file.js';
import type { CollectedStruct } from '../structs.js';
import { TS_CODES } from '../codes.js';
import { makeDiagnostic } from '../diagnostic.js';
import { spanOf } from '../span.js';
import { isAsyncOrGenerator } from '../semantic.js';
import {
  THIS_CAPTURE,
  irNameOf,
  type Binding,
  type CaptureKey,
  type FileFunctions,
  type LoweringScope,
} from '../context.js';
import { recordLocalFunction, recordNamespaceFunction } from '../namespaces.js';
import { parseParams, parseReturnType } from './function-signature.js';
import type { Receiver } from './class-methods.js';
import { closureUse, declarationOf, functionAround, type ClosureUse } from './closures.js';
import { functionParams, functionTypeOf } from './function-types.js';
import { recordParamDefaults } from './param-defaults.js';
import { eachExpr, eachStmtExpr } from '../../../core/ir/visit.js';

export function declaresFunction(decl: ts.Node): boolean {
  if (ts.isVariableDeclaration(decl) || ts.isFunctionDeclaration(decl)) {
    return localFunctionOf(decl) !== undefined;
  }
  return ts.isParameter(decl) && functionTypeOf(decl.type) !== undefined;
}

export function namesLocalFunction(id: ts.Identifier): boolean {
  const declared = declarationOf(id);
  return (
    declared !== undefined && functionAround(declared) !== undefined && declaresFunction(declared)
  );
}

export type LocalFunctionNode = ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration;

export type LocalFunctionDecl = ts.VariableDeclaration | ts.FunctionDeclaration;

export interface LocalFunction {
  readonly node: LocalFunctionNode;
  readonly stub: FuncDecl;
  readonly localName: string;
  readonly ownerName: string;
  readonly decl: LocalFunctionDecl;
  readonly infers: boolean;
  readonly takesFunctions?: ReadonlySet<number>;
}

export const localFnName = (owner: string, local: string): string =>
  owner === '' ? local : `${owner}_${local}`;

export function declaredInFunction(decl: ts.Node): boolean {
  for (let at: ts.Node | undefined = decl.parent; at !== undefined; at = at.parent) {
    if (ts.isModuleDeclaration(at) || ts.isSourceFile(at)) return false;
    if (ts.isFunctionLike(at)) return true;
  }
  return false;
}

export function localFunctionOf(decl: LocalFunctionDecl): LocalFunctionNode | undefined {
  if (ts.isFunctionDeclaration(decl)) return decl.body !== undefined ? decl : undefined;
  const init = decl.initializer;
  if (!init) return undefined;
  if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) return init;
  return undefined;
}

export function collectLocalFunctions(
  decls: readonly LocalFunctionDecl[],
  ownerName: string,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  structs: readonly CollectedStruct[],
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
    if (ts.isVariableDeclaration(decl) && isVar(decl)) {
      refuse();
      continue;
    }
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
    if (isAsyncOrGenerator(node)) {
      refuse();
      continue;
    }
    const name = localFnName(ownerName, local);
    const fnAt = functionParams(node);
    const params = parseParams(
      node.parameters.filter((_, i) => !fnAt.has(i)),
      sourceFile,
      diagnostics,
      structs,
      undefined,
      { owner: shown },
    );
    if (!params) {
      refuse();
      continue;
    }
    const infers = hasNoWrittenResult(node, sourceFile);
    const ret = parseReturnType(
      infers ? undefined : node.type,
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
    if (declaredInFunction(decl)) recordLocalFunction(stub, local);
    else recordNamespaceFunction(stub, decl);
    if (fnAt.size === 0) recordParamDefaults(stub, node.parameters, 0, true);
    out.push({
      node,
      stub,
      localName: local,
      ownerName,
      decl,
      infers,
      ...(fnAt.size > 0 ? { takesFunctions: fnAt } : {}),
    });
  }
  return out;
}

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

function isVar(decl: ts.VariableDeclaration): boolean {
  const list = decl.parent;
  return (
    ts.isVariableDeclarationList(list) &&
    (list.flags & (ts.NodeFlags.Const | ts.NodeFlags.Let)) === 0
  );
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

export interface Lifted {
  readonly fn: LocalFunction;
  readonly around: ReadonlyMap<ts.Node, FuncDecl>;
  readonly self: LiftedThis | undefined;
  readonly said?: TsCompilerDiagnostic[];
}

export interface LiftedThis {
  readonly receiver?: {
    readonly type: ShaderType;
    readonly mode: 'param' | 'inout';
    readonly superMethods?: ReadonlyMap<string, string>;
  };
  readonly staticOwner?: string;
  readonly staticSuper?: ReadonlyMap<string, string>;
  readonly bindsThis: boolean;
  readonly shown: string;
}

export interface CaptureBinding {
  readonly key: CaptureKey;
  readonly binding: Binding;
  readonly byName: boolean;
}

export function capturedName(key: ts.Node): string {
  const n = (key as { name?: ts.Node }).name;
  return n !== undefined && ts.isIdentifier(n) ? n.text : '?';
}

export function liftCaptures(
  lifted: readonly Lifted[],
  callees: ReadonlyMap<string, FuncDecl>,
  file: FileFunctions,
  handed: ReadonlyMap<ts.Node, FuncDecl> = new Map(),
): void {
  const isLocalFunction = declaresFunction;
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
      const here = functionAround(l.fn.node);
      const owner = here === undefined ? undefined : l.around.get(here);
      const held = owner === undefined ? undefined : file.declared.get(owner)?.get(k);
      if (held === undefined) return undefined;
      (param as { type: ShaderType }).type = held.type;
      captures.push({
        key: k,
        byName: false,
        binding: {
          kind: 'param',
          name: param.name,
          type: held.type,
          mutable: true,
          ...(held.carries !== undefined ? { carries: held.carries } : {}),
        },
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
      binding: {
        kind: 'param',
        name: capturedName(k),
        type: of.type,
        mutable: of.mutable,
        ...(of.constValue !== undefined ? { constValue: of.constValue } : {}),
        ...(of.abstract !== undefined ? { abstract: of.abstract } : {}),
        ...(of.inferred !== undefined ? { inferred: of.inferred } : {}),
        ...(of.carries !== undefined ? { carries: of.carries } : {}),
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
