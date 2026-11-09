// What the CPU backend of the render hardware interface needs of a module beside its code
// (change 0120, M3): each entry's stage interface, parameter by parameter, why the CPU cannot run
// an entry when it cannot, each buffer binding's byte layout, and the workgroup variables' zero
// values. Read from the IR alone, so every producer of a `CpuProgram` (`rhi/cpu-program.ts`)
// builds the same one. It is no part of the runtime's closure: the producers are build-time code
// and the tests.

import { retIoAttrOf, ioAttrOf } from './ir/entry-io.js';
import type { FuncDecl, ModuleDecl, StructDecl } from './ir/nodes.js';
import type { ShaderType } from './ir/types.js';
import { eachExpr, eachStmtExpr } from './ir/visit.js';
import { isBarrierIntrinsic } from './intrinsics.js';
import { GPU_STUBS, zeroOf } from './cpu-runtime.js';
import { calleesOf, closureOf, layoutOf } from './manifest.js';
import { packLayout } from './manifest-types.js';
import { fnReads, fnWrites } from './passes/effects.js';
import { workgroupShapeOf } from './ir/nodes.js';
import type { CpuBinding, CpuEntry, CpuIo, CpuIoField, CpuProgram } from '../rhi/cpu-program.js';

/** Whether `t` holds integers: a varying of it interpolates only `flat`. */
function isInteger(t: ShaderType): boolean {
  if (t.kind === 'scalar') return t.scalar === 'i32' || t.scalar === 'u32';
  if (t.kind === 'vec') return t.elem === 'i32' || t.elem === 'u32';
  return false;
}

function fieldOf(
  name: string,
  type: ShaderType,
  attr: { location?: number; builtin?: string; interpolate?: string },
): CpuIoField {
  return {
    name,
    ...(attr.builtin !== undefined ? { builtin: attr.builtin } : {}),
    ...(attr.location !== undefined ? { location: attr.location } : {}),
    ...(attr.interpolate !== undefined ? { interpolate: attr.interpolate } : {}),
    ...(isInteger(type) ? { integer: true as const } : {}),
    ...(type.kind === 'scalar' ? { width: 1 } : type.kind === 'vec' ? { width: type.n } : {}),
  };
}

/** One side of an entry's signature as the CPU backend fills or reads it. */
function ioOf(
  type: ShaderType,
  attr: { location?: number; builtin?: string; interpolate?: string },
  name: string,
  structs: ReadonlyMap<string, StructDecl>,
): CpuIo {
  if (type.kind === 'struct') {
    const s = structs.get(type.name);
    if (s !== undefined)
      return {
        kind: 'struct',
        fields: s.fields.map((f) => fieldOf(f.name, f.type, ioAttrOf(f))),
      };
  }
  return { kind: 'field', field: fieldOf(name, type, attr) };
}

/** The handle types the CPU backend cannot read (change 0120, O6 (a)). */
const HANDLES = new Set([
  'texture',
  'storage-texture',
  'depth-texture',
  'sampler',
  'sampler-comparison',
]);

/** The parts of a `CpuProgram` that the IR gives: everything but the code. `emitted` gives an
 *  entry's name in the emitted text, by which a pipeline names it; the authored name when
 *  omitted. */
export function cpuEntriesOf(
  m: ModuleDecl,
  emitted: (fn: string) => string = (fn) => fn,
): Omit<CpuProgram, 'code'> {
  const structs = new Map(m.structs.map((s) => [s.name, s]));
  const declared = new Set(m.funcs.map((f) => f.name));
  const byName = new Map(m.funcs.map((f) => [f.name, f]));
  const callees = new Map(m.funcs.map((f) => [f.name, calleesOf(f, declared)]));
  const reads = fnReads(m);
  const writes = fnWrites(m);
  const handles = new Map(
    m.bindings.filter((b) => HANDLES.has(b.type.kind)).map((b) => [b.name, b]),
  );

  /** Why the CPU cannot run the entry `f`, when it cannot. */
  const noCpu = (f: FuncDecl): string | undefined => {
    for (const g of closureOf(f.name, callees)) {
      for (const n of [...(reads.get(g) ?? []), ...(writes.get(g) ?? [])]) {
        const h = handles.get(n);
        if (h !== undefined)
          return `it reaches the ${h.type.kind} "${h.name}", which the CPU tier cannot read (change 0120, O6 (a))`;
      }
      let call: string | undefined;
      for (const s of byName.get(g)!.body)
        eachStmtExpr(s, (e) =>
          eachExpr(e, (x) => {
            if (call !== undefined || x.op !== 'call' || declared.has(x.fn)) return;
            if (isBarrierIntrinsic(x.fn) || GPU_STUBS[x.fn] !== undefined) call = x.fn;
          }),
        );
      if (call !== undefined)
        return isBarrierIntrinsic(call)
          ? `it reaches ${call}(), and the CPU backend runs one invocation at a time`
          : `it reaches ${call}(), which only a GPU computes (change 0120, O6 (a))`;
    }
    return undefined;
  };

  const entries: Record<string, CpuEntry> = {};
  for (const f of m.funcs) {
    if (f.stage === undefined) continue;
    const why = noCpu(f);
    entries[emitted(f.name)] = {
      fn: f.name,
      stage: f.stage,
      params: f.params.map((p) => ioOf(p.type, ioAttrOf(p), p.name, structs)),
      ...(f.ret.kind === 'void' ? {} : { out: ioOf(f.ret, retIoAttrOf(f), '_ret', structs) }),
      ...(f.stage === 'compute' ? { workgroupSize: workgroupShapeOf(f) ?? [64, 1, 1] } : {}),
      ...(why !== undefined ? { noCpu: why } : {}),
    };
  }

  const bindings: CpuBinding[] = m.bindings.map((b) => {
    const at = { name: b.name, group: b.group, binding: b.binding };
    if (HANDLES.has(b.type.kind))
      return { ...at, kind: 'handle', noLayout: `a ${b.type.kind} has no bytes` };
    const kind = b.space === 'storage' ? 'storage' : 'uniform';
    const layout = layoutOf(b.type, kind === 'uniform' ? 'std140' : 'std430', structs);
    return 'none' in layout
      ? { ...at, kind, noLayout: layout.none }
      : { ...at, kind, layout: packLayout(layout) };
  });

  const workgroupZero = Object.fromEntries(
    (m.vars ?? [])
      .filter((v) => v.space === 'workgroup')
      .map((v) => [v.name, zeroOf(v.type, structs)]),
  );
  return { entries, bindings, workgroupZero };
}
