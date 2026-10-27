// Implements: Rule 11.13 (docs/language-design.md; traced in reqs/).
// Record a fuse body synchronously and reserve its queue position before loading the executor (0085).

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
import type { checkEntryCall, indirectOf, residentsOf, runEntry } from './host-compute.js';
import { arityError, heldArgument } from './host-arity.js';
import type { KernelFace } from './host-kernel.js';
import { defaultOwner, foreignOwner, type CallOwner } from './owner.js';
import {
  adopt,
  kernelQueue,
  residentState,
  ZEROED_ELEMENTS,
  ZeroedState,
  type ResidentArrayState,
  type ZeroedElement,
} from './resident.js';

// One fixed package-owned module. The queue reservation precedes this asynchronous load.
let executor: Promise<typeof import('./fuse-plan.js')> | undefined;
const loadExecutor = () => (executor ??= import('./fuse-plan.js'));

// ─── the public types ────────────────────────────────────────────────────────────────────────

// ─── the plan record ─────────────────────────────────────────────────────────────────────────

/** One recorded call in the plan. The numbers in `reads` and `writes` index {@link Plan.residents}. */
export interface PlanCall {
  /** The kernel function: the operation. */
  readonly name: string;
  /** The entry of each loop it dispatches on WebGPU; none for a function that runs on the CPU. */
  readonly loops: readonly string[];
  /** The `Resident`s it reads without writing. */
  readonly reads: readonly number[];
  /** The `Resident`s it writes. */
  readonly writes: readonly number[];
  /** An entry call whose workgroup count a `Resident` holds (change 0075): that array is among
   *  its `reads`. */
  readonly indirect?: true;
}

/** A call that must run after another, because it reaches a `Resident` that the other wrote. */
export interface PlanDependency {
  /** The call that wrote the `Resident`: the last one to, before `to`. */
  readonly from: number;
  readonly to: number;
  /** The index of the `Resident` in {@link Plan.residents}. */
  readonly resident: number;
  readonly kind: 'read-after-write' | 'write-after-write';
}

/** Calls that run as one unit: more than one is one dispatch. */
export interface PlanGroup {
  /** The calls, as indices into {@link Plan.calls}, in the order they were made. */
  readonly calls: readonly number[];
  readonly fused: boolean;
  /** Why the group stands apart from the one before it, in the author's words. */
  readonly why?: string;
  /** The workgroup of each dispatch of the group on WebGPU, as `[n, 1, 1]`, in dispatch order;
   *  absent off WebGPU. */
  readonly workgroupShapes?: readonly (readonly [number, number, number])[];
}

/** The record of a scope's recorded calls: operation identity, whole-`Resident` accesses, true
 *  dependencies and barriers, with no function body in it. */
export interface Plan {
  readonly calls: readonly PlanCall[];
  /** The distinct `Resident`s the calls reach, in the order the calls first reach them. */
  readonly residents: readonly ResidentArrayState[];
  readonly dependencies: readonly PlanDependency[];
  readonly groups: readonly PlanGroup[];
  /** The calls a barrier stands before: the first call of every group but the first. */
  readonly barriers: readonly number[];
}

/** What the call layer lends the plan for an entry call (`entryHost` in `core/host-compute.ts`).
 *  Imported as types only: the planner holds none of the tiers an entry runs on. */
interface EntryHost {
  readonly residentsOf: typeof residentsOf;
  readonly indirectOf: typeof indirectOf;
  readonly checkEntryCall: typeof checkEntryCall;
  readonly runEntry: typeof runEntry;
}

/** A call as the plan reads it: a kernel call with its arguments, or an entry call with the
 *  `Resident` each of its bindings stands for (Rule 8.24, change 0069), and the one that holds its
 *  workgroup count, if any (change 0075). */
export type PlanInput =
  | { readonly k: KernelFace; readonly args: readonly unknown[] }
  | {
      readonly e: ComputeEntry;
      readonly states: ReadonlyMap<EntryBinding, ResidentArrayState>;
      readonly indirect?: ResidentArrayState | undefined;
    };

/** The `Resident`s a call reaches, and whether it writes each one. The array of an entry call's
 *  indirect count is a read of the call (change 0075). A held length (change 0094) is a read and
 *  a write of the call, which reads the length and leaves the new one: so the call runs after the
 *  last call before it that wrote the word, and a later call that reads the word runs after it. */
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

/**
 * Build the plan of calls in the order they were made. Every call is a group of its own here, with
 * a barrier before each call after the first: the groups the planner settles when the calls have
 * been checked and the device is known replace them (`core/fuse-group.ts`), since they depend on
 * each call's range and on the tier it runs on, which a body that has not run cannot know.
 */
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
  // A call depends on the last call before it that wrote a `Resident` it reaches.
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

// ─── scratch arrays ──────────────────────────────────────────────────────────────────────────

/** The element of a scratch array: the element of a zeroed array (surface §65), or `'vec4f'`,
 *  a vector of four `f32` (change 0068). */
type ScratchElement = ZeroedElement | 'vec4f';

/** The most elements a scratch array holds: a kernel indexes an array with a `u32`. */
const MOST_ELEMENTS = 0xffffffff;

/**
 * The state of a scratch array: a {@link ResidentArrayState} that holds no elements until a call
 * needs them, and that only the plan of the scope that made it may use. A call is checked by its
 * length (`measure`) and not by a host copy. The first call that runs on WebGPU gets a zeroed
 * device buffer, which a new buffer is, and the first that runs on the host gets a zeroed host
 * array (`sync`), so a group that holds the array as a local makes neither. `release` frees both.
 */
export class ScratchState extends ZeroedState {
  /** Where the array is in its life. A call may take it only while the plan of its scope runs. */
  phase: 'open' | 'running' | 'done' = 'open';

  /** The element as the author spelled it. A `'vec4f'` array holds four numbers per element, so
   *  its zeroed state holds `4 × length` numbers of `f32` (change 0068). */
  readonly spelled: ScratchElement;

  constructor(
    length: number,
    element: ScratchElement,
    readonly owner: Scope,
  ) {
    super(element === 'vec4f' ? 4 * length : length, element === 'vec4f' ? 'f32' : element);
    this.spelled = element;
  }

  /** The refusal of a use of the array that the plan of its scope does not make: a kernel call
   *  while the plan is not running, or an entry call or a draw, which never takes it. `subject`
   *  is what uses it, as a sentence starts. */
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

  // A call that runs on the host needs the elements: zeros, or what the device holds (`ZeroedState`).
  override async sync(): Promise<boolean> {
    this.#use('This array');
    return super.sync();
  }

  // With no host copy yet, the buffer is the array: a new one, which holds zeros (`ZeroedState`).
  override bufferFor(
    d: GpuDevice,
    layout: Layout,
    bytes: () => ArrayBuffer,
    writes: boolean,
  ): GpuBuffer {
    this.#use('This array');
    return super.bufferFor(d, layout, bytes, writes);
  }

  /** The plan has run, or will not: free the device buffer and the host array, and refuse every
   *  use after. */
  release(): void {
    this.phase = 'done';
    if (this.gpu !== undefined) forgetBuffer(this.gpu.d, this.gpu.buffer);
    this.gpu?.buffer.destroy();
    this.gpu = undefined;
    this.host = undefined;
  }
}

/** The handle of a scratch array: `read()` and `write()` are refused, and `destroy()` does
 *  nothing. The plan owns the array and frees it when it has run, so the host has nothing to
 *  release, and a host that destroys every handle it holds stays correct. */
const handleOf = (): object => ({
  read: () =>
    Promise.reject(
      new TypeError(
        'read(): this is a scratch array, which the host never reads. Make it with resident() to read it after the scope.',
      ),
    ),
  write: () => {
    throw new TypeError(
      'write(): this is a scratch array, which the host never writes. Make it with resident() to write it.',
    );
  },
  destroy: () => undefined,
});

// ─── recording ───────────────────────────────────────────────────────────────────────────────

/** A kernel call the body made, which the plan runs. */
export interface RecordedKernel {
  readonly kind: 'kernel';
  readonly cpu: GeneratedCpu;
  readonly k: KernelFace;
  readonly argc: number;
  readonly args: readonly unknown[];
  /** The promise the call returned to the body. */
  readonly promise: Promise<unknown>;
  readonly settle: { resolve(value: unknown): void; reject(error: unknown): void };
}

/** An entry call the body made, which the plan runs as a group of its own (Rule 8.24, change
 *  0069). Its arguments are checked when the plan runs, as a kernel call's are. */
export interface RecordedEntry {
  readonly kind: 'entry';
  readonly cpu: GeneratedCpu;
  readonly e: ComputeEntry;
  readonly argc: number;
  readonly bindings: unknown;
  readonly workgroups: unknown;
  /** The `Resident` each binding stands for, checked when the call was recorded. */
  readonly states: ReadonlyMap<EntryBinding, ResidentArrayState>;
  /** The `Resident` that holds the workgroup count of the call, if any (change 0075). */
  readonly indirect: ResidentArrayState | undefined;
  /** What checks and runs the call. */
  readonly host: EntryHost;
  readonly promise: Promise<void>;
  readonly settle: { resolve(value: void): void; reject(error: unknown): void };
}

/** A call the body made, which the plan runs. */
export type RecordedCall = RecordedKernel | RecordedEntry;

/** The kernel call at `c`; a fused group holds kernel calls only (F8). */
export function kernelOf(c: RecordedCall): RecordedKernel {
  if (c.kind !== 'kernel') throw new Error('fuse(): an entry call forms a group of its own (F8).');
  return c;
}

/** The name of a recorded call, as the report and the planner name it. */
export const nameOf = (c: RecordedCall): string => (c.kind === 'kernel' ? c.k.name : c.e.name);

/** The `Resident`s a call writes, which keep the error of a plan that fails. */
export function writtenBy(c: RecordedCall): ResidentArrayState[] {
  return accessesOf(c)
    .filter((a) => a.writes)
    .map((a) => a.s);
}

const isThenable = (v: unknown): boolean =>
  typeof v === 'object' && v !== null && typeof (v as { then?: unknown }).then === 'function';

const ASYNC_BODY =
  'fuse(): the body is synchronous, and this one is not. A call made after an await runs outside the scope. Remove async, and await the promise that fuse() returns.';

/** Refuse a body that is not a synchronous function. */
function checkBody(body: unknown): void {
  if (typeof body !== 'function')
    throw new TypeError(
      `fuse(): takes the body of the scope as a function; got ${describe(body)}.`,
    );
  if (Object.prototype.toString.call(body) === '[object AsyncFunction]')
    throw new TypeError(ASYNC_BODY);
}

/** The scope that is open while a body runs: it records the kernel calls, and then it runs them. */
class Scope implements FuseRecorder {
  /** Whose device the plan runs on, and whose arrays the calls may take (change 0071). */
  readonly owner: CallOwner;
  readonly #calls: RecordedCall[] = [];
  /** The scratch arrays the body made, which the plan frees when it has run. */
  readonly #scratch: ScratchState[] = [];
  #failure: { readonly error: unknown } | undefined;
  #plan: Plan | undefined;
  #settle!: { resolve(report: FuseReport): void; reject(error: unknown): void };
  /** What the body is given. */
  readonly view: FuseScope;
  /** The scope's report once its plan has run: what `fuse` returns, and a nested `fuse` too. */
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
    // A scope nobody awaits keeps its error on what it writes, for `read()` to throw.
    this.done.catch(() => undefined);
  }

  kernel(
    cpu: GeneratedCpu,
    k: KernelFace,
    argc: number,
    args: readonly unknown[],
  ): Promise<unknown> {
    const bad = arityError(k, argc);
    if (bad !== undefined) throw bad;
    for (const [i, p] of k.params.entries()) {
      // A held length (change 0094): its array is what the call writes, and its length a
      // Resident of the scope's owner, which the plan's check of the call holds to the rest.
      const held = p.k === 'array' ? heldArgument(args[i]) : undefined;
      const value = held?.array ?? args[i];
      if (p.k === 'array' && p.writes && residentState(value) === undefined)
        throw new TypeError(
          `${k.name}(): parameter "${p.name}" is ${describe(value)}, and a call inside fuse() writes only a Resident. fuse() reads nothing back. Pass resident(...), or call ${k.name}() outside fuse().`,
        );
      // A scratch array belongs to the scope that made it.
      const s = residentState(value);
      if (s instanceof ScratchState && s.owner !== this)
        throw s.outside(`${k.name}(): parameter "${p.name}"`);
      // A Resident belongs to one owner: the scope takes its owner's arrays only (change 0071).
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
    let settle!: RecordedCall['settle'];
    const promise = new Promise<unknown>((resolve, reject) => {
      settle = { resolve, reject };
    });
    // A call nobody awaits keeps its error on what it writes, for `read()` to throw.
    promise.catch(() => undefined);
    this.#calls.push({ kind: 'kernel', cpu, k, argc, args, promise, settle });
    return promise;
  }

  entry(
    cpu: GeneratedCpu,
    e: ComputeEntry,
    argc: number,
    bindings: unknown,
    workgroups: unknown,
    lent: unknown,
  ): Promise<void> {
    const host = lent as EntryHost;
    // The refusals that need no value: the arguments, a `Resident` for a binding it may not
    // stand for, a scratch array, and one `Resident` twice (`residentsOf`).
    const states = host.residentsOf(e, argc, bindings);
    // The array of an indirect count, which no scratch array is (change 0075).
    const indirect = host.indirectOf(e, workgroups);
    // A Resident belongs to one owner: the scope takes its owner's arrays only (change 0071).
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
        // A storage array with no size is a `Resident` in the body, as a kernel call's written
        // array is: a host array is read by no plan, and written by none.
        if (residentable(b))
          throw new TypeError(
            `${e.name}(): binding "${b.name}" is ${describe(value)}, and a call inside fuse() takes a storage array with no size only as a Resident. Pass resident(...), or call ${e.name}() outside fuse().`,
          );
        // A host value the call writes: fuse() reads nothing back, so none is written.
        if (b.writes)
          throw new TypeError(
            `${e.name}(): binding "${b.name}" is ${describe(value)}, and a call inside fuse() writes only a Resident. fuse() reads nothing back. Pass resident(...), or call ${e.name}() outside fuse().`,
          );
      }
    let settle!: RecordedEntry['settle'];
    const promise = new Promise<void>((resolve, reject) => {
      settle = { resolve, reject };
    });
    // A call nobody awaits keeps its error on what it writes, for `read()` to throw.
    promise.catch(() => undefined);
    this.#calls.push({
      kind: 'entry',
      cpu,
      e,
      argc,
      bindings,
      workgroups,
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

  /** Make a scratch array of this scope, while its body runs. */
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
    // A scratch array is the scope's owner's: a call of the scope takes it (change 0071).
    state.ownedBy = this.owner;
    this.#scratch.push(state);
    const handle = handleOf();
    adopt(handle, state);
    return handle;
  }

  /** Run the body of a `fuse` call made inside the body of this scope: it joins the scope. */
  join(body: (scope: FuseScope) => void): Promise<FuseReport> {
    checkBody(body);
    this.#accept(body(this.view));
    return this.done;
  }

  /** The body returned `result`: a promise other than the scope's own or a recorded call's means
   *  an async body, whose calls after its first await would run outside the scope. */
  #accept(result: unknown): void {
    if (!isThenable(result)) return;
    if (result === this.done || this.#calls.some((c) => c.promise === result)) return;
    Promise.resolve(result).catch(() => undefined);
    throw new TypeError(ASYNC_BODY);
  }

  /**
   * Run `body` as the body of the scope. When it returns, the scope takes its place in the kernel
   * queue as one item. A body that throws leaves nothing to run and takes no place: the calls it
   * recorded are dropped. Nothing else reaches the queue while the body runs, since the queue
   * refuses it (`core/fuse-scope.ts`), so the scope's place is where the body was called.
   */
  run(body: (scope: FuseScope) => void): void {
    fuseSlot.active = this;
    try {
      this.#accept(body(this.view));
      this.#plan = buildPlan(this.#calls);
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
          // Loading failed before the executor could settle calls or release scratch storage.
          for (const c of this.#calls) {
            for (const s of writtenBy(c)) s.error = error;
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

/**
 * Run `body` as a fuse scope: record the kernel calls it makes, and run them as one plan at the
 * place the scope takes in the kernel queue. A call to `fuse` inside a body joins the scope that
 * is open, and returns that scope's report.
 *
 * @throws `TypeError` from inside a body, for a call that cannot be recorded or an async nested
 *   body. The top-level call returns every error as a rejection.
 */
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
