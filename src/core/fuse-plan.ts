// Implements: Rule 11.13 (docs/language-design.md; traced in reqs/).
// ═══ The fuse scope: recording, the plan and the report (change 0058, Rules 11.8 and 11.11) ═══
//
// `fuse(body)` from `typeshade/fuse` runs `body` once, synchronously. While it runs, a kernel call
// whose written arrays are all `Resident`s is recorded and not run (`core/fuse-scope.ts` is the
// slot the call layer asks). When `body` returns, the plan is built from the recorded calls: the
// kernel function and the loops of each, the `Resident`s it reads and writes, the dependency from
// a write to the later reads and writes of the same `Resident`, and the barriers between groups.
// The plan then runs as one unit in the kernel queue, at the place the scope takes when the body
// returns. Nothing else reaches the queue while the body runs, since the queue refuses it, so that
// place is where `fuse` was called, and every call and every `read()` made after it sees what the
// plan wrote, in the order Rule 11.8 sets. On WebGPU the dispatches of all the recorded calls go
// into one command encoder and reach the queue in one submission.
//
// The plan fuses what the facts allow. When the calls have been checked, `core/fuse-group.ts`
// groups the consecutive calls that may become one dispatch, and `core/fuse-entry.ts` builds the
// entry each group of more than one call runs as. A call that joins no group runs as it runs
// outside a scope. Only WebGPU fuses: on WebGL2 and on the CPU tier every group is one call. A
// group may end in a call that reduces (F6): it runs as that call's reduction does, its loop and
// then a fold for each level of partials (`reduceOnGpu` in `core/host-kernel.ts`).
//
// The scope also makes scratch arrays (`scope.scratch()`), the intermediates of a chain that the
// host never reads. A scratch array is a `Resident` whose state is made here and owned by the
// scope: it holds no host array and no device buffer until a call needs one. A group that fuses
// every call that names it holds it as a local of its entry, and then nothing is ever made for
// it. Otherwise the first call that runs on WebGPU makes a zeroed device buffer, and the first
// call that runs on the host a zeroed host array, and the plan frees both when it has run, on
// success and on failure.
//
// Like the rest of `typeshade/runtime` it imports no compiler, and `typeshade/fuse` is the only
// subpath that imports this file.

import { fusedFor, uniformFor, type Fused } from './fuse-entry.js';
import { assignSlots, DEFAULT_STORAGE_BUFFERS, groupCalls, type GroupCall } from './fuse-group.js';
import { fuseSlot, type FuseRecorder } from './fuse-scope.js';
import {
  DispatchBatch,
  describe,
  forgetBuffer,
  gpuDevice,
  packed,
  type GeneratedCpu,
  type GpuBuffer,
  type GpuCounts,
  type GpuDevice,
  type Layout,
} from './host-entry.js';
import {
  arityError,
  checkCall,
  grid,
  reduceOnGpu,
  runChecked,
  tailResult,
  type CheckedCall,
  type Finish,
  type Folded,
  type KernelFace,
  type PlanRun,
} from './host-kernel.js';
import { glContext } from './host-kernel-gl.js';
import {
  adopt,
  kernelQueue,
  preferredTiers,
  ResidentArrayState,
  residentState,
  ZEROED_ELEMENTS,
  ZeroedState,
  type Resident,
  type ZeroedElement,
} from './resident.js';
import { TIERS, type Tier } from './tiers.js';

// ─── the public types ────────────────────────────────────────────────────────────────────────

/**
 * What the body of a `fuse` call receives: the scope that records the kernel calls the body
 * makes, and makes the scratch arrays they share.
 *
 * Exported from `typeshade/fuse`.
 */
export interface FuseScope {
  /** How many kernel calls the body has made so far. The scope has recorded them and has not
   *  run them: they run when the body returns. */
  readonly recorded: number;
  /**
   * Make a scratch array: a handle for an intermediate between the calls of the body, which the
   * host never reads. A kernel call in the body takes it where it takes an `array<f32>`,
   * `array<i32>` or `array<u32>`, as the `element` says. It holds zeros when the plan starts, as
   * a new buffer does.
   *
   * Where the plan fuses every call that takes it into one dispatch, and each call reaches it
   * at exactly the loop's counter and never by its length, the fused entry holds it as a local:
   * no device buffer and no host array of `length` elements is made. Otherwise the plan makes a
   * zeroed device buffer for the scope, or on the CPU tier and WebGL2 a zeroed host array when
   * the first call needs it, and frees it when the plan has run, on success and on failure.
   *
   * `read()` and `write()` of the handle are a `TypeError` naming it as scratch, and so is a
   * kernel call that takes it outside the body of the scope that made it or after the plan has
   * run. So is an entry call that takes it. Inside the body an entry call is refused first, as it
   * always is. `destroy()` does nothing: the plan frees the array, so a host that destroys every
   * handle it holds stays correct. A handle from `resident()` keeps its buffer and its write
   * inside a fused group, so the host may read it after the scope.
   *
   * @param length - how many elements it holds, a whole number from 0 to 4294967295.
   * @param element - the type of an element, `'f32'` when left out.
   * @returns the handle, which a kernel call takes as a `Resident`.
   * @throws `TypeError` for a length that is not a whole number in that range, an element that
   *   is none of the three, and a call made when the body is not running.
   */
  scratch(length: number, element?: 'f32'): Resident<Float32Array>;
  scratch(length: number, element: 'i32'): Resident<Int32Array>;
  scratch(length: number, element: 'u32'): Resident<Uint32Array>;
}

/**
 * What a `fuse` scope did once its plan had run. The counts are of the calls the plan made to
 * the device and nothing else: a `dispatches` is one dispatch on WebGPU or one draw on WebGL2,
 * and a `submissions` is one `queue.submit`, a read of a `Resident` that the plan needed
 * included.
 *
 * Exported from `typeshade/fuse`.
 */
export interface FuseReport {
  /** The best tier any call of the plan ran on: WebGPU before WebGL2 before the CPU tier, and
   *  `'cpu'` when no call ran on a device. Each call runs on the first tier of
   *  `configure({ prefer })` that can run it, as a call outside a scope does. */
  readonly tier: 'webgpu' | 'webgl2' | 'cpu';
  /** How many dispatches the plan made: none on the CPU tier. */
  readonly dispatches: number;
  /** How many times the plan gave the WebGPU queue commands: none on the other tiers. One for
   *  a scope whose calls all run on WebGPU, the calls that reduce among them: the loop of a
   *  reduction, the dispatches that fold its partials and the copy of what it folded to are in
   *  that submission. A call that runs on WebGL2 or the CPU tier reads its arrays from the host,
   *  so the plan submits what it holds before it, and each read of a `Resident` from the device
   *  that the call needs is a submission too. */
  readonly submissions: number;
  /** The groups of calls, in order, each by the names of its kernel functions. A group that is
   *  `fused` is one dispatch. `why` says, in the author's words, why a group stands apart from
   *  the one before it; a group with nothing to say leaves it out. */
  readonly groups: readonly {
    readonly calls: readonly string[];
    readonly fused: boolean;
    readonly why?: string;
  }[];
}

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

/**
 * Build the plan of calls in the order they were made. Every call is a group of its own here, with
 * a barrier before each call after the first: the groups the planner settles when the calls have
 * been checked and the device is known replace them (`core/fuse-group.ts`), since they depend on
 * each call's range and on the tier it runs on, which a body that has not run cannot know.
 */
export function buildPlan(calls: readonly { k: KernelFace; args: readonly unknown[] }[]): Plan {
  const residents: ResidentArrayState[] = [];
  const at = (s: ResidentArrayState): number => {
    const i = residents.indexOf(s);
    return i >= 0 ? i : residents.push(s) - 1;
  };
  const planned: PlanCall[] = calls.map(({ k, args }) => {
    const reads: number[] = [];
    const writes: number[] = [];
    k.params.forEach((p, i) => {
      const s = p.k === 'array' ? residentState(args[i]) : undefined;
      if (s !== undefined) (p.k === 'array' && p.writes ? writes : reads).push(at(s));
    });
    return { name: k.name, loops: k.gpu?.loops.map((l) => l.entry) ?? [], reads, writes };
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

/** The element of a scratch array: the element of a zeroed array (surface §65). */
type ScratchElement = ZeroedElement;

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

  constructor(
    length: number,
    element: ScratchElement,
    readonly owner: Scope,
  ) {
    super(length, element);
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
interface RecordedCall {
  readonly cpu: GeneratedCpu;
  readonly k: KernelFace;
  readonly argc: number;
  readonly args: readonly unknown[];
  /** The promise the call returned to the body. */
  readonly promise: Promise<unknown>;
  readonly settle: { resolve(value: unknown): void; reject(error: unknown): void };
}

/** The `Resident`s a call writes, which keep the error of a plan that fails. */
function writtenBy(c: RecordedCall): ResidentArrayState[] {
  return c.k.params.flatMap((p, i) => {
    const s = p.k === 'array' && p.writes ? residentState(c.args[i]) : undefined;
    return s === undefined ? [] : [s];
  });
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

  constructor() {
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
      if (p.k === 'array' && p.writes && residentState(args[i]) === undefined)
        throw new TypeError(
          `${k.name}(): parameter "${p.name}" is ${describe(args[i])}, and a call inside fuse() writes only a Resident. fuse() reads nothing back. Pass resident(...), or call ${k.name}() outside fuse().`,
        );
      // A scratch array belongs to the scope that made it.
      const s = residentState(args[i]);
      if (s instanceof ScratchState && s.owner !== this)
        throw s.outside(`${k.name}(): parameter "${p.name}"`);
    }
    let settle!: RecordedCall['settle'];
    const promise = new Promise<unknown>((resolve, reject) => {
      settle = { resolve, reject };
    });
    // A call nobody awaits keeps its error on what it writes, for `read()` to throw.
    promise.catch(() => undefined);
    this.#calls.push({ cpu, k, argc, args, promise, settle });
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
    if (typeof element !== 'string' || !Object.hasOwn(ZEROED_ELEMENTS, element))
      throw new TypeError(
        `scratch(): the element is 'f32', 'i32' or 'u32'; got ${describe(element)}.`,
      );
    const state = new ScratchState(length, element as ScratchElement, this);
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
      .run(() => runPlan(this.#calls, this.#plan!, this.#scratch))
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
export function runScope(body: (scope: FuseScope) => void): Promise<FuseReport> {
  const outer = fuseSlot.active;
  if (outer instanceof Scope) return outer.join(body);
  try {
    checkBody(body);
  } catch (error) {
    return Promise.reject(error);
  }
  const scope = new Scope();
  scope.run(body);
  return scope.done;
}

// ─── grouping ────────────────────────────────────────────────────────────────────────────────

/** The tier a checked call runs on: the first tier of `configure({ prefer })` that can run it,
 *  which is the choice `runChecked` makes, made before anything runs. A tier whose program a
 *  driver then refuses is not seen here; it only moves a call to a tier that fuses nothing. */
async function tierOf(k: KernelFace, c: CheckedCall): Promise<Tier> {
  for (const tier of preferredTiers()) {
    if (tier === 'webgpu') {
      if (k.gpu !== undefined && c.ranges !== undefined && (await gpuDevice()) !== null)
        return tier;
    } else if (tier === 'webgl2') {
      if (
        k.gl !== undefined &&
        k.gpu !== undefined &&
        c.ranges !== undefined &&
        glContext() !== null
      )
        return tier;
    } else return tier;
  }
  return 'cpu';
}

/** What a group of more than one call runs as: its entry, and the array each slot binds. */
interface FusedRun {
  readonly fused: Fused;
  readonly arrays: readonly object[];
}

/** The groups of a plan, and for each the fused entry it runs as, if it is more than one call. */
interface Settled {
  readonly groups: readonly PlanGroup[];
  readonly runs: readonly (FusedRun | undefined)[];
}

/**
 * Settle the groups of calls that have been checked: which tier each runs on, the storage buffers
 * the device allows a dispatch, the groups the planner makes and the entry of each group of
 * several calls. A group whose entry cannot be built runs its calls apart, and says why.
 */
async function settle(
  calls: readonly RecordedCall[],
  checked: readonly CheckedCall[],
): Promise<Settled> {
  const tiers: Tier[] = [];
  for (const [i, c] of calls.entries()) tiers.push(await tierOf(c.k, checked[i]!));
  const device = tiers.includes('webgpu') ? await gpuDevice() : null;
  const limit = device?.limits?.maxStorageBuffersPerShaderStage ?? DEFAULT_STORAGE_BUFFERS;
  const seen: GroupCall[] = calls.map((c, i) => ({
    k: c.k,
    // An array is known by its identity: a `Resident`'s state, or the host array.
    arrays: c.k.params.map((p, at) =>
      p.k === 'array' ? (checked[i]!.states[at] ?? (checked[i]!.hosts[at] as object)) : undefined,
    ),
    range: checked[i]!.ranges?.[0],
    tier: tiers[i]!,
  }));
  const groups: PlanGroup[] = [];
  const runs: (FusedRun | undefined)[] = [];
  // The scratch arrays of the scope: a group that fuses every call that names one holds it as a
  // local.
  const scratch = new Set<object>(
    seen.flatMap((c) => c.arrays).filter((a) => a instanceof ScratchState),
  );
  for (const planned of groupCalls(seen, limit, scratch)) {
    const g: PlanGroup = {
      calls: planned.calls,
      fused: planned.fused,
      ...(planned.why !== undefined ? { why: planned.why } : {}),
    };
    if (!g.fused) {
      groups.push(g);
      runs.push(undefined);
      continue;
    }
    const { slots, arrays } = assignSlots(g.calls.map((i) => seen[i]!));
    const fused = fusedFor(
      g.calls.map((i, m) => ({ k: calls[i]!.k, slots: slots[m]! })),
      arrays.flatMap((a, at) => (planned.contracted.includes(a) ? [at] : [])),
    );
    if (!('none' in fused)) {
      groups.push(g);
      runs.push({ fused, arrays });
      continue;
    }
    g.calls.forEach((i, m) => {
      const [before, name] = [calls[g.calls[m - 1] ?? i]!.k.name, calls[i]!.k.name];
      const why =
        m === 0
          ? g.why
          : `${before} and ${name} run as two dispatches because the fused entry could not be built: ${fused.none}`;
      groups.push({ calls: [i], fused: false, ...(why !== undefined ? { why } : {}) });
      runs.push(undefined);
    });
  }
  return { groups, runs };
}

/** The plan with the groups the planner settled, and a barrier before each group but the first. */
const regroup = (plan: Plan, groups: readonly PlanGroup[]): Plan => ({
  ...plan,
  groups,
  barriers: groups.slice(1).map((g) => g.calls[0]!),
});

// ─── running ─────────────────────────────────────────────────────────────────────────────────

/**
 * Run the calls of a group as one dispatch: each distinct array is bound once, a `Resident` as
 * the buffer it already has on the device, as a call outside a scope binds it, and the dispatch
 * joins the plan's batch. The result of each call is what its tail gives, which a {@link Finish}
 * computes once the plan has submitted. A fused group is a group of calls that run on WebGPU, and
 * none has an empty range.
 *
 * A group whose last call reduces is that call's reduction with the calls before it as a prologue
 * (F6): its loop entry, then one fold entry for each level of partials, run as `callKernel` runs
 * them (`reduceOnGpu`). They are dispatches of the plan's batch like the others: the levels share
 * one device buffer of partials, each with a uniform of its own, and the folded values are copied
 * in the plan's submission and wait for the end of it. The tail of the last call takes what the
 * levels folded, and the tails of the others fold nothing.
 */
async function runFused(
  group: PlanGroup,
  f: FusedRun,
  calls: readonly RecordedCall[],
  checked: readonly CheckedCall[],
  run: PlanRun,
): Promise<Finish[]> {
  const d = (await gpuDevice())!;
  run.tiers.add('webgpu');
  const values: Record<string, unknown> = {};
  const onDevice = new Map<string, GpuBuffer>();
  // An array the entry holds as a local has no slot here: nothing of it is bound.
  f.fused.slots.forEach((slot) => {
    const array = f.arrays[slot.array]!;
    if (array instanceof ResidentArrayState)
      onDevice.set(
        slot.name,
        array.bufferFor(
          d,
          slot.binding.layout as Layout & { k: 'a' },
          () => packed(slot.binding, array.host),
          slot.written,
        ),
      );
    else values[slot.name] = array;
  });
  const ranges = group.calls.map((i) => checked[i]!.ranges![0]!);
  const uniform = uniformFor(
    group.calls.map((i, m) => ({ k: calls[i]!.k, hosts: checked[i]!.hosts, range: ranges[m]! })),
  );
  values[f.fused.args.name] = uniform;
  const { reduce } = f.fused;
  let folded: Folded | undefined;
  if (reduce === undefined)
    await run
      .batchOn(d)
      .add(
        f.fused.entry,
        { values, images: new Map(), samplers: new Map(), onDevice },
        grid(Math.ceil(ranges[0]!.n / f.fused.wg)).wg,
      );
  else
    folded = await reduceOnGpu(
      d,
      {
        loop: f.fused.entry,
        fold: reduce.fold,
        args: f.fused.args.name,
        wg: f.fused.wg,
        vars: reduce.vars,
        fields: reduce.fields,
      },
      ranges[0]!.n,
      uniform,
      values,
      onDevice,
      run.batchOn(d),
    );
  const last = group.calls.length - 1;
  return group.calls.map(
    (i, m): Finish =>
      async () =>
        tailResult(
          calls[i]!.cpu,
          calls[i]!.k,
          checked[i]!.values,
          folded !== undefined && m === last ? await folded() : [],
        ),
  );
}

/**
 * Run the plan's calls in order, each as it runs outside a scope, except that on WebGPU all their
 * dispatches reach the queue together, and the calls of a group the planner fused are one
 * dispatch. Every call is checked before any runs, and the groups are settled before the first
 * dispatch. The dispatches are submitted when the last call has run, and before a call that must
 * see what they wrote: a call that runs on WebGL2 or the CPU, which reads its arrays from the
 * host. A reduction is no such call: its levels are dispatches of the batch like the rest, and
 * what it folded to is copied in the submission that holds them, so the result of a call that
 * reduces is computed after the last submission.
 *
 * The plan is one unit. If it fails, the error stays on every `Resident` any of its calls writes,
 * for `read()` to throw, as a failed call leaves it on the ones it writes, and every call of it
 * rejects. A call that ran before the failure may have changed what it wrote, and a call after it
 * did not run, so none of those arrays can be trusted. Whatever the outcome, the scratch arrays
 * of the scope are freed when the plan has run.
 */
async function runPlan(
  calls: readonly RecordedCall[],
  planned: Plan,
  scratch: readonly ScratchState[],
): Promise<FuseReport> {
  let plan = planned;
  const counts: GpuCounts = { dispatches: 0, submissions: 0 };
  const tiers = new Set<Tier>();
  let batch: DispatchBatch | undefined;
  const run: PlanRun = {
    counts,
    tiers,
    batchOn(d) {
      batch ??= new DispatchBatch(d, counts);
      if (batch.device !== d) throw new Error('fuse(): the device changed while the scope ran.');
      return batch;
    },
    flush: async () => batch?.flush(),
  };
  // How to get the result of each call, in the order of the calls, and the results.
  const finishes: Finish[] = [];
  const results: unknown[] = [];
  // From here the scratch arrays are usable, by the calls of this plan and by nothing else.
  for (const s of scratch) s.phase = 'running';
  try {
    const checked = calls.map((c) => checkCall(c.cpu, c.k, c.argc, c.args));
    const settled = await settle(calls, checked);
    plan = regroup(planned, settled.groups);
    for (const [gi, g] of settled.groups.entries()) {
      const fused = settled.runs[gi];
      if (fused !== undefined) {
        const done = await runFused(g, fused, calls, checked, run);
        g.calls.forEach((i, m) => (finishes[i] = done[m]!));
        continue;
      }
      for (const i of g.calls)
        finishes[i] = await runChecked(calls[i]!.cpu, calls[i]!.k, checked[i]!, run);
    }
    await run.flush();
    // The device held what a reduction folded to until its submission.
    for (const [i, finish] of finishes.entries()) results[i] = await finish();
  } catch (error) {
    // What the batch holds was never submitted.
    batch?.discard();
    for (const c of calls) {
      for (const s of writtenBy(c)) s.error = error;
      c.settle.reject(error);
    }
    throw error;
  } finally {
    for (const s of scratch) s.release();
  }
  calls.forEach((c, i) => {
    for (const s of writtenBy(c)) s.error = undefined;
    c.settle.resolve(results[i]);
  });
  return {
    tier: TIERS.find((t) => tiers.has(t)) ?? 'cpu',
    dispatches: counts.dispatches,
    submissions: counts.submissions,
    groups: plan.groups.map((g) => ({
      calls: g.calls.map((i) => plan.calls[i]!.name),
      fused: g.fused,
      ...(g.why !== undefined ? { why: g.why } : {}),
    })),
  };
}
