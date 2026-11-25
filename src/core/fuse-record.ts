// Implements: Rule 11.13 (docs/language-design.md; traced in reqs/).

import type { FuseScope } from './fuse-plan.js';
export type { FuseScope } from './fuse-plan.js';
import type { FuseReport } from './fuse-report.js';
export type { FuseReport } from './fuse-report.js';
import { fuseSlot, type FuseRecorder } from './fuse-scope.js';
import {
  describe,
  forgetBuffer,
  isBuffer,
  isGuard,
  residentable,
  type ComputeEntry,
  type EntryBinding,
  type GeneratedCpu,
  type GpuBuffer,
  type GpuDevice,
  type Layout,
} from './host-entry.js';
import type {
  entryInputs,
  checkEntryCall,
  entryTierFit,
  indirectOf,
  residentsOf,
  runEntry,
} from './host-compute.js';
import type { IncomingReads } from './host-failure.js';
import { arityError, heldArgument } from './host-arity.js';
import type { KernelFace } from './host-kernel.js';
import { defaultOwner, foreignOwner, type CallOwner } from './owner.js';
import {
  adopt,
  decide,
  kernelQueue,
  layoutKind,
  residentState,
  tentatively,
  ZEROED_ELEMENTS,
  ZeroedState,
  type ResidentArrayState,
  type ZeroedElement,
} from './resident.js';

let executor: Promise<typeof import('./fuse-plan.js')> | undefined;
const loadExecutor = () => (executor ??= import('./fuse-plan.js'));

export interface PlanCall {
  readonly name: string;
  readonly loops: readonly string[];
  readonly reads: readonly number[];
  readonly writes: readonly number[];
  readonly indirect?: true;
}

export interface PlanDependency {
  readonly from: number;
  readonly to: number;
  readonly resident: number;
  readonly kind: 'read-after-write' | 'write-after-write';
}

export interface PlanGroup {
  readonly calls: readonly number[];
  readonly fused: boolean;
  readonly why?: string;
  readonly workgroupShapes?: readonly (readonly [number, number, number])[];
}

export interface Plan {
  readonly calls: readonly PlanCall[];
  readonly residents: readonly ResidentArrayState[];
  readonly dependencies: readonly PlanDependency[];
  readonly groups: readonly PlanGroup[];
  readonly barriers: readonly number[];
}

interface EntryHost {
  readonly entryInputs: typeof entryInputs;
  readonly residentsOf: typeof residentsOf;
  readonly indirectOf: typeof indirectOf;
  readonly checkEntryCall: typeof checkEntryCall;
  readonly entryTierFit: typeof entryTierFit;
  readonly runEntry: typeof runEntry;
}

export type PlanInput =
  | { readonly k: KernelFace; readonly args: readonly unknown[] }
  | {
      readonly e: ComputeEntry;
      readonly states: ReadonlyMap<EntryBinding, ResidentArrayState>;
      readonly indirect?: ResidentArrayState | undefined;
    };

function accessesOf(c: PlanInput): { readonly s: ResidentArrayState; readonly writes: boolean }[] {
  if ('e' in c) {
    const found = [...c.states].map(([b, s]) => ({ s, writes: b.writes === true }));
    if (c.indirect !== undefined && !found.some((a) => a.s === c.indirect))
      found.push({ s: c.indirect, writes: false });
    return found;
  }
  return c.k.params.flatMap((p, i) => {
    if (p.k !== 'array') return [];
    const held = heldArgument(c.args[i]);
    const s = residentState(held?.array ?? c.args[i]);
    const word = held === undefined ? undefined : residentState(held.length);
    return [
      ...(s === undefined ? [] : [{ s, writes: p.writes }]),
      ...(word === undefined ? [] : [{ s: word, writes: true }]),
    ];
  });
}

export function buildPlan(calls: readonly PlanInput[]): Plan {
  const residents: ResidentArrayState[] = [];
  const at = (s: ResidentArrayState): number => {
    const i = residents.indexOf(s);
    return i >= 0 ? i : residents.push(s) - 1;
  };
  const planned: PlanCall[] = calls.map((c) => {
    const reads: number[] = [];
    const writes: number[] = [];
    for (const { s, writes: w } of accessesOf(c)) (w ? writes : reads).push(at(s));
    if (!('e' in c))
      return { name: c.k.name, loops: c.k.gpu?.loops.map((l) => l.entry) ?? [], reads, writes };
    return {
      name: c.e.name,
      loops: [c.e.fn],
      reads,
      writes,
      ...(c.indirect !== undefined ? { indirect: true as const } : {}),
    };
  });
  const lastWriter = new Map<number, number>();
  const dependencies: PlanDependency[] = [];
  planned.forEach((c, to) => {
    for (const [kind, residentsOf] of [
      ['read-after-write', c.reads],
      ['write-after-write', c.writes],
    ] as const)
      for (const resident of residentsOf) {
        const from = lastWriter.get(resident);
        if (from !== undefined) dependencies.push({ from, to, resident, kind });
      }
    for (const resident of c.writes) lastWriter.set(resident, to);
  });
  const groups: PlanGroup[] = planned.map((_, i) => ({ calls: [i], fused: false }));
  const barriers = groups.slice(1).map((g) => g.calls[0]!);
  return { calls: planned, residents, dependencies, groups, barriers };
}

type ScratchElement = ZeroedElement | 'vec4f';

const MOST_ELEMENTS = 0xffffffff;

export class ScratchState extends ZeroedState {
  phase: 'open' | 'running' | 'done' = 'open';

  readonly spelled: ScratchElement;

  readonly webgpuScratch = { allocations: 0, allocatedBytes: 0, reuses: 0, reusedBytes: 0 };

  constructor(
    length: number,
    element: ScratchElement,
    readonly owner: Scope,
  ) {
    super(element === 'vec4f' ? 4 * length : length, element === 'vec4f' ? 'f32' : element);
    this.spelled = element;
  }

  override outside(subject: string): TypeError {
    return new TypeError(
      this.phase === 'done'
        ? `${subject} is a scratch array of a fuse() scope whose plan has run. A scratch array lives only until its plan has run.`
        : `${subject} is a scratch array. Only the kernel calls in the body of the fuse() scope that made it may take it.`,
    );
  }

  #use(subject: string): void {
    if (this.phase !== 'running') throw this.outside(subject);
  }

  override measure(
    call: string,
    param: {
      readonly name: string;
      readonly layout: Layout & { readonly k: 'a' };
      readonly s: string;
    },
  ): number {
    const at = `${call}(): parameter "${param.name}"`;
    this.#use(at);
    if (this.length === 0)
      throw new TypeError(`${at} (${param.s}): got an empty array, which WebGPU cannot bind.`);
    const e = param.layout.e;
    if (this.spelled === 'vec4f') {
      if (e.k !== 'v' || e.n !== 4 || e.t !== 'f32')
        throw new TypeError(
          `${at} (${param.s}): got a scratch array of vec4f, which only an array<vec4f> takes.`,
        );
      return this.length / 4;
    }
    if (e.k !== 's' || e.t !== this.element)
      throw new TypeError(
        `${at} (${param.s}): got a scratch array of ${this.element} numbers, which only an array<${this.element}> takes.`,
      );
    return this.length;
  }

  override async sync(): Promise<boolean> {
    this.#use('This array');
    return super.sync();
  }

  override bufferFor(
    d: GpuDevice,
    layout: Layout,
    bytes: () => ArrayBuffer,
    writes: boolean,
  ): GpuBuffer {
    this.#use('This array');
    const unbound = this.gpu === undefined;
    if (unbound) this.ownedBy?.scratchBuffer?.(this, d, layout);
    const borrowed = this.gpu;
    if (unbound && borrowed !== undefined) {
      this.webgpuScratch.reuses++;
      this.webgpuScratch.reusedBytes += borrowed.size;
    }
    const before = this.gpu?.buffer;
    const buffer = super.bufferFor(d, layout, bytes, writes);
    if (buffer !== before) {
      this.webgpuScratch.allocations++;
      this.webgpuScratch.allocatedBytes += this.gpu!.size;
    }
    return buffer;
  }

  release(): void {
    if (this.phase === 'done') return;
    this.phase = 'done';
    if (this.ownedBy?.releaseScratch?.(this) !== true) {
      if (this.gpu !== undefined) forgetBuffer(this.gpu.d, this.gpu.buffer);
      this.gpu?.buffer.destroy();
    }
    this.gpu = undefined;
    this.host = undefined;
  }
}

const handleOf = (length: number): object => {
  const refuse = (what: string): never => {
    throw new TypeError(
      `${what}: this is a scratch array, which the host never reads or writes. Make it with array() to use it after the scope.`,
    );
  };
  const handle = {
    length,
    read: () =>
      Promise.reject(
        new TypeError(
          'read(): this is a scratch array, which the host never reads. Make it with array() to read it after the scope.',
        ),
      ),
    set: () => refuse('set()'),
    resize: () => refuse('resize()'),
    at: () => refuse('at()'),
    get needsUpdate(): boolean {
      return refuse('needsUpdate');
    },
    set needsUpdate(_: boolean) {
      refuse('needsUpdate');
    },
    dispose: () => undefined,
  };
  const key = (Symbol as { readonly dispose?: symbol }).dispose;
  if (typeof key === 'symbol') Object.defineProperty(handle, key, { value: () => undefined });
  return handle;
};

export interface RecordedKernel {
  readonly kind: 'kernel';
  readonly cpu: GeneratedCpu;
  readonly k: KernelFace;
  readonly argc: number;
  readonly args: readonly unknown[];
  readonly incoming?: IncomingReads;
  readonly promise: Promise<unknown>;
  readonly settle: { resolve(value: unknown): void; reject(error: unknown): void };
}

export interface RecordedEntry {
  readonly kind: 'entry';
  readonly cpu: GeneratedCpu;
  readonly e: ComputeEntry;
  readonly argc: number;
  readonly bindings: unknown;
  readonly workgroups: unknown;
  readonly incoming?: IncomingReads;
  readonly states: ReadonlyMap<EntryBinding, ResidentArrayState>;
  readonly indirect: ResidentArrayState | undefined;
  readonly host: EntryHost;
  readonly promise: Promise<void>;
  readonly settle: { resolve(value: void): void; reject(error: unknown): void };
}

export type RecordedCall = RecordedKernel | RecordedEntry;

export function kernelOf(c: RecordedCall): RecordedKernel {
  if (c.kind !== 'kernel') throw new Error('fuse(): an entry call forms a group of its own (F8).');
  return c;
}

export const nameOf = (c: RecordedCall): string => (c.kind === 'kernel' ? c.k.name : c.e.name);

export function writtenBy(c: RecordedCall): ResidentArrayState[] {
  return accessesOf(c)
    .filter((a) => a.writes)
    .map((a) => a.s);
}

const isThenable = (v: unknown): boolean =>
  typeof v === 'object' && v !== null && typeof (v as { then?: unknown }).then === 'function';

const ASYNC_BODY =
  'fuse(): the body is synchronous, and this one is not. A call made after an await runs outside the scope. Remove async, and await the promise that fuse() returns.';

function checkBody(body: unknown): void {
  if (typeof body !== 'function')
    throw new TypeError(
      `fuse(): takes the body of the scope as a function; got ${describe(body)}.`,
    );
  if (Object.prototype.toString.call(body) === '[object AsyncFunction]')
    throw new TypeError(ASYNC_BODY);
}

class Scope implements FuseRecorder {
  readonly owner: CallOwner;
  readonly #calls: RecordedCall[] = [];
  readonly #scratch: ScratchState[] = [];
  #failure: { readonly error: unknown } | undefined;
  #plan: Plan | undefined;
  #settle!: { resolve(report: FuseReport): void; reject(error: unknown): void };
  readonly view: FuseScope;
  readonly done: Promise<FuseReport>;

  constructor(owner: CallOwner) {
    this.owner = owner;
    const calls = this.#calls;
    this.view = Object.freeze({
      get recorded(): number {
        return calls.length;
      },
      scratch: (length: number, element: ScratchElement = 'f32') =>
        this.#scratchOf(length, element),
    }) as FuseScope;
    this.done = new Promise<FuseReport>((resolve, reject) => {
      this.#settle = { resolve, reject };
    });
    this.done.catch(() => undefined);
  }

  kernel(
    cpu: GeneratedCpu,
    k: KernelFace,
    argc: number,
    args: readonly unknown[],
    incoming?: IncomingReads,
    site?: string,
  ): Promise<unknown> {
    const bad = arityError(k, argc);
    if (bad !== undefined) throw bad;
    tentatively(() => this.#takes(k, args, site));
    let settle!: RecordedCall['settle'];
    const promise = new Promise<unknown>((resolve, reject) => {
      settle = { resolve, reject };
    });
    promise.catch(() => undefined);
    this.#calls.push({ kind: 'kernel', cpu, k, argc, args, incoming, promise, settle });
    return promise;
  }

  #takes(k: KernelFace, args: readonly unknown[], site: string | undefined): void {
    for (const [i, p] of k.params.entries()) {
      const held = p.k === 'array' ? heldArgument(args[i]) : undefined;
      const value = held?.array ?? args[i];
      if (p.k === 'array') {
        decide(
          residentState(value),
          layoutKind(p.layout),
          `${k.name}(): parameter "${p.name}"`,
          site,
        );
        if (held !== undefined)
          decide(residentState(held.length), 'u32', `${k.name}(): "${p.name}.length"`, site);
      }
      if (p.k === 'array' && p.writes && residentState(value) === undefined)
        throw new TypeError(
          `${k.name}(): parameter "${p.name}" is ${describe(value)}, and a call inside fuse() writes only a Buffer. fuse() reads nothing back. Pass array(...), or call ${k.name}() outside fuse().`,
        );
      const s = residentState(value);
      if (s instanceof ScratchState && s.owner !== this)
        throw s.outside(`${k.name}(): parameter "${p.name}"`);
      if (p.k === 'array') {
        const foreign = foreignOwner(`${k.name}(): parameter "${p.name}"`, this.owner, s);
        if (foreign !== undefined) throw foreign;
      }
      if (held !== undefined) {
        const foreign = foreignOwner(
          `${k.name}(): "${p.name}.length"`,
          this.owner,
          residentState(held.length),
        );
        if (foreign !== undefined) throw foreign;
      }
    }
  }

  entry(
    cpu: GeneratedCpu,
    e: ComputeEntry,
    argc: number,
    bindings: unknown,
    workgroups: unknown,
    lent: unknown,
    incoming?: IncomingReads,
    site?: string,
  ): Promise<void> {
    const host = lent as EntryHost;
    const states = host.residentsOf(e, argc, bindings);
    const indirect = host.indirectOf(e, workgroups);
    for (const [at, s] of [
      ...[...states].map(([b, s]) => [`binding "${b.name}"`, s] as const),
      ['"workgroups.indirect"', indirect] as const,
    ]) {
      const foreign = foreignOwner(`${e.name}(): ${at}`, this.owner, s);
      if (foreign !== undefined) throw foreign;
    }
    if (typeof bindings === 'object' && bindings !== null && !Array.isArray(bindings))
      for (const b of e.bindings) {
        if (!isBuffer(b) || isGuard(b) || !Object.hasOwn(bindings, b.name)) continue;
        const value = (bindings as Record<string, unknown>)[b.name];
        if (states.has(b)) continue;
        if (residentable(b))
          throw new TypeError(
            `${e.name}(): binding "${b.name}" is ${describe(value)}, and a call inside fuse() takes a storage array with no size only as a Buffer. Pass array(...), or call ${e.name}() outside fuse().`,
          );
        if (b.writes)
          throw new TypeError(
            `${e.name}(): binding "${b.name}" is ${describe(value)}, and a call inside fuse() writes only a Buffer. fuse() reads nothing back. Pass array(...), or call ${e.name}() outside fuse().`,
          );
      }
    tentatively(() => {
      for (const [b, st] of states)
        decide(st, layoutKind(b.layout), `${e.name}(): binding "${b.name}"`, site);
      decide(indirect, 'u32', `${e.name}(): "workgroups.indirect"`, site);
    });
    let settle!: RecordedEntry['settle'];
    const promise = new Promise<void>((resolve, reject) => {
      settle = { resolve, reject };
    });
    promise.catch(() => undefined);
    this.#calls.push({
      kind: 'entry',
      cpu,
      e,
      argc,
      bindings,
      workgroups,
      incoming,
      states,
      indirect,
      host,
      promise,
      settle,
    });
    return promise;
  }

  refuse(call: string, what: string): never {
    throw new TypeError(
      `${call}: ${what} cannot run inside fuse(), which records kernel calls only. Call it outside fuse().`,
    );
  }

  #scratchOf(length: unknown, element: unknown): object {
    if (fuseSlot.active !== this)
      throw new TypeError(
        'scratch(): the body of this fuse() scope has returned. Make a scratch array while the body runs, and use it there.',
      );
    if (
      typeof length !== 'number' ||
      !Number.isInteger(length) ||
      length < 0 ||
      length > MOST_ELEMENTS
    )
      throw new TypeError(
        `scratch(): takes a length that is a whole number from 0 to ${MOST_ELEMENTS}; got ${describe(length)}.`,
      );
    if (
      typeof element !== 'string' ||
      !(Object.hasOwn(ZEROED_ELEMENTS, element) || element === 'vec4f')
    )
      throw new TypeError(
        `scratch(): the element is 'f32', 'i32', 'u32' or 'vec4f'; got ${describe(element)}.`,
      );
    const state = new ScratchState(length, element as ScratchElement, this);
    if (element === 'vec4f') state.components = 4;
    state.ownedBy = this.owner;
    this.#scratch.push(state);
    const handle = handleOf(length);
    adopt(handle, state);
    return handle;
  }

  join(body: (scope: FuseScope) => void): Promise<FuseReport> {
    checkBody(body);
    this.#accept(body(this.view));
    return this.done;
  }

  #accept(result: unknown): void {
    if (!isThenable(result)) return;
    if (result === this.done || this.#calls.some((c) => c.promise === result)) return;
    Promise.resolve(result).catch(() => undefined);
    throw new TypeError(ASYNC_BODY);
  }

  run(body: (scope: FuseScope) => void): void {
    fuseSlot.active = this;
    try {
      this.#accept(body(this.view));
      this.#plan = buildPlan(this.#calls);
      for (const c of this.#calls) for (const st of writtenBy(c)) st.markWritten();
    } catch (error) {
      this.#failure = { error };
    } finally {
      fuseSlot.active = undefined;
    }
    const failure = this.#failure;
    if (failure !== undefined) {
      for (const c of this.#calls) c.settle.reject(failure.error);
      for (const s of this.#scratch) s.release();
      this.#settle.reject(failure.error);
      return;
    }
    void kernelQueue
      .run(async () => {
        let executor: Awaited<ReturnType<typeof loadExecutor>>;
        try {
          executor = await loadExecutor();
        } catch (error) {
          for (const c of this.#calls) {
            for (const s of writtenBy(c)) {
              s.error = error;
              s.ahead = false;
            }
            c.settle.reject(error);
          }
          for (const s of this.#scratch) s.release();
          throw error;
        }
        return executor.runPlan(this.#calls, this.#plan!, this.#scratch, this.owner);
      })
      .then(this.#settle.resolve, this.#settle.reject);
  }
}

export function runScope(
  body: (scope: FuseScope) => void,
  owner: CallOwner = defaultOwner,
): Promise<FuseReport> {
  const outer = fuseSlot.active;
  if (outer instanceof Scope) return outer.join(body);
  try {
    checkBody(body);
  } catch (error) {
    return Promise.reject(error);
  }
  const scope = new Scope(owner);
  scope.run(body);
  return scope.done;
}
