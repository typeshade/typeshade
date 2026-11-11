// Verifies: Rule 11.8 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 11.13 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 12.7 (docs/language-design.md; traced in reqs/).
// Generated calls propagate failed content inputs (0129), while independent work and writers recover.
//
// A call on a Buffer is checked at the call (change 0138, R2), so the failures here come from a
// call that fails when it runs: its count is a Buffer<u32> read when the call runs (Amendment A10,
// Q-C). The 0129 rules hold for the calls made before the failure is known. A Buffer a failed call
// wrote throws its error at each later call that takes it, until set(data) or resize() (A7,
// decision b), as every Buffer does (Amendment A10, Q-I).
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hostFace } from './host-face.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';
import { createDevice } from '../../runtime/device.js';
import { kernelQueue, residentState } from '../../core/resident.js';
import { throwFailure } from '../../core/submission.js';
import { array } from '../../runtime.js';

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
type Call = (...args: unknown[]) => Promise<unknown>;
async function load(
  source: string,
  fuse = true,
  legacy = false,
  documents: Readonly<Record<string, string>> = {},
): Promise<Record<string, Call>> {
  const uri = '/failure/input.shade.ts';
  const face = hostFace(source, {
    fileName: uri,
    runtime: resolve(__dirname, '../../core/host-runtime.ts'),
    fuse,
    readDocument: (name) => documents[name],
  });
  expect(face.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  const ls = createTypeshadeLanguageService({ readDocument: (name) => documents[name] });
  for (const [file, text] of Object.entries(documents)) ls.openDocument(file, text);
  ls.openDocument(uri, source);
  expect(
    ls.getDiagnostics(uri).map((d) => ({
      code: String(d.code).replace(/^TS/, ''),
      message: d.message,
      severity: d.severity,
    })),
  ).toEqual(
    face.diagnostics.map((d) => ({
      code: String(d.code).replace(/^TS/, ''),
      message: d.message,
      severity: d.category,
    })),
  );
  ls.closeDocument(uri);
  for (const file of Object.keys(documents)) {
    expect(ls.getDiagnostics(file)).toEqual([]);
    ls.closeDocument(file);
  }
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-failure-'));
  dirs.push(dir);
  const path = join(dir, 'shader.mjs');
  // The generated executable alone carries private facts. Their absence models an old artifact.
  const code = legacy ? face.code!.replace(/, __ts_reads\d+(?=\);)/g, '') : face.code!;
  writeFileSync(path, code);
  return (await import(/* @vite-ignore */ pathToFileURL(path).href)) as Record<string, Call>;
}
const capture = async (p: Promise<unknown>): Promise<unknown> =>
  p.then(
    () => undefined,
    (e: unknown) => e,
  );
const SOURCE = `"use typeshade";
export function fill(out: array<f32>, n: u32, value: f32) {
  for (let i: u32 = 0; i < n; i++) out[i] = value;
}
export function twice(out: array<f32>, xs: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) out[i] = 2. * xs[i];
}
export function update(out: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) out[i] += 1.;
}
export function capacity(out: array<f32>, xs: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) out[i] = f32(xs.length);
}
export function unused(out: array<f32>, xs: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) out[i] = 7.;
}
export function late(out: array<f32>, xs: array<f32>): f32 {
  for (let i: u32 = 0; i < out.length; i++) out[i] = 7.;
  return xs[0];
}
function get(value: f32): f32 { return value; }
export function helper(out: array<f32>, xs: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) out[i] = get(xs[i]);
}
export function combine(out: array<f32>, first: array<f32>, second: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) out[i] = first[i] + second[i];
}
`;
/** Record a call of `fn` that writes `count` elements of `a` when it runs: the count is a
 *  Buffer<u32> of `owner`, which the check at the call does not read. */
function fail(
  m: Record<string, Call>,
  owner: { array(v: Uint32Array): unknown },
  a: unknown,
  fn = 'fill',
  count = 5,
): void {
  const n = owner.array(Uint32Array.of(count));
  if (fn === 'fill') void m.fill!(a, n, 9);
  else void m[fn]!(a, n);
}
/** Let the recorded calls run, and take the pending copy of a failure, thrown once (A5, default
 *  7), so that it reaches no later call of the test. */
async function settle(): Promise<void> {
  await new Promise((r) => setImmediate(r));
  await kernelQueue.idle();
  try {
    throwFailure();
  } catch {
    // The pending copy: each Buffer the call wrote keeps the error too.
  }
}
/** The error a Buffer keeps. */
const errorOf = (b: unknown): unknown => residentState(b)?.error;
/** What a call throws at the call. */
const thrown = (f: () => unknown): unknown => {
  try {
    f();
  } catch (e) {
    return e;
  }
  return undefined;
};

describe('generated calls admit healthy content dependencies (0129)', () => {
  for (const fuse of [true, false]) {
    it(`propagates the producer error through two consumers made before it failed; fuse facts ${fuse}`, async () => {
      const m = await load(SOURCE, fuse);
      const d = await createDevice({ prefer: ['cpu'] });
      try {
        const a = d.array(new Float32Array(4).fill(9));
        const b = d.array(new Float32Array(4).fill(77));
        const c = d.array(new Float32Array(4));
        fail(m, d, a);
        void m.twice!(b, a);
        void m.twice!(c, b);
        await settle();
        const e = errorOf(a);
        expect(e).toBeInstanceOf(TypeError);
        expect(errorOf(b)).toBe(e);
        expect(errorOf(c)).toBe(e);
        expect(await capture(c.read())).toBe(e);
        expect(residentState(b)?.host).toEqual(new Float32Array(4).fill(77));
      } finally {
        await d.dispose();
      }
    });
  }
  for (const n of [0, 1, 4]) {
    it(`recovers a write-only call of ${n} elements made before the failure was known, and refuses one made after until set(data)`, async () => {
      const m = await load(SOURCE);
      const d = await createDevice({ prefer: ['cpu'] });
      try {
        const a = d.array(new Float32Array(4).fill(3));
        fail(m, d, a);
        void m.fill!(a, n, 7);
        await settle();
        expect(errorOf(a)).toBeUndefined();
        expect([...(await a.read())]).toEqual(Array.from({ length: 4 }, (_, i) => (i < n ? 7 : 3)));
        // A Buffer a failed call left is refused at the call (A7, decision b).
        fail(m, d, a);
        await settle();
        const e = errorOf(a);
        expect(thrown(() => m.fill!(a, n, 7))).toBe(e);
        a.set(new Float32Array(4).fill(3));
        void m.fill!(a, n, 7);
        expect([...(await a.read())]).toEqual(Array.from({ length: 4 }, (_, i) => (i < n ? 7 : 3)));
      } finally {
        await d.dispose();
      }
    });
  }
  for (const name of ['twice', 'helper', 'late']) {
    it(`sees content reads in ${name}`, async () => {
      const m = await load(SOURCE);
      const d = await createDevice({ prefer: ['cpu'] });
      try {
        const a = d.array(new Float32Array(4));
        const b = d.array(new Float32Array(4).fill(17));
        fail(m, d, a);
        void m[name]!(b, a);
        await settle();
        const e = errorOf(a);
        expect(e).toBeInstanceOf(TypeError);
        expect(await capture(b.read())).toBe(e);
        expect(residentState(b)?.host).toEqual(new Float32Array(4).fill(17));
      } finally {
        await d.dispose();
      }
    });
  }
  it('refuses a read/write call on a failed Buffer, and a whole set(data) recovers it (A7, decision b)', async () => {
    const m = await load(SOURCE);
    const d = await createDevice({ prefer: ['cpu'] });
    try {
      const a = d.array(new Float32Array(4));
      fail(m, d, a);
      void m.update!(a);
      await settle();
      const e = errorOf(a);
      expect(e).toBeInstanceOf(TypeError);
      expect(await capture(a.read())).toBe(e);
      expect(thrown(() => m.update!(a))).toBe(e);
      a.set(new Float32Array(4).fill(2));
      void m.update!(a);
      expect([...(await a.read())]).toEqual([3, 3, 3, 3]);
    } finally {
      await d.dispose();
    }
  });
  for (const [name, value] of [
    ['unused', 7],
    ['capacity', 4],
  ] as const) {
    it(`does not propagate an input used by ${name}`, async () => {
      const m = await load(SOURCE);
      const d = await createDevice({ prefer: ['cpu'] });
      try {
        const a = d.array(new Float32Array(4));
        const b = d.array(new Float32Array(4));
        fail(m, d, a);
        void m[name]!(b, a);
        await settle();
        expect(errorOf(b)).toBeUndefined();
        expect([...(await b.read())]).toEqual(new Array(4).fill(value));
        expect(await capture(a.read())).toBe(errorOf(a));
      } finally {
        await d.dispose();
      }
    });
  }
  it('selects failures in parameter order, and refuses an alias and a shape at the call', async () => {
    const m = await load(SOURCE);
    const d = await createDevice({ prefer: ['cpu'] });
    try {
      const a = d.array(new Float32Array(4));
      const b = d.array(new Float32Array(4));
      const out = d.array(new Float32Array(4));
      fail(m, d, a);
      fail(m, d, b);
      void m.combine!(out, b, a);
      await settle();
      const first = errorOf(a);
      const second = errorOf(b);
      expect(first).toBeInstanceOf(TypeError);
      expect(first).not.toBe(second);
      expect(errorOf(out)).toBe(second);
      const healthy = d.array(new Float32Array(4));
      const fresh = d.array(new Float32Array(4));
      expect(String(thrown(() => m.combine!(fresh, healthy, healthy)))).toContain('same Buffer');
      expect(thrown(() => m.twice!(fresh, d.array(new Float32Array(2))))).toBeInstanceOf(TypeError);
    } finally {
      await d.dispose();
    }
  });
  it('loads a legacy artifact but treats missing facts as content reads', async () => {
    for (const legacy of [false, true]) {
      const m = await load(SOURCE, true, legacy);
      const d = await createDevice({ prefer: ['cpu'] });
      try {
        const a = d.array(new Float32Array(4));
        fail(m, d, a);
        void m.fill!(a, 4, 7);
        await settle();
        // With the facts, the write-only call recovers the Buffer; without them, it reads it.
        if (legacy) expect(errorOf(a)).toBeInstanceOf(TypeError);
        else expect(errorOf(a)).toBeUndefined();
      } finally {
        await d.dispose();
      }
    }
  });
  it('keeps independent work on the same and another owner runnable', async () => {
    const m = await load(SOURCE);
    const d = await createDevice({ prefer: ['cpu'] });
    const other = await createDevice({ prefer: ['cpu'] });
    try {
      const a = d.array(new Float32Array(4));
      const b = d.array(new Float32Array(4));
      const c = other.array(new Float32Array(4));
      fail(m, d, a);
      void m.fill!(b, 4, 2);
      void m.fill!(c, 4, 3);
      await settle();
      expect(errorOf(a)).toBeInstanceOf(TypeError);
      expect([...(await b.read())]).toEqual([2, 2, 2, 2]);
      expect([...(await c.read())]).toEqual([3, 3, 3, 3]);
    } finally {
      await d.dispose();
      await other.dispose();
    }
  });
  it.each([false, true])(
    'admits an earlier recovery without clearing real errors early (nested=%s)',
    async (nested) => {
      const m = await load(SOURCE);
      const d = await createDevice({ prefer: ['cpu'] });
      try {
        const a = d.array(new Float32Array(4));
        const b = d.array(new Float32Array(4));
        fail(m, d, a);
        await settle();
        const e = errorOf(a);
        const calls: Promise<unknown>[] = [];
        let inner: Promise<unknown> | undefined;
        const plan = d.fuse(() => {
          calls.push(m.fill!(a, 4, 3));
          const consume = () => {
            calls.push(m.twice!(b, a));
          };
          if (nested) inner = d.fuse(consume);
          else consume();
          expect(errorOf(a)).toBe(e);
        });
        const report = await plan;
        if (nested) expect(await inner).toBe(report);
        await Promise.all(calls);
        expect([...(await b.read())]).toEqual([6, 6, 6, 6]);
      } finally {
        await d.dispose();
      }
    },
  );
  it.each([false, true])(
    'rejects the whole plan before independent writes (nested=%s)',
    async (nested) => {
      const m = await load(SOURCE);
      const d = await createDevice({ prefer: ['cpu'] });
      try {
        const a = d.array(new Float32Array(4));
        const b = d.array(new Float32Array(4).fill(11));
        const c = d.array(new Float32Array(4).fill(13));
        fail(m, d, a);
        await settle();
        const e = errorOf(a);
        const calls: Promise<unknown>[] = [];
        let inner: Promise<unknown> | undefined;
        const plan = d.fuse(() => {
          calls.push(capture(m.fill!(c, 4, 3)));
          const consume = () => {
            calls.push(capture(m.twice!(b, a)));
          };
          if (nested) inner = capture(d.fuse(consume));
          else consume();
          calls.push(capture(m.fill!(a, 4, 2)));
        });
        expect(await capture(plan)).toBe(e);
        if (nested) expect(await inner).toBe(e);
        expect(await Promise.all(calls)).toEqual([e, e, e]);
        expect(await capture(b.read())).toBe(e);
        expect(await capture(c.read())).toBe(e);
        expect(residentState(c)?.host).toEqual(new Float32Array(4).fill(13));
      } finally {
        await d.dispose();
      }
    },
  );
});

const ENTRIES = `"use typeshade";
const GAIN: override<f32> = 2.;
declare const xs: storage<array<f32>>;
declare const other: storage<array<f32>>;
declare const dst: storage<array<f32>, "read_write">;
function sample(i: u32): f32 { return xs[i]; }
@compute([1]) export function copy(gid: builtin<"global_invocation_id">) {
  if (gid.x < dst.length) dst[gid.x] = GAIN * sample(gid.x);
}
@compute([1]) export function sum(gid: builtin<"global_invocation_id">) {
  if (gid.x < dst.length) dst[gid.x] = xs[gid.x] + other[gid.x];
}
@compute([1]) export function reset(gid: builtin<"global_invocation_id">) {
  if (gid.x < dst.length) dst[gid.x] = 7.;
}
@compute([1]) export function mutate(gid: builtin<"global_invocation_id">) {
  if (gid.x < dst.length) dst[gid.x] += 1.;
}
@compute([1]) export function capacity(gid: builtin<"global_invocation_id">) {
  if (gid.x < dst.length) dst[gid.x] = f32(xs.length);
}
@fragment export function color(): vec4 { return vec4(xs[0], 0., 0., 1.); }
@fragment export function sizeColor(): vec4 { return vec4(f32(xs.length) / 4., 0., 0., 1.); }
export function fill(out: array<f32>, n: u32, value: f32) {
  for (let i: u32 = 0; i < n; i++) out[i] = value;
}
export function words(out: array<u32>, n: u32) {
  for (let i: u32 = 0; i < n; i++) out[i] = 1;
}
`;

describe('generated compute and draw dependencies (0129)', () => {
  it('checks helper binding reads after override specialization, and preserves write-only entry recovery', async () => {
    const m = await load(ENTRIES);
    const d = await createDevice({ prefer: ['cpu'] });
    try {
      const xs = d.array(new Float32Array(4).fill(3));
      const dst = d.array(new Float32Array(4));
      fail(m, d, xs);
      void m.copy!({ dst, xs }, 4, { constants: { GAIN: 3 } });
      void m.mutate!({ dst }, 4);
      await settle();
      const e = errorOf(xs);
      expect(e).toBeInstanceOf(TypeError);
      expect(errorOf(dst)).toBe(e);
      expect(await capture(dst.read())).toBe(e);
      // A write-only entry made before the failure was known recovers dst, and a capacity read
      // of xs is no content read.
      const out = d.array(new Float32Array(4));
      const ys = d.array(new Float32Array(4).fill(3));
      fail(m, d, ys);
      void m.copy!({ dst: out, xs: ys }, 4, { constants: { GAIN: 3 } });
      void m.reset!({ dst: out }, 4);
      void m.capacity!({ xs: d.array(new Float32Array(4)), dst: out }, 4);
      await settle();
      expect(errorOf(out)).toBeUndefined();
      expect([...(await out.read())]).toEqual([4, 4, 4, 4]);
    } finally {
      await d.dispose();
    }
  });
  it('orders bindings independently of object insertion, followed by indirect count errors', async () => {
    const m = await load(ENTRIES);
    const d = await createDevice({ prefer: ['cpu'] });
    try {
      const xs = d.array(new Float32Array(4));
      const other = d.array(new Float32Array(4));
      const dst = d.array(new Float32Array(4));
      const last = d.array(new Float32Array(4));
      const counts = d.array(Uint32Array.of(4, 1, 1));
      fail(m, d, xs);
      fail(m, d, other);
      fail(m, d, counts, 'words', 4);
      void m.sum!({ other, dst, xs }, { indirect: counts });
      void m.reset!({ dst: last }, { indirect: counts });
      await settle();
      expect(errorOf(dst)).toBe(errorOf(xs));
      expect(errorOf(counts)).toBeInstanceOf(TypeError);
      expect(errorOf(last)).toBe(errorOf(counts));
      expect(await capture(last.read())).toBe(errorOf(counts));
    } finally {
      await d.dispose();
    }
  });
  it('admits recovery across entry calls within one plan', async () => {
    const m = await load(ENTRIES);
    const d = await createDevice({ prefer: ['cpu'] });
    try {
      const xs = d.array(new Float32Array(4));
      const dst = d.array(new Float32Array(4));
      fail(m, d, xs);
      await settle();
      expect(errorOf(xs)).toBeInstanceOf(TypeError);
      await d.fuse(() => {
        void m.reset!({ dst: xs }, 4);
        void m.copy!({ dst, xs }, 4, { constants: { GAIN: 3 } });
      });
      expect([...(await dst.read())]).toEqual([21, 21, 21, 21]);
    } finally {
      await d.dispose();
    }
  });
  it('rejects a draw before creating a context or changing a previous image, until set(data)', async () => {
    const m = await load(ENTRIES);
    const d = await createDevice({ prefer: ['cpu'] });
    class Canvas {
      width = 1;
      height = 1;
      contexts = 0;
      pixels: Uint8ClampedArray = new Uint8ClampedArray(4);
      getContext(kind: string) {
        this.contexts++;
        if (kind !== '2d') return null;
        return {
          createImageData: () => ({ data: new Uint8ClampedArray(4) }),
          putImageData: (image: { data: Uint8ClampedArray }) => {
            this.pixels = image.data;
          },
        };
      }
    }
    const old = Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas');
    Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, value: Canvas });
    try {
      const xs = d.array(new Float32Array(4).fill(0.5));
      const canvas = new Canvas();
      await m.color!(canvas, { xs });
      expect([...canvas.pixels]).toEqual([128, 0, 0, 255]);
      fail(m, d, xs);
      await settle();
      const e = errorOf(xs);
      expect(e).toBeInstanceOf(TypeError);
      const contexts = canvas.contexts;
      expect(await capture(m.color!(canvas, { xs }))).toBe(e);
      expect([...canvas.pixels]).toEqual([128, 0, 0, 255]);
      expect(canvas.contexts).toBe(contexts);
      const fresh = new Canvas();
      expect(await capture(m.color!(fresh, { xs }))).toBe(e);
      expect(fresh.contexts).toBe(0);
      await m.sizeColor!(canvas, { xs });
      expect([...canvas.pixels]).toEqual([255, 0, 0, 255]);
      // A whole set(data) recovers it (A7, decision b).
      xs.set(new Float32Array(4).fill(0.25));
      await m.color!(canvas, { xs });
      expect([...canvas.pixels]).toEqual([64, 0, 0, 255]);
    } finally {
      if (old === undefined) Reflect.deleteProperty(globalThis, 'OffscreenCanvas');
      else Object.defineProperty(globalThis, 'OffscreenCanvas', old);
      await d.dispose();
    }
  });
});

const HELD = `"use typeshade";
export function append(out: array<u32>, n: u32): u32 {
  for (let i: u32 = 0; i < n; i++) out.push(i);
  return out.length;
}
export function appendOnly(out: array<u32>, n: u32) {
  for (let i: u32 = 0; i < n; i++) out.push(i);
}
export function words(out: array<u32>, n: u32) {
  for (let i: u32 = 0; i < n; i++) out[i] = 1;
}
export function bounds(out: array<u32>, n: array<u32>) {
  for (let i: u32 = 0; i < n[0]; i++) out[i] = i;
}
`;

describe('held data dependencies (0129)', () => {
  it('keeps an unresolved pushed-count read conservative while a proven append-only call recovers', async () => {
    const m = await load(HELD);
    const d = await createDevice({ prefer: ['cpu'] });
    try {
      const out = d.array(new Uint32Array(4));
      const length = d.array(Uint32Array.of(0));
      fail(m, d, out, 'words');
      void m.append!({ array: out, length }, 2);
      // The failed call also marked its held word. A separate writer recovers that word first.
      void m.words!(length, 1);
      void m.appendOnly!({ array: out, length }, 2);
      await settle();
      expect(errorOf(out)).toBeUndefined();
      expect([...(await out.read())]).toEqual([0, 0, 1, 0]);
    } finally {
      await d.dispose();
    }
  });

  it('reads the held length even when the destination is write-only', async () => {
    const m = await load(HELD);
    const d = await createDevice({ prefer: ['cpu'] });
    try {
      const out = d.array(new Uint32Array(4));
      const length = d.array(Uint32Array.of(0));
      fail(m, d, length, 'words', 2);
      void m.append!({ array: out, length }, 2);
      await settle();
      const e = errorOf(length);
      expect(e).toBeInstanceOf(TypeError);
      expect(await capture(out.read())).toBe(e);
      expect(await capture(length.read())).toBe(e);
    } finally {
      await d.dispose();
    }
  });
  it('reads a device-held bound before executing the loop', async () => {
    const m = await load(HELD);
    const d = await createDevice({ prefer: ['cpu'] });
    try {
      const out = d.array(new Uint32Array(4));
      const n = d.array(Uint32Array.of(3));
      fail(m, d, n, 'words', 2);
      void m.bounds!(out, n);
      await settle();
      const e = errorOf(n);
      expect(e).toBeInstanceOf(TypeError);
      expect(await capture(out.read())).toBe(e);
    } finally {
      await d.dispose();
    }
  });
});

it('keeps same-named linked helpers distinct for read/write and write-only places', async () => {
  const documents = {
    '/failure/set.shade.ts': `"use typeshade"; export function touch(@out x: f32) { x = 7.; }`,
    '/failure/update.shade.ts': `"use typeshade"; export function touch(@inout x: f32) { x += 1.; }`,
  };
  const source = `${SOURCE}
import { touch as set } from "./set.shade";
import { touch as increment } from "./update.shade";
export function setAll(out: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) set(out[i]);
}
export function incrementAll(out: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) increment(out[i]);
}
`;
  const m = await load(source, true, false, documents);
  const d = await createDevice({ prefer: ['cpu'] });
  try {
    const a = d.array(new Float32Array(4));
    fail(m, d, a);
    void m.incrementAll!(a);
    await settle();
    expect(errorOf(a)).toBeInstanceOf(TypeError);
    const b = d.array(new Float32Array(4));
    fail(m, d, b);
    void m.setAll!(b);
    await settle();
    expect(errorOf(b)).toBeUndefined();
    expect([...(await b.read())]).toEqual([7, 7, 7, 7]);
  } finally {
    await d.dispose();
  }
});

for (const [name, body] of [
  ['branch', 'for (let i: u32 = 0; i < out.length; i++) { if (xs[i] > 0.) out[i] = 1.; }'],
  ['index', 'for (let i: u32 = 0; i < xs.length; i++) out[u32(xs[i])] = 1.;'],
  ['later store', 'for (let i: u32 = 0; i < out.length; i++) out[i] = 0.; out[0] = xs[0];'],
  [
    'reduction',
    'let sum = 0.; for (const value of xs) sum += value; for (let i: u32 = 0; i < out.length; i++) out[i] = sum;',
  ],
] as const) {
  it(`includes ${name} reads outside a single loop-output hint`, async () => {
    const m = await load(
      `${SOURCE}\nexport function run(out: array<f32>, xs: array<f32>) { ${body} }`,
    );
    const d = await createDevice({ prefer: ['cpu'] });
    try {
      const xs = d.array(new Float32Array(4));
      const out = d.array(new Float32Array(4).fill(9));
      fail(m, d, xs);
      void m.run!(out, xs);
      await settle();
      const e = errorOf(xs);
      expect(e).toBeInstanceOf(TypeError);
      expect(await capture(out.read())).toBe(e);
      expect(residentState(out)?.host).toEqual(new Float32Array(4).fill(9));
    } finally {
      await d.dispose();
    }
  });
}

it('checks a by-value aggregate helper argument and an atomic read/write, but permits atomic stores', async () => {
  const source = `"use typeshade";
export class Cell { value: f32 = 0.; }
function constant(cell: Cell): f32 { return 7.; }
export function copy(out: array<f32>, xs: array<Cell>) {
  for (let i: u32 = 0; i < out.length; i++) out[i] = constant(xs[i]);
}
export function cells(out: array<Cell>, n: u32) {
  for (let i: u32 = 0; i < n; i++) out[i].value = 1.;
}
declare const dst: storage<array<atomic<u32>>, "read_write">;
@compute([1]) export function clear(gid: builtin<"global_invocation_id">) {
  if (gid.x < dst.length) atomicStore(dst[gid.x], 7);
}
@compute([1]) export function increment(gid: builtin<"global_invocation_id">) {
  if (gid.x < dst.length) atomicAdd(dst[gid.x], 1);
}
export function words(out: array<u32>, n: u32) {
  for (let i: u32 = 0; i < n; i++) out[i] = 1;
}
`;
  const m = await load(source);
  const d = await createDevice({ prefer: ['cpu'] });
  const use = d.use();
  try {
    // An array of structs is a Buffer of its class (Amendment A11, Q4).
    const Cell = m.Cell as unknown as abstract new () => { value: number };
    const xs = array(
      Cell,
      Array.from({ length: 4 }, () => ({ value: 2 })),
    );
    const out = d.array(new Float32Array(4));
    void m.cells!(xs, d.array(Uint32Array.of(5)));
    void m.copy!(out, xs);
    await settle();
    expect(errorOf(out)).toBeInstanceOf(TypeError);
    const dst = d.array(new Uint32Array(4));
    fail(m, d, dst, 'words');
    void m.increment!({ dst }, 4);
    await settle();
    expect(errorOf(dst)).toBeInstanceOf(TypeError);
    const fresh = d.array(new Uint32Array(4));
    fail(m, d, fresh, 'words');
    void m.clear!({ dst: fresh }, 4);
    await settle();
    expect(errorOf(fresh)).toBeUndefined();
    expect([...(await fresh.read())]).toEqual([7, 7, 7, 7]);
  } finally {
    use.dispose();
    await d.dispose();
  }
});
