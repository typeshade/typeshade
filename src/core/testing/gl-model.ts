// ═══ The WebGL2 executor of change 0054, modelled on the CPU ═══
//
// The GL executor (step 2 of change 0054) keeps each storage buffer and workgroup variable as a
// texture of 32-bit words, runs a split entry (`passes/phase-split.ts`) one pass at a time, and
// moves a pass's writes through a log and a scatter. This file runs the same plan over
// `Uint32Array`s, with the entry's memory rewritten to words (`passes/memory-words.ts`):
//
//   - a `_phLoad` answers from the invocation's own log, its latest write to that word first,
//     else from memory as the pass began, which no write of the pass has touched;
//   - a `_phStore` appends to the log, which may hold `logEntries` × 4 words;
//   - the scatter writes every invocation's log, in invocation index order;
//   - the resolve pass performs each atomic request on its word, in invocation index order.
//
// It is the GL executor's specification in code. The tests hold it to the phased oracle
// (`debug/phased.ts`) bit for bit on `f32` lanes, and the GLSL the executor runs will be held to
// it, so a difference in a texel says which side moved. Test code only.

import { atomicStep, zeroOf, type CpuValue } from '../cpu-runtime.js';
import { stageOf, type ModuleDecl, type ShaderType, type StructDecl } from '../ir/index.js';
import { typeLayout, wgslLayout } from '../reflect.js';
import { validate } from '../passes/validate.js';
import { autoVars } from '../passes/opt/index.js';
import { froundF32 } from '../passes/precision.js';
import { splitPhases } from '../passes/phase-split.js';
import { lowerMemoryWords, type WordPlan } from '../passes/memory-words.js';
import { drain, evalExpr, makeCtx, runFunction, type StepCtx } from '../debug/interp.js';
import { dispatchEach, type WorkgroupCount } from '../debug/dispatch.js';
import { schedulePasses, type Scheduled, type Vec3 } from '../debug/phased.js';

/** What a run of the model did. */
export interface GlModelReport {
  readonly passes: number;
  readonly barrierPhases: number;
  /** The most words one invocation's log held in one pass. */
  readonly maxLogWords: number;
}

const view = new DataView(new ArrayBuffer(4));
const f32Bits = (x: number): number => {
  view.setFloat32(0, x, true);
  return view.getUint32(0, true);
};
const bitsF32 = (b: number): number => {
  view.setUint32(0, b >>> 0, true);
  return view.getFloat32(0, true);
};

/** std430 words for host values: the same rules the lowering reads offsets from. */
class Packer {
  constructor(private readonly structs: ReadonlyMap<string, StructDecl>) {}

  stride(t: ShaderType): number {
    const { size, align } = typeLayout(t, 'std430', this.structs);
    return (Math.ceil(size / align) * align) / 4;
  }

  words(t: ShaderType, v: CpuValue): number {
    if (t.kind === 'array') {
      const n = t.size ?? (v as CpuValue[]).length;
      return n * this.stride(t.elem);
    }
    if (t.kind === 'struct') {
      const decl = this.structs.get(t.name)!;
      const last = decl.fields.at(-1);
      if (last !== undefined && last.type.kind === 'array' && last.type.size === undefined) {
        const off = wgslLayout(decl, 'std430', this.structs).fields.at(-1)!.offset / 4;
        const rec = v as Record<string, CpuValue>;
        return off + this.words(last.type, rec[last.name]!);
      }
    }
    return typeLayout(t, 'std430', this.structs).size / 4;
  }

  pack(t: ShaderType, v: CpuValue, out: Uint32Array, at: number): void {
    switch (t.kind) {
      case 'scalar':
      case 'atomic': {
        const s = t.kind === 'scalar' ? t.scalar : t.elem;
        out[at] = s === 'f32' ? f32Bits(v as number) : (v as number) >>> 0;
        return;
      }
      case 'vec':
        (v as number[]).forEach((x, k) =>
          this.pack({ kind: 'scalar', scalar: t.elem }, x, out, at + k),
        );
        return;
      case 'mat': {
        const cs = this.stride({ kind: 'vec', n: t.rows, elem: 'f32' });
        const flat = v as number[];
        for (let c = 0; c < t.cols; c++) {
          for (let r = 0; r < t.rows; r++) out[at + c * cs + r] = f32Bits(flat[c * t.rows + r]!);
        }
        return;
      }
      case 'struct': {
        const decl = this.structs.get(t.name)!;
        const layout = wgslLayout(decl, 'std430', this.structs);
        const rec = v as Record<string, CpuValue>;
        decl.fields.forEach((f, i) =>
          this.pack(f.type, rec[f.name]!, out, at + layout.fields[i]!.offset / 4),
        );
        return;
      }
      case 'array': {
        const st = this.stride(t.elem);
        (v as CpuValue[]).forEach((x, i) => this.pack(t.elem, x, out, at + i * st));
        return;
      }
      default:
        throw new Error(`gl-model: a ${t.kind} has no storage layout`);
    }
  }

  /** Mark in `out` each word of a value of `t` at `at` that holds an `f32`. */
  floats(t: ShaderType, v: CpuValue, out: Uint8Array, at: number): void {
    switch (t.kind) {
      case 'scalar':
        if (t.scalar === 'f32') out[at] = 1;
        return;
      case 'vec':
        if (t.elem === 'f32') for (let k = 0; k < t.n; k++) out[at + k] = 1;
        return;
      case 'mat': {
        const cs = this.stride({ kind: 'vec', n: t.rows, elem: 'f32' });
        for (let c = 0; c < t.cols; c++) for (let r = 0; r < t.rows; r++) out[at + c * cs + r] = 1;
        return;
      }
      case 'struct': {
        const decl = this.structs.get(t.name)!;
        const layout = wgslLayout(decl, 'std430', this.structs);
        const rec = v as Record<string, CpuValue>;
        decl.fields.forEach((f, i) =>
          this.floats(f.type, rec[f.name]!, out, at + layout.fields[i]!.offset / 4),
        );
        return;
      }
      case 'array': {
        const st = this.stride(t.elem);
        (v as CpuValue[]).forEach((x, i) => this.floats(t.elem, x, out, at + i * st));
        return;
      }
      default:
        return;
    }
  }

  unpack(t: ShaderType, words: Uint32Array, at: number, like: CpuValue): CpuValue {
    switch (t.kind) {
      case 'scalar':
      case 'atomic': {
        const s = t.kind === 'scalar' ? t.scalar : t.elem;
        const b = words[at]!;
        return s === 'f32' ? bitsF32(b) : s === 'i32' ? b | 0 : b;
      }
      case 'vec':
        return Array.from({ length: t.n }, (_, k) =>
          this.unpack({ kind: 'scalar', scalar: t.elem }, words, at + k, 0),
        ) as CpuValue;
      case 'mat': {
        const cs = this.stride({ kind: 'vec', n: t.rows, elem: 'f32' });
        const out: number[] = [];
        for (let c = 0; c < t.cols; c++) {
          for (let r = 0; r < t.rows; r++) out.push(bitsF32(words[at + c * cs + r]!));
        }
        return out;
      }
      case 'struct': {
        const decl = this.structs.get(t.name)!;
        const layout = wgslLayout(decl, 'std430', this.structs);
        const rec = like as Record<string, CpuValue>;
        return Object.fromEntries(
          decl.fields.map((f, i) => [
            f.name,
            this.unpack(f.type, words, at + layout.fields[i]!.offset / 4, rec[f.name]!),
          ]),
        ) as CpuValue;
      }
      case 'array': {
        const st = this.stride(t.elem);
        return (like as CpuValue[]).map((x, i) =>
          this.unpack(t.elem, words, at + i * st, x),
        ) as CpuValue;
      }
      default:
        throw new Error(`gl-model: a ${t.kind} has no storage layout`);
    }
  }
}

interface ModelInvocation extends Scheduled {
  readonly workgroup: number;
  readonly args: CpuValue[];
  readonly gid: Vec3;
}

/** Split `entry` of `m`, rewrite its memory to words, and run it over `workgroups` as the GL
 *  executor will, against `bindings`, which it writes back in place (arrays and objects) or
 *  replaces (a scalar). */
export function runGlModel(
  m: ModuleDecl,
  entry: string,
  workgroups: WorkgroupCount,
  bindings: Record<string, CpuValue>,
  opts?: { readonly precision?: 'f32' | 'f64'; readonly logEntries?: number },
): GlModelReport {
  validate(m);
  let prepared = autoVars(m);
  if (opts?.precision !== 'f64') prepared = froundF32(prepared);
  const decl0 = prepared.funcs.find((f) => f.name === entry);
  if (decl0 === undefined || stageOf(decl0) !== 'compute') {
    throw new Error(`gl-model: "${entry}" is not a @compute entry`);
  }
  const logEntries = opts?.logEntries ?? 4;
  const plan: WordPlan = lowerMemoryWords(splitPhases(prepared, entry, { logEntries }));
  const pm = plan.module;
  const decl = pm.funcs.find((f) => f.name === entry)!;
  const structs = new Map(pm.structs.map((s) => [s.name, s]));
  const packer = new Packer(structs);

  // Memory: a storage root once, a workgroup root once per workgroup.
  const nwg: Vec3 = typeof workgroups === 'number' ? [workgroups, 1, 1] : workgroups;
  const groups = nwg[0] * nwg[1] * nwg[2];
  const memory: Uint32Array[][] = plan.roots.map((r) => {
    if (r.space === 'storage') {
      const v = bindings[r.name];
      if (v === undefined) throw new Error(`gl-model: no value for binding '${r.name}'`);
      const words = new Uint32Array(packer.words(r.type, v));
      packer.pack(r.type, v, words, 0);
      return [words];
    }
    return Array.from({ length: groups }, () => new Uint32Array(r.fixed));
  });
  const lengths: Record<string, number> = {};
  for (const r of plan.roots) {
    if (r.space !== 'storage' || r.stride === 0) continue;
    lengths[`_phx_len_${r.name}`] =
      (memory[plan.roots.indexOf(r)]![0]!.length - r.fixed) / r.stride;
  }
  const mem = (root: number, workgroup: number): Uint32Array => {
    const per = memory[root]!;
    return per.length === 1 ? per[0]! : per[workgroup]!;
  };

  const base = makeCtx(pm, false);
  for (const [k, v] of Object.entries(bindings)) {
    if (!plan.roots.some((r) => r.name === k)) base.bindings[k] = v;
  }
  const privatesOf = (): Record<string, CpuValue> => {
    const out: Record<string, CpuValue> = {};
    for (const v of pm.vars ?? []) {
      if (v.space !== 'private') continue;
      out[v.name] = v.init
        ? drain(evalExpr(v.init, new Map(), base))
        : zeroOf(v.type, base.structs);
    }
    return Object.assign(out, lengths);
  };
  const invocations: ModelInvocation[] = [];
  let w = -1;
  dispatchEach(
    decl,
    workgroups,
    () => w++,
    (args, gid) => {
      invocations.push({
        workgroup: w,
        wid: [w, 0, 0],
        gid,
        args,
        privates: privatesOf(),
        waiting: false,
      });
    },
  );
  const perGroup = invocations.length / groups;
  const shape: Vec3 = [perGroup, 1, 1];

  let maxLogWords = 0;
  const ctxOf = (inv: ModelInvocation, log?: [number, number, number][]): StepCtx => ({
    ...base,
    privates: inv.privates,
    words: {
      load: (root, word) => {
        if (log !== undefined) {
          for (let i = log.length - 1; i >= 0; i--) {
            const e = log[i]!;
            if (e[0] === root && e[1] === word) return e[2];
          }
        }
        return mem(root, inv.workgroup)[word]!;
      },
      store: (root, word, bits) => {
        if (log === undefined) throw new Error('gl-model: a store outside a pass');
        log.push([root, word, bits >>> 0]);
      },
    },
    frames: [],
    stubbed: new Set<string>(),
    stubHits: 0,
  });
  const logs = new Map<ModelInvocation, [number, number, number][]>();
  const { passes, barrierPhases } = schedulePasses(plan, invocations, shape, {
    pass(runnable) {
      for (const inv of runnable) {
        const log: [number, number, number][] = [];
        drain(runFunction(decl, inv.args, undefined, ctxOf(inv, log)));
        if (log.length > logEntries * 4) {
          throw new Error(`gl-model: one pass wrote ${log.length} words, more than the log holds`);
        }
        maxLogWords = Math.max(maxLogWords, log.length);
        logs.set(inv, log);
      }
      for (const inv of runnable) {
        for (const [root, word, bits] of logs.get(inv) ?? []) mem(root, inv.workgroup)[word] = bits;
      }
      logs.clear();
    },
    resolve(inv, _cut, pc) {
      const req = plan.requests.get(pc)!;
      const ctx = ctxOf(inv);
      const word = drain(evalExpr(req.word, new Map(), ctx)) as number;
      const ops = req.operands.map((o) => drain(evalExpr(o, new Map(), ctx)) as number);
      const cell = mem(req.root, inv.workgroup);
      const old = req.elem === 'i32' ? cell[word]! | 0 : cell[word]!;
      const step = atomicStep(req.fn, old, ops[0] ?? 0, req.elem, ops[1]);
      if (req.fn !== 'atomicLoad') cell[word] = step.next >>> 0;
      if (req.result !== undefined) inv.privates[req.result] = step.result;
    },
  });

  for (const r of plan.roots) {
    if (r.space !== 'storage') continue;
    const v = packer.unpack(r.type, mem(plan.roots.indexOf(r), 0), 0, bindings[r.name]!);
    if (Array.isArray(bindings[r.name])) {
      (bindings[r.name] as CpuValue[]).splice(0, (v as CpuValue[]).length, ...(v as CpuValue[]));
    } else bindings[r.name] = v;
  }
  return { passes, barrierPhases, maxLogWords };
}

/** The std430 words of each storage binding of `m` in `bindings`, as the GL executor takes
 *  them. */
export function storageWords(
  m: ModuleDecl,
  bindings: Record<string, CpuValue>,
): Record<string, Uint32Array> {
  const packer = new Packer(new Map(m.structs.map((s) => [s.name, s])));
  const out: Record<string, Uint32Array> = {};
  for (const b of m.bindings) {
    if (b.space !== 'storage') continue;
    const v = bindings[b.name]!;
    const words = new Uint32Array(packer.words(b.type, v));
    packer.pack(b.type, v, words, 0);
    out[b.name] = words;
  }
  return out;
}

/** For each storage binding of `m` in `bindings`, which of its words hold an `f32`. */
export function storageFloats(
  m: ModuleDecl,
  bindings: Record<string, CpuValue>,
): Record<string, Uint8Array> {
  const packer = new Packer(new Map(m.structs.map((s) => [s.name, s])));
  const out: Record<string, Uint8Array> = {};
  for (const b of m.bindings) {
    if (b.space !== 'storage') continue;
    const v = bindings[b.name]!;
    const mask = new Uint8Array(packer.words(b.type, v));
    packer.floats(b.type, v, mask, 0);
    out[b.name] = mask;
  }
  return out;
}
