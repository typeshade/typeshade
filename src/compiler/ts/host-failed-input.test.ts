// Verifies: Rule 11.8 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 11.13 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 12.7 (docs/language-design.md; traced in reqs/).
// Generated calls propagate failed content inputs (0129), while independent work and writers recover.
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hostFace } from './host-face.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';
import { createDevice } from '../../runtime/device.js';
import { residentState } from '../../core/resident.js';

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
async function failed(m: Record<string, Call>, a: unknown): Promise<unknown> {
  const e = await capture(m.fill!(a, 5, 9));
  expect(e).toBeInstanceOf(TypeError);
  expect(residentState(a)?.error).toBe(e);
  return e;
}

describe('generated calls admit healthy content dependencies (0129)', () => {
  for (const fuse of [true, false]) {
    it(`propagates the queued producer error through two consumers; fuse facts ${fuse}`, async () => {
      const m = await load(SOURCE, fuse);
      const d = await createDevice({ prefer: ['cpu'] });
      try {
        const a = d.array(new Float32Array(4).fill(9));
        const b = d.array(new Float32Array(4).fill(77));
        const c = d.array(new Float32Array(4));
        const producer = capture(m.fill!(a, 5, 1));
        const consumer = capture(m.twice!(b, a));
        const last = capture(m.twice!(c, b));
        const e = await producer;
        expect(e).toBeInstanceOf(TypeError);
        expect(await consumer).toBe(e);
        expect(await last).toBe(e);
        expect(await capture(c.read())).toBe(e);
        expect(residentState(b)?.host).toEqual(new Float32Array(4).fill(77));
      } finally {
        await d.dispose();
      }
    });
  }
  for (const n of [0, 1, 4]) {
    it(`preserves recovery after a successful write-only call of ${n} elements`, async () => {
      const m = await load(SOURCE);
      const d = await createDevice({ prefer: ['cpu'] });
      try {
        const a = d.array(new Float32Array(4).fill(3));
        await failed(m, a);
        await m.fill!(a, n, 7);
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
        const e = await failed(m, a);
        expect(await capture(m[name]!(b, a))).toBe(e);
        expect(await capture(b.read())).toBe(e);
        expect(residentState(b)?.host).toEqual(new Float32Array(4).fill(17));
      } finally {
        await d.dispose();
      }
    });
  }
  it('refuses read/write recovery and keeps whole host writes from clearing errors', async () => {
    const m = await load(SOURCE);
    const d = await createDevice({ prefer: ['cpu'] });
    try {
      const a = d.array(new Float32Array(4));
      const e = await failed(m, a);
      a.write(new Float32Array(4).fill(2));
      expect(await capture(a.read())).toBe(e);
      expect(await capture(m.update!(a))).toBe(e);
      expect(await capture(a.read())).toBe(e);
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
        const e = await failed(m, a);
        await m[name]!(b, a);
        expect([...(await b.read())]).toEqual(new Array(4).fill(value));
        expect(await capture(a.read())).toBe(e);
      } finally {
        await d.dispose();
      }
    });
  }
  it('selects failures in parameter order after ordinary validation', async () => {
    const m = await load(SOURCE);
    const d = await createDevice({ prefer: ['cpu'] });
    try {
      const a = d.array(new Float32Array(4));
      const b = d.array(new Float32Array(4));
      const out = d.array(new Float32Array(4));
      const first = await failed(m, a);
      const second = await failed(m, b);
      expect(first).not.toBe(second);
      expect(await capture(m.combine!(out, b, a))).toBe(second);
      const alias = await capture(m.combine!(out, a, a));
      expect(alias).toBeInstanceOf(TypeError);
      expect(alias).not.toBe(first);
      expect(String(alias)).toContain('same resident array');
      const shape = await capture(m.twice!(out, d.array(new Float32Array(2))));
      expect(shape).toBeInstanceOf(TypeError);
      expect(shape).not.toBe(second);
    } finally {
      await d.dispose();
    }
  });
  it('loads a legacy artifact but treats missing facts as content reads', async () => {
    const m = await load(SOURCE, true, true);
    const d = await createDevice({ prefer: ['cpu'] });
    try {
      const a = d.array(new Float32Array(4));
      const e = await failed(m, a);
      expect(await capture(m.fill!(a, 4, 7))).toBe(e);
    } finally {
      await d.dispose();
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
      const failure = capture(m.fill!(a, 5, 1));
      await Promise.all([m.fill!(b, 4, 2), m.fill!(c, 4, 3)]);
      expect(await failure).toBeInstanceOf(TypeError);
      expect([...(await b.read())]).toEqual([2, 2, 2, 2]);
      expect([...(await c.read())]).toEqual([3, 3, 3, 3]);
    } finally {
      await d.dispose();
      await other.dispose();
    }
  });
  it('admits an earlier recovery in a plan without clearing real errors early', async () => {
    const m = await load(SOURCE);
    const d = await createDevice({ prefer: ['cpu'] });
    try {
      const a = d.array(new Float32Array(4));
      const b = d.array(new Float32Array(4));
      const e = await failed(m, a);
      const calls: Promise<unknown>[] = [];
      const plan = d.fuse(() => {
        calls.push(m.fill!(a, 4, 3));
        calls.push(m.twice!(b, a));
        expect(residentState(a)?.error).toBe(e);
      });
      await plan;
      await Promise.all(calls);
      expect([...(await b.read())]).toEqual([6, 6, 6, 6]);
    } finally {
      await d.dispose();
    }
  });
  it('rejects the whole plan before independent writes when a content input is failed', async () => {
    const m = await load(SOURCE);
    const d = await createDevice({ prefer: ['cpu'] });
    try {
      const a = d.array(new Float32Array(4));
      const b = d.array(new Float32Array(4).fill(11));
      const c = d.array(new Float32Array(4).fill(13));
      const e = await failed(m, a);
      const calls: Promise<unknown>[] = [];
      const plan = d.fuse(() => {
        calls.push(capture(m.fill!(c, 4, 3)));
        calls.push(capture(m.twice!(b, a)));
        calls.push(capture(m.fill!(a, 4, 2)));
      });
      expect(await capture(plan)).toBe(e);
      expect(await Promise.all(calls)).toEqual([e, e, e]);
      expect(await capture(b.read())).toBe(e);
      expect(await capture(c.read())).toBe(e);
      expect(residentState(c)?.host).toEqual(new Float32Array(4).fill(13));
    } finally {
      await d.dispose();
    }
  });
});

const ENTRIES = `"use typeshade";
const GAIN: override<f32> = 2.;
declare const xs: storage<array<f32>>;
declare const other: storage<array<f32>>;
declare const dst: storage<array<f32>, "read_write">;
function sample(i: u32): f32 { return xs[i]; }
export const copy = compute([1], function copy(gid: builtin<"global_invocation_id", vec3u>) {
  if (gid.x < dst.length) dst[gid.x] = GAIN * sample(gid.x);
});
export const sum = compute([1], function sum(gid: builtin<"global_invocation_id", vec3u>) {
  if (gid.x < dst.length) dst[gid.x] = xs[gid.x] + other[gid.x];
});
export const reset = compute([1], function reset(gid: builtin<"global_invocation_id", vec3u>) {
  if (gid.x < dst.length) dst[gid.x] = 7.;
});
export const mutate = compute([1], function mutate(gid: builtin<"global_invocation_id", vec3u>) {
  if (gid.x < dst.length) dst[gid.x] += 1.;
});
export const capacity = compute([1], function capacity(gid: builtin<"global_invocation_id", vec3u>) {
  if (gid.x < dst.length) dst[gid.x] = f32(xs.length);
});
export const color = fragment(function color(): vec4 { return vec4(xs[0], 0., 0., 1.); });
export const sizeColor = fragment(function sizeColor(): vec4 { return vec4(f32(xs.length) / 4., 0., 0., 1.); });
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
      const e = await failed(m, xs);
      expect(await capture(m.copy!({ dst, xs }, 4, { constants: { GAIN: 3 } }))).toBe(e);
      expect(await capture(dst.read())).toBe(e);
      expect(await capture(m.mutate!({ dst }, 4))).toBe(e);
      await m.reset!({ dst }, 4);
      expect([...(await dst.read())]).toEqual([7, 7, 7, 7]);
      await m.capacity!({ xs, dst }, 4);
      expect([...(await dst.read())]).toEqual([4, 4, 4, 4]);
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
      const counts = d.array(Uint32Array.of(4, 1, 1));
      const first = await failed(m, xs);
      await failed(m, other);
      const indirect = await capture(m.words!(counts, 4));
      expect(indirect).toBeInstanceOf(TypeError);
      expect(await capture(m.sum!({ other, dst, xs }, { indirect: counts }))).toBe(first);
      expect(await capture(m.reset!({ dst }, { indirect: counts }))).toBe(indirect);
      expect(await capture(dst.read())).toBe(indirect);
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
      await failed(m, xs);
      await d.fuse(() => {
        void m.reset!({ dst: xs }, 4);
        void m.copy!({ dst, xs }, 4, { constants: { GAIN: 3 } });
      });
      expect([...(await dst.read())]).toEqual([21, 21, 21, 21]);
    } finally {
      await d.dispose();
    }
  });
  it('rejects a draw before creating a context or changing a previous image', async () => {
    const m = await load(ENTRIES);
    const d = await createDevice({ prefer: ['cpu'] });
    class Canvas {
      width = 1;
      height = 1;
      contexts = 0;
      pixels = new Uint8ClampedArray(4);
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
      const e = await failed(m, xs);
      const contexts = canvas.contexts;
      expect(await capture(m.color!(canvas, { xs }))).toBe(e);
      expect([...canvas.pixels]).toEqual([128, 0, 0, 255]);
      expect(canvas.contexts).toBe(contexts);
      const fresh = new Canvas();
      expect(await capture(m.color!(fresh, { xs }))).toBe(e);
      expect(fresh.contexts).toBe(0);
      await m.sizeColor!(canvas, { xs });
      expect([...canvas.pixels]).toEqual([255, 0, 0, 255]);
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
      const e = await capture(m.words!(out, 5));
      expect(e).toBeInstanceOf(TypeError);
      expect(await capture(m.append!({ array: out, length }, 2))).toBe(e);
      // The failed call also marked its held word. A separate writer recovers that word first.
      await m.words!(length, 1);
      await m.appendOnly!({ array: out, length }, 2);
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
      const e = await capture(m.words!(length, 2));
      expect(e).toBeInstanceOf(TypeError);
      expect(await capture(m.append!({ array: out, length }, 2))).toBe(e);
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
      const e = await capture(m.words!(n, 2));
      expect(e).toBeInstanceOf(TypeError);
      expect(await capture(m.bounds!(out, n))).toBe(e);
      expect(await capture(out.read())).toBe(e);
    } finally {
      await d.dispose();
    }
  });
});

it('keeps same-named linked helpers distinct for read/write and write-only places', async () => {
  const documents = {
    '/failure/set.shade.ts': `"use typeshade"; export function touch(x: out<f32>) { x = 7.; }`,
    '/failure/update.shade.ts': `"use typeshade"; export function touch(x: inout<f32>) { x += 1.; }`,
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
    const e = await failed(m, a);
    expect(await capture(m.incrementAll!(a))).toBe(e);
    await m.setAll!(a);
    expect([...(await a.read())]).toEqual([7, 7, 7, 7]);
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
      const e = await failed(m, xs);
      expect(await capture(m.run!(out, xs))).toBe(e);
      expect(await capture(out.read())).toBe(e);
      expect(residentState(out)?.host).toEqual(new Float32Array(4).fill(9));
    } finally {
      await d.dispose();
    }
  });
}

it('checks a by-value aggregate helper argument and an atomic read/write, but permits atomic stores', async () => {
  const source = `"use typeshade";
class Cell { value!: f32; }
function constant(cell: Cell): f32 { return 7.; }
export function copy(out: array<f32>, xs: array<Cell>) {
  for (let i: u32 = 0; i < out.length; i++) out[i] = constant(xs[i]);
}
export function cells(out: array<Cell>, n: u32) {
  for (let i: u32 = 0; i < n; i++) out[i].value = 1.;
}
declare const dst: storage<array<atomic<u32>>, "read_write">;
export const clear = compute([1], function clear(gid: builtin<"global_invocation_id", vec3u>) {
  if (gid.x < dst.length) atomicStore(dst[gid.x], 7);
});
export const increment = compute([1], function increment(gid: builtin<"global_invocation_id", vec3u>) {
  if (gid.x < dst.length) atomicAdd(dst[gid.x], 1);
});
export function words(out: array<u32>, n: u32) {
  for (let i: u32 = 0; i < n; i++) out[i] = 1;
}
`;
  const m = await load(source);
  const d = await createDevice({ prefer: ['cpu'] });
  try {
    const xs = d.array(Array.from({ length: 4 }, () => ({ value: 2 })));
    const out = d.array(new Float32Array(4));
    const e = await capture(m.cells!(xs, 5));
    expect(e).toBeInstanceOf(TypeError);
    expect(await capture(m.copy!(out, xs))).toBe(e);
    const dst = d.array(new Uint32Array(4));
    const atomicError = await capture(m.words!(dst, 5));
    expect(atomicError).toBeInstanceOf(TypeError);
    expect(await capture(m.increment!({ dst }, 4))).toBe(atomicError);
    await m.clear!({ dst }, 4);
    expect([...(await dst.read())]).toEqual([7, 7, 7, 7]);
  } finally {
    await d.dispose();
  }
});
