// Implements: Rule 5.1 (docs/language-design.md; traced in reqs/).

import ts from 'typescript';
import type { Expr, FuncDecl } from '../../core/ir/nodes.js';
import type { ShaderType } from '../../core/ir/types.js';
import { f32T, f64T, i32T, u32T } from '../../core/ir/types.js';
import { logicalTypeKey as typeKey } from './optional.js';
import { resetResultCopies } from './symbols.js';
import { abstractLiteralOf } from './abstract-const.js';

export type Demand = 'i32' | 'u32' | 'f32' | 'f64' | 'int';

export interface InferredValue {
  readonly decl: ts.Node;
  readonly key?: object;
  readonly perUse?: true;
  readonly function?: ts.Node;
  readonly integerResult?: ShaderType;
  readonly callee?: object;
  readonly open?: true;
  readonly name: string;
  readonly written?: string;
  readonly type?: ShaderType;
  readonly list?: number;
}

interface State {
  readonly decided: Map<object, ShaderType>;
  readonly conflicts: Map<object, string>;
  readonly openCounters: Set<ts.Node>;
  newOpenCounter: boolean;
  demands: Map<
    object,
    { readonly name: string; readonly asked: Set<Demand>; perUse: boolean; callee?: object }
  >;
  readonly callerDecided: Set<ts.Node>;
  newCallerDecided: boolean;
  askedBefore: Map<object, Map<string, ShaderType>>;
  askedNow: Map<object, Map<string, ShaderType>>;
  readonly results: Map<object, ShaderType>;
  callersOff: boolean;
  readonly off: Set<ts.Node>;
  readonly offCalls: Map<ts.Node, string>;
}

const states = new WeakMap<ts.SourceFile, State>();
const readByExpr = new WeakMap<Expr, InferredValue>();
const readByNode = new WeakMap<ts.Node, InferredValue>();
let current: State | undefined;

export function beginUseInference(sourceFile: ts.SourceFile): void {
  states.set(sourceFile, {
    decided: new Map(),
    conflicts: new Map(),
    openCounters: new Set(),
    newOpenCounter: false,
    demands: new Map(),
    callerDecided: new Set(),
    newCallerDecided: false,
    askedBefore: new Map(),
    askedNow: new Map(),
    callersOff: false,
    results: new Map(),
    off: new Set(),
    offCalls: new Map(),
  });
}

export function beginUseInferencePass(sourceFile: ts.SourceFile): State | undefined {
  const outer = current;
  const state = states.get(sourceFile);
  if (state !== undefined) {
    state.demands = new Map();
    state.askedBefore = state.askedNow;
    state.askedNow = new Map();
  }
  resetResultCopies(sourceFile);
  current = state;
  return outer;
}

export function endUseInferencePass(outer: State | undefined): void {
  current = outer;
}

const CONCRETE: readonly Demand[] = ['i32', 'u32', 'f32', 'f64'];
const TYPE_OF: Readonly<Record<'i32' | 'u32' | 'f64', ShaderType>> = {
  i32: i32T,
  u32: u32T,
  f64: f64T,
};

export function settleUseInference(sourceFile: ts.SourceFile): boolean {
  const state = states.get(sourceFile);
  if (state === undefined) return false;
  if (state.newOpenCounter) {
    state.newOpenCounter = false;
    state.newCallerDecided = false;
    return true;
  }
  let changed = state.newCallerDecided;
  state.newCallerDecided = false;
  const decide = (decl: object, type: ShaderType, callee: object | undefined): void => {
    state.decided.set(decl, type);
    if (callee === undefined) return;
    let types = state.askedNow.get(callee);
    if (types === undefined) state.askedNow.set(callee, (types = new Map()));
    types.set(typeKey(type), type);
  };
  for (const [decl, { name, asked, perUse, callee }] of state.demands) {
    if (state.decided.has(decl) || state.conflicts.has(decl)) continue;
    const concrete = CONCRETE.filter((d) => asked.has(d));
    const wantsInteger = asked.has('int');
    const clash =
      concrete.length > 1
        ? concrete
        : wantsInteger && concrete.some((d) => d === 'f32' || d === 'f64')
          ? (['an integer', ...concrete] as string[])
          : undefined;
    if (clash !== undefined) {
      state.conflicts.set(
        decl,
        `Cannot infer "${name}": its uses require ${clash.slice(0, -1).join(', ')} and ` +
          `${clash[clash.length - 1]!}. Write an explicit type annotation on "${name}" and cast ` +
          `the uses that need another type.`,
      );
      changed = true;
      continue;
    }
    const one = concrete[0] ?? (wantsInteger ? 'i32' : undefined);
    if (one === undefined || one === 'int') continue;
    if (one === 'f32') {
      if (perUse) {
        decide(decl, f32T, callee);
        const had = callee === undefined ? undefined : state.results.get(callee);
        if (had !== undefined && typeKey(had) !== 'f32') changed = true;
      }
      continue;
    }
    decide(decl, TYPE_OF[one], callee);
    changed = true;
  }
  return changed || !sameAsked(state.askedBefore, state.askedNow);
}

function askedTypes(
  map: ReadonlyMap<object, ReadonlyMap<string, ShaderType>>,
  key: object,
): ReadonlySet<string> {
  const types = map.get(key);
  if (types === undefined || (types.size === 1 && types.has('f32'))) return new Set();
  return new Set(types.keys());
}

function sameAsked(
  a: ReadonlyMap<object, ReadonlyMap<string, ShaderType>>,
  b: ReadonlyMap<object, ReadonlyMap<string, ShaderType>>,
): boolean {
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const x = askedTypes(a, key);
    const y = askedTypes(b, key);
    if (x.size !== y.size || [...x].some((k) => !y.has(k))) return false;
  }
  return true;
}

export function noteOpenCounter(sourceFile: ts.SourceFile, decl: ts.Node): void {
  const state = states.get(sourceFile);
  if (state === undefined || state.openCounters.has(decl)) return;
  state.openCounters.add(decl);
  state.newOpenCounter = true;
}

export function isOpenCounter(sourceFile: ts.SourceFile, decl: ts.Node): boolean {
  return states.get(sourceFile)?.openCounters.has(decl) === true;
}

export function decidedType(sourceFile: ts.SourceFile, decl: ts.Node): ShaderType | undefined {
  return states.get(sourceFile)?.decided.get(keyOf(decl));
}

export function inferenceConflict(sourceFile: ts.SourceFile, decl: ts.Node): string | undefined {
  return states.get(sourceFile)?.conflicts.get(keyOf(decl));
}

let copyTag: string | undefined;
const copyKeys = new WeakMap<ts.Node, Map<string, object>>();

export function keyOf(decl: ts.Node): object {
  if (copyTag === undefined) return decl;
  let byTag = copyKeys.get(decl);
  if (byTag === undefined) copyKeys.set(decl, (byTag = new Map()));
  let key = byTag.get(copyTag);
  if (key === undefined) byTag.set(copyTag, (key = { decl, copy: copyTag }));
  return key;
}

export function inCopy<T>(tag: string | undefined, run: () => T): T {
  const outer = copyTag;
  copyTag = tag;
  try {
    return run();
  } finally {
    copyTag = outer;
  }
}

const homeTags = new WeakMap<FuncDecl, string>();

export function setHomeTag(stub: FuncDecl, tag: string): void {
  homeTags.set(stub, tag);
}

export function homeTagOf(stub: FuncDecl): string | undefined {
  return homeTags.get(stub);
}

export function currentCopy(): string | undefined {
  return copyTag;
}

export function noteCallerDecided(sourceFile: ts.SourceFile, decl: ts.Node): void {
  const state = states.get(sourceFile);
  if (state === undefined || state.callerDecided.has(decl)) return;
  state.callerDecided.add(decl);
  state.newCallerDecided = true;
}

export function isCallerDecided(sourceFile: ts.SourceFile, decl: ts.Node): boolean {
  const state = states.get(sourceFile);
  return state !== undefined && !state.off.has(decl) && state.callerDecided.has(decl);
}

export function switchCallersOff(sourceFile: ts.SourceFile): void {
  const state = states.get(sourceFile);
  if (state === undefined) return;
  state.callersOff = true;
  const decided = new Set<ts.Node>();
  for (const [key, types] of state.askedNow) {
    if (types.size > 0) decided.add((key as { node: ts.Node }).node);
  }
  for (const node of state.callerDecided) if (!decided.has(node)) state.off.add(node);
}

export function switchedOffCalls(sourceFile: ts.SourceFile): ReadonlyMap<ts.Node, string> {
  return states.get(sourceFile)?.offCalls ?? new Map();
}

export function callersSwitchedOff(sourceFile: ts.SourceFile): boolean {
  return states.get(sourceFile)?.callersOff === true;
}

const calleeKeys = new WeakMap<ts.Node, Map<string, object>>();

export function calleeKeyOf(node: ts.Node, instance = ''): object {
  let byInstance = calleeKeys.get(node);
  if (byInstance === undefined) calleeKeys.set(node, (byInstance = new Map()));
  let key = byInstance.get(instance);
  if (key === undefined) byInstance.set(instance, (key = { node, instance }));
  return key;
}

export function askedOf(sourceFile: ts.SourceFile, key: object): ReadonlyMap<string, ShaderType> {
  return states.get(sourceFile)?.askedBefore.get(key) ?? new Map();
}

interface CallerDecidedInfo {
  readonly name: string;
  readonly node: ts.Node;
  readonly decl: ts.Node;
  readonly key: object;
  readonly copyFor: (type: ShaderType) => FuncDecl | undefined;
}
const callerDecidedStubs = new WeakMap<FuncDecl, CallerDecidedInfo>();

export function registerCallerDecided(stub: FuncDecl, info: CallerDecidedInfo): void {
  callerDecidedStubs.set(stub, info);
}

export function callerDecidedCall(
  decl: FuncDecl,
  call: ts.Node,
  sourceFile: ts.SourceFile,
): { readonly target: FuncDecl; readonly value: InferredValue } | undefined {
  const info = callerDecidedStubs.get(decl);
  const state = states.get(sourceFile);
  if (info === undefined || state === undefined) return undefined;
  if (state.off.has(info.decl)) {
    state.offCalls.set(call, info.name);
    return undefined;
  }
  if (!state.callerDecided.has(info.decl)) return undefined;
  const key = keyOf(call);
  const asked = state.decided.get(key);
  state.results.set(info.key, decl.ret);
  if (asked !== undefined) {
    let types = state.askedNow.get(info.key);
    if (types === undefined) state.askedNow.set(info.key, (types = new Map()));
    types.set(typeKey(asked), asked);
  }
  const before = state.askedBefore.get(info.key);
  const target =
    asked === undefined || typeKey(asked) === typeKey(decl.ret)
      ? decl
      : (info.copyFor(asked) ?? decl);
  const type = asked !== undefined || (before?.size ?? 0) > 0 ? target.ret : undefined;
  const integer = [...(before?.values() ?? []), ...(asked !== undefined ? [asked] : [])].find(
    (t) => typeKey(t) === 'i32' || typeKey(t) === 'u32',
  );
  return {
    target,
    value: {
      decl: call,
      key,
      name: info.name,
      perUse: true,
      function: info.node,
      callee: info.key,
      written: `${info.name}()`,
      ...(type !== undefined ? { type } : {}),
      ...(type !== undefined && asked === undefined ? { open: true as const } : {}),
      ...(integer !== undefined ? { integerResult: integer } : {}),
    },
  };
}

export function useInferenceActive(sourceFile: ts.SourceFile): boolean {
  return states.has(sourceFile);
}

export function markInferredRead<E extends Expr>(
  expr: E,
  node: ts.Node,
  value: InferredValue | undefined,
): E {
  if (value !== undefined) {
    readByExpr.set(expr, value);
    if (value.list === undefined || expr.type.kind !== 'array') readByNode.set(node, value);
  }
  return expr;
}

function stripParens(node: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(node) ? stripParens(node.expression) : node;
}

export function inferredReadAt(node: ts.Expression): InferredValue | undefined {
  return readByNode.get(stripParens(node));
}

export function isUndecidedRead(node: ts.Expression): boolean {
  const read = inferredReadAt(node);
  return read !== undefined && read.type === undefined;
}

function undecidedIn(expr: Expr): InferredValue[] {
  const out: InferredValue[] = [];
  const walk = (e: Expr): boolean => {
    const read = readByExpr.get(e);
    if (read !== undefined) {
      const open = read.type === undefined || read.open === true;
      if (open) out.push(read);
      return open;
    }
    if (e.op === 'lit') return typeof e.value === 'number';
    if (e.op === 'unop') return walk(e.a);
    if (e.op === 'binop' && ['+', '-', '*', '/', '%'].includes(e.bop)) {
      const a = walk(e.a);
      const b = walk(e.b);
      return a && b;
    }
    return abstractLiteralOf(e) !== undefined;
  };
  return walk(expr) ? out : [];
}

let soft = false;

export function softDemands<T>(run: () => T): T {
  const outer = soft;
  soft = true;
  try {
    return run();
  } finally {
    soft = outer;
  }
}

let quiet = false;

export function quietDemands<T>(run: () => T): T {
  const outer = quiet;
  quiet = true;
  try {
    return run();
  } finally {
    quiet = outer;
  }
}

function record(value: InferredValue, asked: Demand): void {
  if (current === undefined || quiet || (value.type !== undefined && value.open !== true)) return;
  if (asked === 'f32' && value.perUse !== true) return;
  const demand: Demand = soft && (asked === 'i32' || asked === 'u32') ? 'int' : asked;
  const key = value.key ?? value.decl;
  let entry = current.demands.get(key);
  if (entry === undefined) {
    current.demands.set(
      key,
      (entry = {
        name: value.name,
        asked: new Set(),
        perUse: value.perUse === true,
        ...(value.callee !== undefined ? { callee: value.callee } : {}),
      }),
    );
  }
  entry.asked.add(demand);
}

export function inferredOfExpr(expr: Expr | undefined): InferredValue | undefined {
  return expr === undefined ? undefined : readByExpr.get(expr);
}

export function noteDemand(expr: Expr, demand: Demand | ShaderType): void {
  if (current === undefined) return;
  const asked: Demand | undefined = typeof demand === 'string' ? demand : demandOfType(demand);
  if (asked === undefined) return;
  for (const value of undecidedIn(expr)) record(value, asked);
}

export function noteStoredType(
  value: InferredValue | undefined,
  stored: Expr,
  type: ShaderType,
): void {
  if (value === undefined || undecidedIn(stored).length > 0) return;
  const asked = demandOfType(type);
  if (asked !== undefined) record(value, asked);
}

export function noteIntegerUse(value: InferredValue | undefined, peer?: ShaderType): void {
  if (value === undefined) return;
  const asked = peer === undefined ? undefined : demandOfType(peer);
  record(value, asked === 'i32' || asked === 'u32' ? asked : 'int');
}

export const counterDefaultI32: ShaderType = { kind: 'scalar', scalar: 'i32' };

export function readsUndecided(expr: Expr): boolean {
  return undecidedIn(expr).length > 0;
}

function demandOfType(type: ShaderType): Demand | undefined {
  if (type === counterDefaultI32) return 'int';
  if (type.kind === 'array') return demandOfType(type.elem);
  if (type.kind === 'f64' || type.kind === 'vec64') return 'f64';
  if (type.kind === 'vec') return type.elem === 'f32' ? 'f32' : type.elem === 'i32' ? 'i32' : 'u32';
  const key = typeKey(type);
  return key === 'i32' || key === 'u32' || key === 'f32' ? key : undefined;
}

export { carriedOf, inferredOrigin } from './inferred-origin.js';
