// ═══ The compile gate's entry-call leg, the half that runs in the page (Rule 8.24, change 0016) ═══
//
// `scripts/entry-calls.ts` bundles this file with each `.shade.ts` example's generated host
// module (the module the Vite plugin writes) and `typeshade/runtime`, so the calls below go
// through exactly what an application calls. For each callable entry:
//
//   - a `@compute` entry is called once on WebGPU and once on the CPU tier, each with its own
//     copy of the same bindings, and every storage binding it writes is compared;
//   - a full-screen `@fragment` entry is drawn into a canvas on WebGPU, on WebGL2 and on the
//     CPU tier, and each frame is compared with WebGPU's pixel by pixel.
//
// A tier the entry has no form for (a barrier or a texture on the CPU tier, a storage buffer on
// WebGL2) is reported as skipped with the reason the host face gives, never passed silently.
//
// The bindings are made from the layouts in the face: the same deterministic values on every
// tier, small enough that an index an entry computes from them stays in range.

import { configure } from '../src/core/host-runtime.js';
import type { DrawBinding, Layout, LayoutNumber } from '../src/core/host-entry.js';

/** One callable entry of one example, as `scripts/entry-calls.ts` lists it. */
export interface EntryCase {
  readonly id: string;
  readonly kind: 'compute' | 'fragment';
  readonly name: string;
  readonly bindings: readonly DrawBinding[];
  /** Why the CPU tier cannot run it (a barrier or a texture), when it cannot. */
  readonly noCpu?: string;
  /** Why the WebGL2 tier cannot draw it, when it cannot (a fragment entry). */
  readonly noGl?: string;
  readonly call: (...args: unknown[]) => Promise<void>;
}

/** What one tier did against the reference tier: its worst difference, or why it did not run. */
export interface TierVerdict {
  readonly tier: string;
  readonly worst?: number;
  readonly values?: number;
  readonly skipped?: string;
  readonly error?: string;
}

export interface EntryVerdict {
  readonly id: string;
  readonly kind: 'compute' | 'fragment';
  readonly name: string;
  /** What the reference tier produced: how many written values the WebGPU call changed, so a
   *  call that compares nothing cannot pass, or how many distinct colours its frame holds. */
  readonly changed?: number;
  /** The reference tier's own failure, when it could not run at all. */
  readonly error?: string;
  readonly tiers: readonly TierVerdict[];
}

export interface EntryReport {
  /** The instrument: a comparison against a copy with one value changed must report it. */
  readonly perturbedReported: boolean;
  readonly verdicts: readonly EntryVerdict[];
}

/** A runtime-sized array's element count, and a canvas's side. */
const N = 256;
const SIZE = 32;

// ─── the bindings ────────────────────────────────────────────────────────────────────────────

/** The `k`-th deterministic value of a number type: small, and exact in f32. */
function numberAt(t: LayoutNumber, k: number): number {
  if (t === 'f32' || t === 'f64') return ((k * 37) % 17) / 8 - 1;
  if (t === 'i32') return ((k * 7) % 11) - 5;
  return (k * 7) % 11;
}

const TYPED = {
  f32: Float32Array,
  i32: Int32Array,
  u32: Uint32Array,
  f64: Float64Array,
} as const;

/** A host value for `l`, as the host view types it, numbered from `k.n`. */
function valueOf(l: Layout, boxed: boolean, k: { n: number }): unknown {
  switch (l.k) {
    case 's': {
      const v = numberAt(l.t, k.n++);
      return boxed ? TYPED[l.t].of(v) : v;
    }
    case 'v':
      return Array.from({ length: l.n }, () => numberAt(l.t, k.n++));
    case 'm':
      return Array.from({ length: l.c * l.r }, () => numberAt('f32', k.n++));
    case 'a': {
      const count = l.n ?? N;
      if (l.n === null && (l.e.k === 's' || l.e.k === 'v')) {
        const t = l.e.t;
        const lanes = l.e.k === 'v' ? l.e.n : 1;
        const out = new TYPED[t](count * lanes);
        for (let i = 0; i < out.length; i++) out[i] = numberAt(t, k.n++);
        return out;
      }
      return Array.from({ length: count }, () => valueOf(l.e, false, k));
    }
    case 'o':
      return Object.fromEntries(l.f.map(([name, , fl]) => [name, valueOf(fl, false, k)]));
  }
}

/** The bindings object, fresh: each tier gets its own copy of the same values. */
function bindingsOf(c: EntryCase): Record<string, unknown> {
  const k = { n: 1 };
  const out: Record<string, unknown> = {};
  for (const b of c.bindings) {
    if (b.space === 'uniform' || b.space === 'storage')
      out[b.name] = valueOf(b.layout, b.writes && b.layout.k === 's', k);
    else if ('guard' in b)
      continue; // the `_fp64` guard is the runtime's to bind
    else if (b.space === 'texture') out[b.name] = imageOf();
    else out[b.name] = { filter: 'nearest', address: 'repeat' };
  }
  return out;
}

/** An 8x8 image, each texel its own colour. */
function imageOf(): ImageData {
  const img = new ImageData(8, 8);
  for (let j = 0; j < 8; j++)
    for (let i = 0; i < 8; i++) img.data.set([i * 32, j * 32, (i + j) * 16, 255], 4 * (j * 8 + i));
  return img;
}

/** Every number a value holds, in order. */
function flat(v: unknown): number[] {
  if (typeof v === 'number') return [v];
  if (ArrayBuffer.isView(v)) return Array.from(v as unknown as ArrayLike<number>);
  if (Array.isArray(v)) return v.flatMap(flat);
  if (typeof v === 'object' && v !== null) return Object.values(v).flatMap(flat);
  return [];
}

/** The worst difference of `got` from `want`, relative to 1 or the value's own size; `Infinity`
 *  when the lengths differ. NaN matches NaN. */
export function worstOf(want: readonly number[], got: readonly number[]): number {
  if (want.length !== got.length) return Infinity;
  let worst = 0;
  want.forEach((w, i) => {
    const g = got[i]!;
    if (Number.isNaN(w) && Number.isNaN(g)) return;
    const d = Math.abs(w - g) / Math.max(1, Math.abs(w));
    worst = Math.max(worst, Number.isNaN(d) ? Infinity : d);
  });
  return worst;
}

// ─── the calls ───────────────────────────────────────────────────────────────────────────────

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The storage bindings the entry writes, flattened, before and after one call on `tier`. */
async function computeOn(
  c: EntryCase,
  tier: 'webgpu' | 'cpu',
): Promise<{ before: number[]; after: number[] }> {
  const bindings = bindingsOf(c);
  const written = (): number[] =>
    c.bindings
      .filter((b) => b.space === 'storage' && b.writes)
      .flatMap((b) => flat(bindings[b.name]));
  const before = written();
  configure({ prefer: [tier] });
  try {
    await c.call(bindings, 1);
  } finally {
    configure({});
  }
  return { before, after: written() };
}

/** A canvas whose first context is `kind`, so a draw into it keeps that tier. */
function canvas(kind?: 'webgl2' | '2d'): HTMLCanvasElement {
  const el = document.createElement('canvas');
  el.width = SIZE;
  el.height = SIZE;
  if (kind === 'webgl2')
    el.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: true });
  if (kind === '2d') el.getContext('2d', { alpha: false });
  return el;
}

/** The canvas's pixels, RGBA, read in the task that drew them. */
function pixels(el: HTMLCanvasElement): number[] {
  const copy = document.createElement('canvas');
  copy.width = SIZE;
  copy.height = SIZE;
  const ctx = copy.getContext('2d')!;
  ctx.drawImage(el, 0, 0);
  return [...ctx.getImageData(0, 0, SIZE, SIZE).data];
}

async function drawOn(c: EntryCase, kind?: 'webgl2' | '2d'): Promise<number[]> {
  const el = canvas(kind);
  await c.call(el, bindingsOf(c));
  // A canvas hands out only the kind of context it gave first: WebGPU drew this one, or the
  // reference is some other tier and the comparison would be with itself.
  if (kind === undefined && el.getContext('webgpu') === null)
    throw new Error('the draw did not run on WebGPU');
  return pixels(el);
}

async function verdictOf(c: EntryCase): Promise<EntryVerdict> {
  const base = { id: c.id, kind: c.kind, name: c.name };
  if (c.kind === 'compute') {
    let want: number[];
    let changed: number;
    try {
      const run = await computeOn(c, 'webgpu');
      want = run.after;
      changed = run.after.filter((v, i) => !Object.is(v, run.before[i])).length;
    } catch (e) {
      return { ...base, error: `webgpu: ${message(e)}`, tiers: [] };
    }
    if (c.noCpu !== undefined)
      return { ...base, changed, tiers: [{ tier: 'cpu', skipped: c.noCpu }] };
    try {
      const got = (await computeOn(c, 'cpu')).after;
      return {
        ...base,
        changed,
        tiers: [{ tier: 'cpu', worst: worstOf(want, got), values: want.length }],
      };
    } catch (e) {
      return { ...base, changed, tiers: [{ tier: 'cpu', error: message(e) }] };
    }
  }
  let want: number[];
  try {
    want = await drawOn(c);
  } catch (e) {
    return { ...base, error: `webgpu: ${message(e)}`, tiers: [] };
  }
  const colours = new Set<number>();
  for (let i = 0; i < want.length; i += 4)
    colours.add((want[i]! << 16) | (want[i + 1]! << 8) | want[i + 2]!);
  const tiers: TierVerdict[] = [];
  for (const [tier, kind, no] of [
    ['webgl2', 'webgl2', c.noGl],
    ['cpu', '2d', c.noCpu],
  ] as const) {
    if (no !== undefined) {
      tiers.push({ tier, skipped: no });
      continue;
    }
    try {
      const got = await drawOn(c, kind);
      // In 8-bit steps: a channel's difference out of 255.
      const worst = Math.max(...want.map((w, i) => Math.abs(w - (got[i] ?? NaN))));
      tiers.push({ tier, worst, values: want.length });
    } catch (e) {
      tiers.push({ tier, error: message(e) });
    }
  }
  return { ...base, changed: colours.size, tiers };
}

/** Call every entry on every tier it has, and compare each with WebGPU. */
export async function runEntries(cases: readonly EntryCase[]): Promise<EntryReport> {
  // The instrument, FIRST: a comparison that cannot see one changed value is blind.
  const probe = [0.5, -1, 2, 3];
  const perturbedReported = worstOf(probe, [0.5, -1, 2.01, 3]) > 0;
  const verdicts: EntryVerdict[] = [];
  for (const c of cases) verdicts.push(await verdictOf(c));
  return { perturbedReported, verdicts };
}
