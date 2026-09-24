// ═══ Shader DSL — the console buffer (changes/0014, surface §66) ═══
//
// A `console.*` call computes nothing a shader reads, so WGSL drops it by default: the optimizer
// removes a call with no effect and keeps its arguments' writes. When a compile asks for GPU
// recording (`compile(src, { console: 'gpu' })`), this pass rewrites each call a compute or
// fragment entry reaches into writes to one storage buffer the compiler adds, `_console`, which
// the host copies back and `decodeConsole` turns into the events the CPU sink receives.
//
// IR to IR, before every backend pass, so nothing new reaches the shared walk (Rule 11.1): the
// reservation is an `atomicAdd` and the entry is plain stores into a storage binding, both effects
// every optimizer pass already keeps. The CPU oracle never runs this pass; it delivers each call
// to its sink directly. `console-buffer.test.ts` runs the LOWERED module on the oracle with the
// buffer bound to an array and holds the decoded events equal to the sink's.
//
// The layout (measured on Tint and SwiftShader in Chromium 141; changes/0014 "Why"):
//
//   struct _Console { cursor: atomic<u32>, dropped: atomic<u32>, words: array<u32> }
//
// An entry is [site, invocation.x, invocation.y, invocation.z, value words...]. The call reserves
// its words with one atomicAdd on `cursor`; an entry that does not fit `arrayLength(words)` is
// dropped and counted in `dropped`, never written in part, except that one straddling the end
// writes its site word, which is how the decoder finds where the written entries stop. The host
// resets the two header words before each dispatch or draw, and sizes the buffer as it likes.
//
// Implements: Rule 6.11, Rule 11.9 (docs/language-design.md; traced in reqs/).

import type { Expr, FuncDecl, ModuleDecl, Stmt, StructDecl } from '../ir/index.js';
import { boolT, f32T, u32T, vec3uT, type ShaderType } from '../ir/types.js';
import type { SourceSpan } from '../ir/span.js';
import { stageOf } from '../ir/index.js';
import { reachFrom } from './stage-bindings.js';
import type { ConsoleLog, ConsoleShape, ConsoleSite, ConsoleMethod } from '../console.js';

/** The names this pass declares. A module that already declares one is not recorded. */
export const CONSOLE_NAMES = {
  binding: '_console',
  struct: '_Console',
  invocation: '_console_inv',
  reserve: '_console_reserve',
} as const;

/** The words an entry takes before its values: the site and the three invocation words. */
export const CONSOLE_ENTRY_HEADER = 4;

/** WebGPU's default `maxStorageBuffersPerShaderStage`: a stage that already binds this many has
 *  no room for the console buffer. */
export const DEFAULT_STORAGE_BUFFERS_PER_STAGE = 8;

/** A console call the WGSL does not record, and why, for the `TS8071` warning. */
export interface ConsoleNotRecorded {
  readonly span?: SourceSpan;
  readonly method: string;
  readonly reason: string;
}

/** What {@link consoleBuffer} returns. */
export interface ConsoleBufferResult {
  /** The module with the buffer, the helper and each recorded call rewritten. The same object
   *  when nothing is recorded. */
  readonly module: ModuleDecl;
  /** The slot and the site table, or `undefined` when no call is recorded. */
  readonly log?: ConsoleLog;
  readonly notRecorded: readonly ConsoleNotRecorded[];
}

const wordsT: ShaderType = { kind: 'array', elem: u32T };
const NONE = 0xffffffff;

const lit = (value: number): Expr => ({ op: 'lit', type: u32T, value });
const ref = (name: string, type: ShaderType): Expr => ({ op: 'varref', type, name });
const call = (fn: string, type: ShaderType, args: Expr[]): Expr => ({
  op: 'call',
  type,
  fn,
  args,
});
const add = (a: Expr, b: Expr): Expr => ({ op: 'binop', type: u32T, bop: '+', a, b });
const cmp = (cop: string, a: Expr, b: Expr): Expr =>
  ({ op: 'compare', type: boolT, cop, a, b }) as Expr;
const member = (base: Expr, field: string, type: ShaderType): Expr => ({
  op: 'member',
  type,
  base,
  field,
});
const index = (base: Expr, idx: Expr, type: ShaderType): Expr => ({
  op: 'index',
  type,
  base,
  idx,
});

const buffer = (): Expr =>
  ref(CONSOLE_NAMES.binding, { kind: 'struct', name: CONSOLE_NAMES.struct });
const words = (): Expr => member(buffer(), 'words', wordsT);
const word = (at: Expr): Expr => index(words(), at, u32T);

const isReason = (
  s: ConsoleShape | { readonly reason: string },
): s is { readonly reason: string } => typeof s === 'object' && 'reason' in s;

/** The shape of a value the buffer carries, or the reason it carries none. */
export function consoleShapeOf(
  t: ShaderType,
  structs: ReadonlyMap<string, StructDecl>,
): ConsoleShape | { readonly reason: string } {
  switch (t.kind) {
    case 'scalar':
      return t.scalar;
    case 'f64':
      return 'f64';
    case 'vec':
      return { vec: t.n, of: t.elem };
    case 'vec64':
      return { vec: t.n, of: 'f64' };
    case 'mat':
      return { mat: [t.cols, t.rows], of: t.elem };
    case 'array': {
      if (t.size === undefined)
        return { reason: 'a runtime-sized array has no fixed size to write' };
      const elem = consoleShapeOf(t.elem, structs);
      return isReason(elem) ? elem : { array: elem, n: t.size };
    }
    case 'struct': {
      const decl = structs.get(t.name);
      if (!decl) return { reason: `struct "${t.name}" is not declared` };
      const fields: [string, ConsoleShape][] = [];
      for (const f of decl.fields) {
        const s = consoleShapeOf(f.type, structs);
        if (isReason(s)) return s;
        fields.push([f.name, s]);
      }
      return { struct: fields };
    }
    case 'atomic':
      return { reason: 'an atomic is a location, not a value' };
    default:
      return { reason: `a ${t.kind} is not a value` };
  }
}

/** How many words a value of `shape` takes. */
export function consoleWordsOf(shape: ConsoleShape): number {
  if (typeof shape === 'string') return shape === 'f64' ? 2 : 1;
  if ('vec' in shape) return shape.vec * (shape.of === 'f64' ? 2 : 1);
  if ('mat' in shape) return shape.mat[0] * shape.mat[1] * (shape.of === 'f64' ? 2 : 1);
  if ('array' in shape) return shape.n * consoleWordsOf(shape.array);
  return shape.struct.reduce((n, [, s]) => n + consoleWordsOf(s), 0);
}

const COMPONENTS = ['x', 'y', 'z', 'w'] as const;

/** The u32 words of `e`, a value of `shape`, in the order the decoder reads them. */
function wordsOfValue(e: Expr, shape: ConsoleShape): Expr[] {
  if (typeof shape === 'string') {
    switch (shape) {
      case 'u32':
        return [e];
      case 'i32':
        // WGSL's u32(i32) keeps the bits.
        return [call('u32', u32T, [e])];
      case 'f32':
        return [call('bitcastU32', u32T, [e])];
      case 'bool':
        return [{ op: 'select', type: u32T, cond: e, ifTrue: lit(1), ifFalse: lit(0) }];
      case 'f64': {
        // The two halves, hi and lo, with the emulation's own narrowing and widening.
        const hi = call('f32', f32T, [e]);
        const lo = call('f32', f32T, [
          {
            op: 'binop',
            type: { kind: 'f64' },
            bop: '-',
            a: e,
            b: call('f64', { kind: 'f64' }, [hi]),
          },
        ]);
        return [call('bitcastU32', u32T, [hi]), call('bitcastU32', u32T, [lo])];
      }
    }
  }
  if ('vec' in shape) {
    const elemT: ShaderType =
      shape.of === 'f64' ? { kind: 'f64' } : { kind: 'scalar', scalar: shape.of };
    return COMPONENTS.slice(0, shape.vec).flatMap((c) =>
      wordsOfValue(member(e, c, elemT), shape.of),
    );
  }
  if ('mat' in shape) {
    const [cols, rows] = shape.mat;
    const colT: ShaderType =
      shape.of === 'f64' ? { kind: 'vec64', n: rows } : { kind: 'vec', n: rows, elem: 'f32' };
    const out: Expr[] = [];
    for (let j = 0; j < cols; j++)
      out.push(...wordsOfValue(index(e, lit(j), colT), { vec: rows, of: shape.of }));
    return out;
  }
  if ('array' in shape) {
    const out: Expr[] = [];
    const elemT = (e.type as Extract<ShaderType, { kind: 'array' }>).elem;
    for (let i = 0; i < shape.n; i++)
      out.push(...wordsOfValue(index(e, lit(i), elemT), shape.array));
    return out;
  }
  const structName = (e.type as Extract<ShaderType, { kind: 'struct' }>).name;
  return shape.struct.flatMap(([name, s]) =>
    wordsOfValue(member(e, name, fieldType(s, structName, name)), s),
  );
}

/** A struct field's type, read back from the declaration when the pass has it. */
let structTable: ReadonlyMap<string, StructDecl> = new Map();
function fieldType(_s: ConsoleShape, struct: string, field: string): ShaderType {
  const f = structTable.get(struct)?.fields.find((x) => x.name === field);
  if (!f) throw new Error(`typeshade: console buffer: no field ${struct}.${field}`);
  return f.type;
}

/** The reserve helper: returns where the entry's values start, or 0xffffffff when dropped. */
function reserveFn(): FuncDecl {
  const at = ref('at', u32T);
  const len = ref('len', u32T);
  const site = { op: 'param', type: u32T, name: 'site' } as Expr;
  const n = { op: 'param', type: u32T, name: 'n' } as Expr;
  const inv = ref(CONSOLE_NAMES.invocation, vec3uT);
  const cursor = member(buffer(), 'cursor', { kind: 'atomic', elem: 'u32' } as ShaderType);
  const dropped = member(buffer(), 'dropped', { kind: 'atomic', elem: 'u32' } as ShaderType);
  const body: Stmt[] = [
    { s: 'let', name: 'at', expr: call('atomicAdd', u32T, [cursor, n]) },
    { s: 'let', name: 'len', expr: call('arrayLength', u32T, [words()]) },
    // The straddling entry writes its site word: the decoder stops there.
    {
      s: 'if',
      arms: [{ cond: cmp('<', at, len), body: [{ s: 'assign', target: word(at), expr: site }] }],
    },
    {
      s: 'if',
      arms: [
        {
          cond: {
            op: 'logical',
            type: boolT,
            lop: '||',
            a: cmp('>', n, len),
            b: cmp('>', at, { op: 'binop', type: u32T, bop: '-', a: len, b: n }),
          },
          body: [
            { s: 'call', expr: call('atomicAdd', u32T, [dropped, lit(1)]) },
            { s: 'return', expr: lit(NONE) },
          ],
        },
      ],
    },
    ...COMPONENTS.slice(0, 3).map((c, k): Stmt => ({
      s: 'assign',
      target: word(add(at, lit(k + 1))),
      expr: member(inv, c, u32T),
    })),
    { s: 'return', expr: add(at, lit(CONSOLE_ENTRY_HEADER)) },
  ];
  return {
    name: CONSOLE_NAMES.reserve,
    params: [
      { name: 'site', type: u32T },
      { name: 'n', type: u32T },
    ],
    ret: u32T,
    body,
  };
}

const isConsoleCall = (e: Expr): e is Extract<Expr, { op: 'call' }> =>
  e.op === 'call' && e.declRef === undefined && e.fn.startsWith('console.');

/** Rewrite each console call a compute or fragment entry reaches into writes to the console
 *  buffer, and describe the buffer. Pure; `m` is not changed. */
export function consoleBuffer(m: ModuleDecl): ConsoleBufferResult {
  structTable = new Map(m.structs.map((s) => [s.name, s]));
  const notRecorded: ConsoleNotRecorded[] = [];
  const entries = m.funcs.filter((f) => stageOf(f) !== undefined);
  const reach = new Map(entries.map((e) => [e.name, reachFrom(m, [e])]));
  const reachedBy = (fn: string): FuncDecl[] =>
    entries.filter((e) => reach.get(e.name)!.fns.has(fn));

  const taken = [
    ...m.bindings.map((b) => b.name),
    ...m.structs.map((s) => s.name),
    ...m.funcs.map((f) => f.name),
    ...(m.vars ?? []).map((v) => v.name),
    ...m.consts.map((c) => c.name),
  ].find((n) => (Object.values(CONSOLE_NAMES) as string[]).includes(n));

  const storageCount = (e: FuncDecl): number =>
    m.bindings.filter((b) => b.space === 'storage' && reach.get(e.name)!.bindings.has(b.name))
      .length;

  /** Why the calls in `fn` are not recorded, or undefined when they are. */
  const fnReason = (fn: string): string | undefined => {
    if (taken !== undefined)
      return `the module declares "${taken}", the name the console buffer takes`;
    const by = reachedBy(fn);
    const vertex = by.find((e) => stageOf(e) === 'vertex');
    if (vertex)
      return `the vertex entry "${vertex.name}" reaches it, and a vertex stage cannot write a storage buffer`;
    const full = by.find((e) => storageCount(e) >= DEFAULT_STORAGE_BUFFERS_PER_STAGE);
    if (full)
      return `"${full.name}" already binds ${storageCount(full)} storage buffers, WebGPU's default limit for a stage`;
    if (by.length === 0) return 'no entry reaches it';
    return undefined;
  };

  const sites: ConsoleSite[] = [];
  const recordedIn = new Set<string>();
  let temp = 0;

  const lowerCall = (
    c: Extract<Expr, { op: 'call' }>,
    span: SourceSpan | undefined,
    fnReasonText: string | undefined,
  ): Stmt[] | undefined => {
    const method = c.fn.slice('console.'.length) as ConsoleMethod;
    const at = span ?? c.span;
    if (fnReasonText !== undefined) {
      notRecorded.push({ span: at, method, reason: fnReasonText });
      return undefined;
    }
    const shapes: ConsoleShape[] = [];
    for (const a of c.args) {
      const s = consoleShapeOf(a.type, structTable);
      if (isReason(s)) {
        notRecorded.push({ span: at, method, reason: s.reason });
        return undefined;
      }
      shapes.push(s);
    }
    const id = sites.length;
    const valueWords = shapes.reduce((n, s) => n + consoleWordsOf(s), 0);
    sites.push({
      method,
      ...(at !== undefined ? { span: at } : {}),
      args: (c.labels ?? c.args.map((_, k) => k)).map((l) =>
        typeof l === 'string' ? { label: l } : { shape: shapes[l]! },
      ),
      words: CONSOLE_ENTRY_HEADER + valueWords,
    });
    const k = temp++;
    const out: Stmt[] = [];
    // Each argument once, in order (Rule 7.9, Rule 11.9), before the reservation.
    const values = c.args.map((a, i): Expr => {
      const name = `_console_${k}_${i}`;
      out.push({ s: 'let', name, expr: a });
      return ref(name, a.type);
    });
    const start = `_console_${k}`;
    out.push({
      s: 'let',
      name: start,
      expr: call(CONSOLE_NAMES.reserve, u32T, [lit(id), lit(CONSOLE_ENTRY_HEADER + valueWords)]),
    });
    const stores: Stmt[] = [];
    let off = 0;
    values.forEach((v, i) => {
      for (const w of wordsOfValue(v, shapes[i]!)) {
        stores.push({ s: 'assign', target: word(add(ref(start, u32T), lit(off))), expr: w });
        off++;
      }
    });
    out.push({
      s: 'if',
      arms: [{ cond: cmp('!=', ref(start, u32T), lit(NONE)), body: stores }],
    });
    return out;
  };

  const lowerBody = (body: readonly Stmt[], reason: string | undefined, fn: string): Stmt[] =>
    body.flatMap((s): Stmt[] => {
      if (s.s === 'call' && isConsoleCall(s.expr)) {
        const lowered = lowerCall(s.expr, s.span, reason);
        if (lowered === undefined) return [s];
        recordedIn.add(fn);
        return lowered;
      }
      switch (s.s) {
        case 'if':
          return [
            {
              ...s,
              arms: s.arms.map((a) => ({ cond: a.cond, body: lowerBody(a.body, reason, fn) })),
              ...(s.elseBody ? { elseBody: lowerBody(s.elseBody, reason, fn) } : {}),
            },
          ];
        case 'for':
          return [{ ...s, body: lowerBody(s.body, reason, fn) }];
        case 'switch':
          return [
            {
              ...s,
              cases: s.cases.map((c) => ({
                values: c.values,
                body: lowerBody(c.body, reason, fn),
              })),
              ...(s.defaultBody ? { defaultBody: lowerBody(s.defaultBody, reason, fn) } : {}),
            },
          ];
        default:
          return [s];
      }
    });

  let funcs = m.funcs.map((f) => {
    const hasConsole = JSON.stringify(f.body, (k, v) => (k === 'declRef' ? undefined : v)).includes(
      '"fn":"console.',
    );
    if (!hasConsole) return f;
    return { ...f, body: lowerBody(f.body, fnReason(f.name), f.name) };
  });

  if (sites.length === 0) return { module: m, notRecorded };

  // Each compute and fragment entry that reaches a recorded call sets the invocation id first.
  funcs = funcs.map((f) => {
    const stage = stageOf(f);
    if (stage !== 'compute' && stage !== 'fragment') return f;
    if (![...recordedIn].some((fn) => reach.get(f.name)!.fns.has(fn))) return f;
    const builtin = stage === 'compute' ? 'global_invocation_id' : 'position';
    let params = f.params;
    let source: Expr | undefined;
    const own = f.params.find((p) => p.builtin === builtin);
    if (own) source = { op: 'param', type: own.type, name: own.name } as Expr;
    for (const p of f.params) {
      if (source || p.type.kind !== 'struct') continue;
      const field = structTable.get(p.type.name)?.fields.find((x) => x.builtin === builtin);
      if (field)
        source = member(
          { op: 'param', type: p.type, name: p.name } as Expr,
          field.name,
          field.type,
        );
    }
    if (!source) {
      const type: ShaderType = stage === 'compute' ? vec3uT : { kind: 'vec', n: 4, elem: 'f32' };
      params = [...f.params, { name: '_console_id', type, builtin }];
      source = { op: 'param', type, name: '_console_id' } as Expr;
    }
    const inv: Expr =
      stage === 'compute'
        ? source
        : {
            op: 'construct',
            type: vec3uT,
            args: [
              call('u32', u32T, [member(source, 'x', f32T)]),
              call('u32', u32T, [member(source, 'y', f32T)]),
              lit(0),
            ],
          };
    return {
      ...f,
      params,
      body: [{ s: 'assign', target: ref(CONSOLE_NAMES.invocation, vec3uT), expr: inv }, ...f.body],
    };
  });

  const g0 = m.bindings.filter((b) => b.group === 0);
  // The `_fp64` guard takes the same slot by the same rule, after this pass (fp64Lower runs in
  // the emit), so the console buffer comes first and the guard one past it.
  const binding = g0.length ? Math.max(...g0.map((b) => b.binding)) + 1 : 0;
  const module: ModuleDecl = {
    ...m,
    structs: [
      ...m.structs,
      {
        name: CONSOLE_NAMES.struct,
        fields: [
          { name: 'cursor', type: { kind: 'atomic', elem: 'u32' } as ShaderType },
          { name: 'dropped', type: { kind: 'atomic', elem: 'u32' } as ShaderType },
          { name: 'words', type: wordsT },
        ],
      },
    ],
    bindings: [
      ...m.bindings,
      {
        group: 0,
        binding,
        name: CONSOLE_NAMES.binding,
        space: 'storage',
        access: 'read_write',
        type: { kind: 'struct', name: CONSOLE_NAMES.struct },
      },
    ],
    vars: [...(m.vars ?? []), { name: CONSOLE_NAMES.invocation, space: 'private', type: vec3uT }],
    funcs: [reserveFn(), ...funcs],
  };
  return { module, log: { group: 0, binding, sites }, notRecorded };
}
