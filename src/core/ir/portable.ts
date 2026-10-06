// ═══ The portable IR (change 0025, Rule 11.10) ═══
//
// A module as JSON, for the manifest to carry when asked (`packModule(m, { ir: true })`), so the
// load-time emitter (`typeshade/emit`) can emit the program again without the front end. Four
// things do not survive `JSON.stringify` as they are, and are written another way:
//
//   - `declRef`, the callee a call made through a real function handle points at, is written as
//     the callee's name and joined back to the declaration of that name on read. Inlined, it
//     repeats the callee's whole body at every call: the largest example's IR was 1,156,773
//     bytes that way, against 185,171 by reference.
//   - A node used in more than one place is one node: passes key on identity (`autoVars` makes
//     one variable of one node wherever it is read), and JSON would write a copy at each use.
//     Such a node is written whole where the walk meets it first, with an `$id`, and as
//     `{ "$ref": id }` everywhere after; reading joins them back into one object.
//   - A number JSON cannot spell (`-0`, `NaN`, the infinities) is written as `{ "$n": "-0" }`,
//     since `JSON.stringify` writes `-0` as `0` and the others as `null`.
//   - A span is kept only where an output reads it: on a `console.*` call, whose event reports
//     its line; on a statement that makes a barrier, whose line the WebGL2 pass program names
//     (change 0054); and on a function, whose line the manifest's entry gives. Every other span
//     is dropped; no emitted byte depends on one (`ir/span.ts`).
//
// The format is not stable (roadmap item 24): `version` records the package that wrote it, and
// only that version reads it.

import type { FuncDecl, ModuleDecl } from './nodes.js';
import { isBarrierIntrinsic } from '../intrinsics.js';

/** A module as JSON, and the package version that wrote it. */
export interface PortableIr {
  /** The package version that wrote it; only the same version reads it. */
  readonly version: string;
  /** The module, encoded as this file describes. */
  readonly module: unknown;
}

const isFuncDecl = (v: object): v is FuncDecl => 'body' in v && 'params' in v && 'name' in v;

const isConsoleCall = (v: unknown): boolean =>
  typeof v === 'object' &&
  v !== null &&
  (v as Record<string, unknown>)['op'] === 'call' &&
  String((v as Record<string, unknown>)['fn']).startsWith('console.');

/** A barrier, or `workgroupUniformLoad`, which waits as one: a cut of change 0054's pass program,
 *  whose line the manifest's `gl.computes` names for a workgroup that diverges at it. */
const isBarrierCall = (v: unknown): boolean =>
  typeof v === 'object' &&
  v !== null &&
  (v as Record<string, unknown>)['op'] === 'call' &&
  (v as Record<string, unknown>)['declRef'] === undefined &&
  (isBarrierIntrinsic(String((v as Record<string, unknown>)['fn'])) ||
    (v as Record<string, unknown>)['fn'] === 'workgroupUniformLoad');

/** Whether an object keeps its `span`: a `console.*` call and the statement that makes it, whose
 *  span is the one the event reports; a statement that makes a barrier, whose line the manifest's
 *  `gl.computes` gives; and a function, whose line the manifest's entry gives. */
const keepsSpan = (o: Record<string, unknown>): boolean =>
  isConsoleCall(o) ||
  ('s' in o &&
    (isConsoleCall(o['expr']) || isBarrierCall(o['expr']) || isBarrierCall(o['init']))) ||
  isFuncDecl(o);

const isObject = (v: unknown): v is Record<string, unknown> =>
  (typeof v === 'object' || typeof v === 'function') && v !== null;

/** Every object `v` reaches more than once, walked as `encode` walks it. */
function shared(v: unknown): Set<object> {
  const seen = new Set<object>();
  const twice = new Set<object>();
  const walk = (x: unknown): void => {
    if (Array.isArray(x)) {
      for (const y of x) walk(y);
      return;
    }
    if (!isObject(x)) return;
    if (seen.has(x)) {
      twice.add(x);
      return;
    }
    seen.add(x);
    for (const [k, y] of Object.entries(x)) if (k !== 'declRef') walk(y);
  };
  walk(v);
  return twice;
}

function encoder(many: Set<object>): (v: unknown) => unknown {
  const ids = new Map<object, number>();
  const encode = (v: unknown): unknown => {
    if (typeof v === 'number') {
      if (Object.is(v, -0)) return { $n: '-0' };
      if (Number.isNaN(v)) return { $n: 'NaN' };
      if (v === Infinity) return { $n: 'Infinity' };
      if (v === -Infinity) return { $n: '-Infinity' };
      return v;
    }
    if (Array.isArray(v)) return v.map(encode);
    // A declaration the EDSL made is a function handle with its fields as properties: it is
    // read as the object those properties are, since JSON would write a function as nothing.
    if (!isObject(v)) return v;
    const seen = ids.get(v);
    if (seen !== undefined) return { $ref: seen };
    const out: Record<string, unknown> = {};
    if (many.has(v)) {
      out['$id'] = ids.size;
      ids.set(v, ids.size);
    }
    for (const [k, x] of Object.entries(v)) {
      if (x === undefined) continue;
      if (k === 'declRef' && isObject(x)) out[k] = { $fn: (x as unknown as FuncDecl).name };
      else if (k === 'span' && !keepsSpan(v)) continue;
      else out[k] = encode(x);
    }
    return out;
  };
  return encode;
}

/** `m` as portable IR, written by `version`. */
export function toPortable(m: ModuleDecl, version: string): PortableIr {
  return { version, module: encoder(shared(m))(m) };
}

/** The module `p` holds. The caller checks `p.version` first. */
export function fromPortable(p: PortableIr): ModuleDecl {
  const refs: { target: Record<string, unknown>; name: string }[] = [];
  const byId = new Map<number, Record<string, unknown>>();
  const decode = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(decode);
    if (typeof v !== 'object' || v === null) return v;
    const o = v as Record<string, unknown>;
    if (typeof o['$n'] === 'string' && Object.keys(o).length === 1) return Number(o['$n']);
    if (typeof o['$ref'] === 'number' && Object.keys(o).length === 1) return byId.get(o['$ref']);
    const out: Record<string, unknown> = {};
    if (typeof o['$id'] === 'number') byId.set(o['$id'], out);
    for (const [k, x] of Object.entries(o)) {
      if (k === '$id') continue;
      if (k === 'declRef' && typeof x === 'object' && x !== null && '$fn' in x) {
        refs.push({ target: out, name: String((x as { $fn: unknown }).$fn) });
        continue;
      }
      out[k] = decode(x);
    }
    return out;
  };
  const m = decode(p.module) as ModuleDecl;
  // Each call's callee, joined back by name. A callee the module no longer declares (a pass
  // rewrote it away) still marks the call as one to a declared function, which is all the
  // emit path reads of it.
  const byName = new Map(m.funcs.map((f) => [f.name, f]));
  for (const { target, name } of refs)
    target['declRef'] = byName.get(name) ?? ({ name, params: [], body: [] } as unknown as FuncDecl);
  return m;
}
