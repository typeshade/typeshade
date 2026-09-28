// ═══ The portable IR: a module as JSON, for the load-time emitter (change 0025 section 5, Rule 11.11) ═══
//
// A manifest carries its program's IR on request, `packModule(m, { ir: true })` or the plugin's
// `typeshade({ ir: true })`, so that `repack` (`typeshade/emit`) can emit the program again where
// it runs, from the IR alone, with no TypeScript front end. It is not a stable format (roadmap
// item 24): it records the package version that wrote it, and only the same version reads it.
//
// `JSON.stringify` alone loses three things the emitters read, so they are written explicitly:
//
//   - SHARING. The IR shares subtrees by identity, and a pass reads that identity: `autoVars`
//     turns an EDSL value that is later assigned into a `var` by finding the same `Expr` object
//     as the assignment's target and inside its value. Measured over the examples, a copy that
//     duplicates shared nodes emits other WGSL for 9 of 127 modules, and in `voronoi`
//     `min(_av0, …)` becomes `min(8.0, …)`. So an object reached more than once is written once,
//     into `shared`, and each place that reaches it holds `{ "@": index }`. A call's `declRef`
//     is one of these: it points at a function the module already holds, so it is a reference
//     and not a second copy of the callee's body.
//   - `-0`, `NaN` and the infinities, which JSON writes as `0` and `null`: `{ "#": "-0" }`.
//   - A `fn()` handle, the function object a module's `funcs` holds for an EDSL function, which
//     JSON drops: it is written as a plain object of the fields it carries.
//
// And it leaves the source spans out, except the two the manifest reports: an entry's, which
// gives `entries[].line`, and a `console.*` call's, which gives its line in the console log.
// Every other span says where a node was written and nothing an emitter reads (`span.ts`).

import { stageOf } from './nodes.js';
import type { ModuleDecl } from './nodes.js';
import { VERSION } from '../version.js';

/** A module's IR as plain JSON: see this file's header. */
export interface PortableIr {
  /** The package version that wrote it. Only the same version reads it. */
  readonly compiler: string;
  /** Every object the module reaches more than once, written once. */
  readonly shared: readonly unknown[];
  /** The module, where `{ "@": i }` stands for `shared[i]`. */
  readonly module: unknown;
}

/** A JSON value. */
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** The key of a reference into `shared`, and of a number JSON cannot write. */
const REF = '@';
const NUM = '#';

/** The spelling of a number JSON cannot write, or `undefined` for one it can. */
function special(n: number): string | undefined {
  if (Object.is(n, -0)) return '-0';
  if (Number.isFinite(n)) return undefined;
  return String(n); // 'NaN', 'Infinity' or '-Infinity', which `Number()` reads back
}

/** Whether `o` is a `console.*` call the console lowering records, which reports its line. */
function isConsoleCall(o: unknown): boolean {
  const c = o as { op?: unknown; fn?: unknown; declRef?: unknown };
  return (
    c.op === 'call' &&
    typeof c.fn === 'string' &&
    c.fn.startsWith('console.') &&
    c.declRef === undefined
  );
}

/** Whether the manifest reports `o`'s span: an entry's, or a `console.*` call's and that of the
 *  statement that holds one. */
function reportsSpan(o: object): boolean {
  const x = o as { s?: unknown; expr?: unknown; params?: unknown; body?: unknown };
  if (isConsoleCall(o)) return true;
  if (x.s === 'call') return isConsoleCall(x.expr);
  // Only a function declaration carries both `params` and a `body`.
  if (Array.isArray(x.params) && Array.isArray(x.body))
    return stageOf(o as Parameters<typeof stageOf>[0]) !== undefined;
  return false;
}

/** The fields of `o` the portable IR writes: every own enumerable one that holds a value, a span
 *  only where the manifest reports it, and never a `nameSpan`. */
function fieldsOf(o: object): [string, unknown][] {
  const out: [string, unknown][] = [];
  for (const [k, v] of Object.entries(o)) {
    if (k === REF || k === NUM || k === '__proto__')
      throw new TypeError(`portable IR: an IR object has a field named "${k}"`);
    if (v === undefined || k === 'nameSpan') continue;
    if (k === 'span' && !reportsSpan(o)) continue;
    out.push([k, v]);
  }
  return out;
}

/** Whether `v` is one of the objects the IR is made of: an array, a plain object, or a `fn()`
 *  handle. Anything else (a `Map`, a class instance, a symbol) has no JSON form here. */
function isIrObject(v: unknown): v is object {
  if (typeof v === 'function') return true;
  if (typeof v !== 'object' || v === null) return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return Array.isArray(v) || proto === Object.prototype || proto === null;
}

/** The children of an IR object that the portable IR writes. */
function childrenOf(o: object): unknown[] {
  return Array.isArray(o) ? (o as unknown[]) : fieldsOf(o).map(([, v]) => v);
}

/** `m` as portable IR: plain JSON that {@link fromPortableIr} reads back into a module that emits
 *  the same WGSL, GLSL, reflection, console variant and manifest, byte for byte. */
export function toPortableIr(m: ModuleDecl): PortableIr {
  // How many places reach each object, over the fields that are written.
  const reached = new Map<object, number>();
  const todo: unknown[] = [m];
  while (todo.length > 0) {
    const v = todo.pop();
    if (typeof v !== 'object' && typeof v !== 'function') continue;
    if (v === null) continue;
    const n = reached.get(v) ?? 0;
    reached.set(v, n + 1);
    if (n === 0) for (const c of childrenOf(v)) todo.push(c);
  }

  const index = new Map<object, number>();
  const shared: Json[] = [];
  const write = (v: unknown): Json => {
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v === 'number') {
      const s = special(v);
      return s === undefined ? v : { [NUM]: s };
    }
    if (!isIrObject(v)) throw new TypeError(`portable IR: a ${typeof v} has no JSON form`);
    if ((reached.get(v) ?? 0) < 2) return contents(v);
    let i = index.get(v);
    if (i === undefined) {
      // The slot is taken before the contents are written, so a cycle (a recursive function,
      // through its calls' `declRef`) closes onto it.
      i = shared.length;
      index.set(v, i);
      shared.push(null);
      shared[i] = contents(v);
    }
    return { [REF]: i };
  };
  const contents = (o: object): Json =>
    Array.isArray(o)
      ? o.map((x: unknown) => {
          if (x === undefined) throw new TypeError('portable IR: an array holds undefined');
          return write(x);
        })
      : Object.fromEntries(fieldsOf(o).map(([k, x]) => [k, write(x)]));

  const module = write(m);
  return { compiler: VERSION, shared, module };
}

/** The module `ir` holds. It refuses IR that another version of the package wrote, naming both
 *  versions: the IR is not a stable format, and only the version that wrote it reads it. */
export function fromPortableIr(ir: PortableIr): ModuleDecl {
  if (ir.compiler !== VERSION)
    throw new Error(
      `This program's IR was written by typeshade ${ir.compiler}, and this is typeshade ${VERSION}: only the version that wrote it reads it. Build the program again with typeshade ${VERSION}; its emitted text still loads as it is.`,
    );
  const table = ir.shared as readonly Json[];
  const built: (object | undefined)[] = [];

  const read = (v: Json): unknown => {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(read);
    const keys = Object.keys(v);
    if (keys.length === 1 && keys[0] === REF) return sharedAt(v[REF]!);
    if (keys.length === 1 && keys[0] === NUM) return Number(v[NUM]);
    return fill({}, v);
  };
  const fill = (out: Record<string, unknown>, v: { [key: string]: Json }): object => {
    for (const [k, x] of Object.entries(v)) {
      if (k === '__proto__') throw new TypeError('portable IR: a field named "__proto__"');
      out[k] = read(x);
    }
    return out;
  };
  const sharedAt = (at: Json): object => {
    if (typeof at !== 'number' || !Number.isInteger(at) || at < 0 || at >= table.length)
      throw new TypeError(`portable IR: a reference to ${JSON.stringify(at)} is outside its table`);
    const done = built[at];
    if (done !== undefined) return done;
    const src = table[at]!;
    // The object is registered before its contents are read, so a cycle closes onto it.
    if (Array.isArray(src)) {
      const out: unknown[] = [];
      built[at] = out;
      for (const x of src) out.push(read(x));
      return out;
    }
    if (typeof src !== 'object' || src === null)
      throw new TypeError(`portable IR: shared[${at}] is not an object`);
    const out: Record<string, unknown> = {};
    built[at] = out;
    return fill(out, src);
  };

  return read(ir.module as Json) as ModuleDecl;
}
