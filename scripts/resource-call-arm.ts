// Browser evidence for change 0138, milestone 3 (R2, R8; Amendment A5): a call on a resource.
// The generated module of one shader source is called with `Buffer`s, a `Uniform` and the
// exported bindings, on WebGPU, WebGL2 and the CPU tier. Each call is recorded and returns
// nothing; a `set` between two calls reaches only the second (A5, default 3); `read()` gives what
// the calls wrote. Every element read back is held bit for bit to the same calls on the CPU tier,
// the oracle's executable form (Rule 11.7), as Rule 11.13 holds a plan to the calls run apart. On
// WebGPU, a dirty range of a Buffer that a call wrote on the device is one `writeBuffer` of that
// range's bytes (R8), counted on the real queue. The CPU unit suite
// (`src/runtime/resource-call.test.ts`) reads both halves of the source and the host view.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Page } from 'playwright';
import { hostFace } from '../src/compiler/ts/host-face.js';
import { createTypeshadeLanguageService } from '../src/language-service/service.js';

const SOURCE = `"use typeshade";

export class Particle {
  pos: vec3 = vec3(0.);
  life: f32 = 0.;
}

export class Params {
  dt: f32 = 0.;
  drag: f32 = 0.;
}

export declare const camera: uniform<Params>;
export declare const ps: storage<array<Particle>, "read_write">;

export function age(xs: array<Particle>, dt: f32): void {
  for (let i = 0; i < xs.length; i++) {
    xs[i].life = xs[i].life + dt;
  }
}

export function move(xs: array<Particle>, p: Params): void {
  for (let i = 0; i < xs.length; i++) {
    xs[i].life = xs[i].life * p.dt;
    xs[i].pos.x = xs[i].pos.x - p.drag;
  }
}

export function lives(xs: array<Particle>, out: array<f32>): void {
  for (let i = 0; i < xs.length; i++) {
    out[i] = xs[i].life;
  }
}

export function scale(xs: array<f32>, k: f32): void {
  for (let i = 0; i < xs.length; i++) {
    xs[i] = xs[i] * k;
  }
}

@compute([64])
export function step(id: builtin<"global_invocation_id">) {
  if (id.x < ps.length) {
    ps[id.x].life = ps[id.x].life + camera.dt;
    ps[id.x].pos.y = ps[id.x].pos.y * camera.drag;
  }
}
`;

interface Bundler {
  build(options: { entrypoints: string[]; target: 'browser'; format: 'esm' }): Promise<{
    success: boolean;
    logs: unknown;
    outputs: { text(): Promise<string> }[];
  }>;
}

async function bundle(): Promise<string> {
  const root = resolve(import.meta.dirname, '..');
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-resource-call-'));
  try {
    const face = hostFace(SOURCE, {
      fileName: '/scene.shade.ts',
      runtime: join(root, 'src/core/host-runtime.ts'),
    });
    const ls = createTypeshadeLanguageService();
    ls.openDocument('/scene.shade.ts', SOURCE);
    if (
      face.code === undefined ||
      face.diagnostics.length !== 0 ||
      ls.getDiagnostics('/scene.shade.ts').length !== 0
    )
      throw new Error('the resource call source must compile in both the compiler and the editor');
    writeFileSync(join(dir, 'face.js'), face.code);
    const entry = join(dir, 'entry.ts');
    writeFileSync(
      entry,
      `import * as m from './face.js';
import { array, configure, createDevice, uniform } from ${JSON.stringify(join(root, 'src/runtime.ts'))};
import { kernelQueue } from ${JSON.stringify(join(root, 'src/core/resident.ts'))};
export { m, array, configure, createDevice, uniform, kernelQueue };`,
    );
    const bun = (globalThis as unknown as { Bun: Bundler }).Bun;
    const built = await bun.build({ entrypoints: [entry], target: 'browser', format: 'esm' });
    if (!built.success || built.outputs.length !== 1)
      throw new Error(`resource call arm bundle failed: ${JSON.stringify(built.logs)}`);
    return await built.outputs[0]!.text();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

interface Outcome {
  /** The bits of every element read back, in order: `pos` then `life`, per element. */
  bits: number[];
  /** What each call returned: `undefined` for every recorded call. */
  returned: string[];
  /** Whether a call ran before the end of the microtask checkpoint. */
  early: boolean;
  /** The `offset:bytes` of each `writeBuffer` the call after the set of element 7 made. */
  writes: string[];
  /** Whether a set between a writing call and read() was refused (the owner's decision of
   *  2026-11-11, which the review of #1236 asked for as B1). */
  refused: boolean;
  /** The elements of the first read that differ from the hand-computed values. */
  wrong: number;
  /** What the two calls on a read-only array saw at element 7: before and after a set. */
  seen: number[];
  /** R3: the bits of the exported binding after two entry calls under \`device.use()\`. */
  deviceBits: number[];
  /** R3: a call that took a Buffer of one device and a Resident of another was refused. */
  mixed: boolean;
  /** R3: what a call on each of two devices read of the exported binding, after a set between. */
  twoDevices: number[];
  /** R3: a call on another device between a call that wrote the binding and read() was refused. */
  crossed: boolean;
  /** A5, default 6: the WebGL2 calls after the last dispatch of a submission, and those of the
   *  read() after it. Empty on the other tiers. */
  glEnd: string[];
  glRead: string[];
  /** S3 of the review of #1238: a call with plain data only that wrote a Resident, and the WebGL2
   *  calls of its read(): no fence, since the call read its values back. */
  plainValues: number[];
  plainRead: string[];
  /** S2 of the review: what a call on another device read of the exported binding after the
   *  device whose call wrote it was disposed, or the error. */
  afterDispose: string;
  error?: string;
}

// Serialized by Playwright. It reaches the module's exports through the bundle only.
async function runInPage(input: {
  url: string;
  tier: 'webgpu' | 'webgl2' | 'cpu';
}): Promise<Outcome> {
  type Buffer = {
    at(i: number): Record<string, { set(...v: number[]): void }>;
    read(): Promise<{ pos: number[]; life: number }[]>;
    resize(n: number): void;
    set(d: unknown[]): void;
  };
  const g = (await import(/* @vite-ignore */ input.url)) as {
    m: Record<string, unknown> & {
      Particle: unknown;
      Params: unknown;
      camera: { set(v: unknown): void };
      ps: Buffer;
      age(xs: unknown, dt: number): unknown;
      move(xs: unknown, p: unknown): unknown;
      step(b: unknown, w: unknown): unknown;
      lives(xs: unknown, out: unknown): unknown;
      scale(xs: unknown, k: number): Promise<unknown>;
    };
    array(cls: unknown, data?: unknown[]): Buffer;
    configure(o: { prefer: string[] }): void;
    createDevice(o: { prefer: string[] }): Promise<{
      use(): { dispose(): void };
      array(v: Float32Array): { read(): Promise<Float32Array> };
      dispose(): Promise<void>;
    }>;
    uniform(cls: unknown, init: unknown): { dt: { set(v: number): void } };
    kernelQueue: { held: unknown[]; idle(): Promise<unknown> };
  };
  const { m } = g;
  // A kernel function on a Buffer of structs has no WebGL2 tier (Rule 11.8): on WebGL2 it runs on
  // the CPU tier, and the entry runs its WebGL2 pass program.
  g.configure({ prefer: input.tier === 'webgl2' ? ['webgl2', 'cpu'] : [input.tier] });
  const out: Outcome = {
    bits: [],
    returned: [],
    early: false,
    writes: [],
    refused: false,
    wrong: 0,
    seen: [],
    deviceBits: [],
    mixed: false,
    twoDevices: [],
    crossed: false,
    glEnd: [],
    glRead: [],
    plainValues: [],
    plainRead: [],
    afterDispose: '',
  };
  // Every flush and fence of the WebGL2 context, in order.
  const glLog: string[] = [];
  const GL = (
    globalThis as unknown as { WebGL2RenderingContext?: { prototype: Record<string, unknown> } }
  ).WebGL2RenderingContext;
  const glOriginal: Record<string, unknown> = {};
  if (GL !== undefined)
    for (const name of ['flush', 'fenceSync', 'clientWaitSync']) {
      const f = GL.prototype[name] as (this: unknown, ...a: unknown[]) => unknown;
      glOriginal[name] = f;
      GL.prototype[name] = function (this: unknown, ...a: unknown[]) {
        glLog.push(name);
        return f.apply(this, a);
      };
    }
  const queue = (globalThis as { GPUQueue?: { prototype: { writeBuffer: unknown } } }).GPUQueue;
  const original = queue?.prototype.writeBuffer as
    ((this: unknown, b: unknown, o: number, d: ArrayBuffer | ArrayBufferView) => void) | undefined;
  let counting = false;
  if (queue !== undefined && original !== undefined)
    queue.prototype.writeBuffer = function (
      this: unknown,
      b: unknown,
      o: number,
      d: ArrayBuffer | ArrayBufferView,
    ) {
      if (counting) out.writes.push(`${o}:${d.byteLength}`);
      return original.call(this, b, o, d);
    };
  try {
    const n = 300;
    const data = Array.from({ length: n }, (_, i) => ({
      pos: [i * 0.5, i * 0.25, -i],
      life: i * 0.125,
    }));
    const xs = g.array(m.Particle, data);
    const p = g.uniform(m.Params, { dt: 1.5, drag: 0.75 });
    out.returned.push(String(m.age(xs, 0.5)));
    out.early = g.kernelQueue.held.length !== 1;
    // move writes pos.x and life. A set of life, or of pos.y, which move does not write, would put
    // back the element's other fields from before the calls: it is refused until read() (B1).
    out.returned.push(String(m.move(xs, p)));
    try {
      xs.at(7)!.pos!.set(0, 0, 0);
    } catch (e) {
      out.refused = e instanceof TypeError;
    }
    p.dt.set(1000);
    const first = await xs.read();
    // Each element against its hand-computed value, in f32: life = (i/8 + 1/2) * 3/2, pos.x =
    // i/2 - 3/4, pos.y and pos.z as given.
    const r = Math.fround;
    first.forEach((e, i) => {
      const want = [r(r(i * 0.5) - 0.75), r(i * 0.25), r(-i), r(r(r(i * 0.125) + 0.5) * 1.5)];
      if ([...e.pos, e.life].some((x, k) => !Object.is(r(x), want[k]))) out.wrong++;
    });
    // After read() a set is allowed; the next call writes its one element range (R8).
    xs.at(7)!.life!.set(100);
    counting = true;
    out.returned.push(String(m.age(xs, 0)));
    const again = await xs.read();
    counting = false;
    // A set between two calls on an array they only read reaches the second only (A5, default 3).
    const ro = g.array(m.Particle, data);
    const one = g.array(new Float32Array(n)) as unknown as { read(): Promise<Float32Array> };
    const two = g.array(new Float32Array(n)) as unknown as { read(): Promise<Float32Array> };
    out.returned.push(String(m.lives(ro, one)));
    ro.at(7)!.life!.set(100);
    out.returned.push(String(m.lives(ro, two)));
    out.seen = [(await one.read())[7]!, (await two.read())[7]!];
    m.ps.set(data.slice(0, 130));
    m.camera.set({ dt: 2, drag: 0.5 });
    out.returned.push(String(m.step({ camera: m.camera, ps: m.ps }, [3])));
    m.camera.set({ dt: 4 });
    out.returned.push(String(m.step({ camera: m.camera, ps: m.ps }, [3])));
    const second = await m.ps.read();
    const f = new Float32Array(1);
    const u = new Uint32Array(f.buffer);
    const bitsOf = (es: { pos: number[]; life: number }[], into: number[]): void => {
      for (const e of es)
        for (const x of [...e.pos, e.life]) {
          f[0] = x;
          into.push(u[0]!);
        }
    };
    bitsOf([...first, ...again, ...second], out.bits);

    // R3: data decides the device. Each call below runs on a device it was given: the device in
    // use, or the device of its resources. The unit suite proves which device ran each call.
    const prefer = input.tier === 'webgl2' ? ['webgl2', 'cpu'] : [input.tier];
    const dev = await g.createDevice({ prefer });
    const other = await g.createDevice({ prefer: ['cpu'] });
    const within = <T>(d: typeof dev, f: () => T): T => {
      const use = d.use();
      try {
        return f();
      } finally {
        use.dispose();
      }
    };
    m.ps.set(data.slice(0, 130));
    m.camera.set({ dt: 2, drag: 0.5 });
    within(dev, () => m.step({ camera: m.camera, ps: m.ps }, [3]));
    m.camera.set({ dt: 4 });
    within(dev, () => m.step({ camera: m.camera, ps: m.ps }, [3]));
    // A5, default 6: the submission ends with a flush, and read() waits on a fence.
    await g.kernelQueue.idle();
    const mark = glLog.length;
    out.glEnd = glLog.slice(Math.max(0, mark - 1));
    bitsOf(await m.ps.read(), out.deviceBits);
    out.glRead = glLog.slice(mark);
    // A call between a call that wrote the binding on one device and read() on another is refused.
    within(dev, () => m.step({ camera: m.camera, ps: m.ps }, [3]));
    try {
      m.lives(m.ps, other.array(new Float32Array(130)));
    } catch (e) {
      out.crossed = e instanceof TypeError;
    }
    await m.ps.read();
    // A Buffer of one device and a Resident of another are refused at the call.
    const mine = within(dev, () => g.array(m.Particle, data.slice(0, 4)));
    try {
      m.lives(mine, other.array(new Float32Array(4)));
    } catch (e) {
      out.mixed = e instanceof TypeError;
    }
    // The exported binding uploads on each device that reads it, each taking the dirty ranges.
    m.ps.set(data.slice(0, 4));
    const a1 = within(dev, () => g.array(new Float32Array(4))) as unknown as {
      read(): Promise<Float32Array>;
    };
    const b1 = other.array(new Float32Array(4));
    m.lives(m.ps, a1);
    m.lives(m.ps, b1);
    m.ps.at(1)!.life!.set(5);
    const a2 = within(dev, () => g.array(new Float32Array(4))) as unknown as {
      read(): Promise<Float32Array>;
    };
    m.lives(m.ps, a2);
    m.ps.at(2)!.life!.set(7);
    const b2 = other.array(new Float32Array(4));
    m.lives(m.ps, b2);
    for (const r of [a1, b1, a2, b2]) out.twoDevices.push(...(await r.read()));
    // S3: a call with plain data only (a Resident is no resource of R2) keeps today's meaning: it
    // reads its values back inside the call, and its read() places no fence.
    const plain = within(dev, () => g.array(new Float32Array([1, 2, 3, 4]))) as unknown as {
      read(): Promise<Float32Array>;
    };
    await m.scale(plain, 2);
    await g.kernelQueue.idle();
    const plainMark = glLog.length;
    out.plainValues = Array.from(await plain.read());
    out.plainRead = glLog.slice(plainMark);
    // S2: a device disposed after its call wrote the exported binding lands the values first, and
    // drops its copy: a call on another device takes them.
    const gone = await g.createDevice({ prefer });
    m.ps.set(data.slice(0, 4));
    m.camera.set({ dt: 1, drag: 1 });
    within(gone, () => m.step({ camera: m.camera, ps: m.ps }, [1]));
    await gone.dispose();
    try {
      const after = other.array(new Float32Array(4));
      m.lives(m.ps, after);
      out.afterDispose = Array.from(await after.read()).join(', ');
    } catch (e) {
      out.afterDispose = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    }
    await dev.dispose();
    await other.dispose();
  } catch (e) {
    out.error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  } finally {
    if (queue !== undefined && original !== undefined) queue.prototype.writeBuffer = original;
    if (GL !== undefined)
      for (const [name, f] of Object.entries(glOriginal)) GL.prototype[name] = f;
    g.configure({ prefer: ['webgpu', 'webgl2', 'cpu'] });
  }
  return out;
}

export async function resourceCallArm(page: Page): Promise<number> {
  const body = await bundle();
  const server = createServer((req, res) => {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('content-type', 'text/javascript');
    res.statusCode = req.url === '/resource.js' ? 200 : 404;
    res.end(req.url === '/resource.js' ? body : 'not found');
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  let failures = 0;
  const check = (ok: boolean, what: string): void => {
    if (!ok) failures++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} resource call ${what}`);
  };
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/resource.js`;
    // A fresh page for each tier: the module's exported bindings live as long as the module.
    const run = async (tier: 'webgpu' | 'webgl2' | 'cpu'): Promise<Outcome> => {
      const p = await page.context().browser()!.newPage();
      try {
        await p.goto(page.url());
        return await p.evaluate(runInPage, { url, tier });
      } finally {
        await p.close();
      }
    };
    const cpu = await run('cpu');
    check(cpu.error === undefined, `cpu runs${cpu.error ? `: ${cpu.error}` : ''}`);
    for (const tier of ['cpu', 'webgpu', 'webgl2'] as const) {
      const o = tier === 'cpu' ? cpu : await run(tier);
      if (tier !== 'cpu')
        check(o.error === undefined, `${tier} runs${o.error ? `: ${o.error}` : ''}`);
      check(
        o.returned.length === 7 && o.returned.every((r) => r === 'undefined'),
        `${tier}: every call on a resource returns nothing`,
      );
      check(o.refused, `${tier}: a set between a writing call and read() is refused (B1)`);
      check(o.wrong === 0, `${tier}: every element is its hand-computed value (${o.wrong} differ)`);
      check(
        o.seen[0] === Math.fround(7 * 0.125) && o.seen[1] === 100,
        `${tier}: a set between two calls reaches only the second (${o.seen.join(', ')})`,
      );
      check(!o.early, `${tier}: the calls are held until the checkpoint ends`);
      if (tier !== 'cpu') {
        const same = o.bits.length === cpu.bits.length && o.bits.every((b, i) => b === cpu.bits[i]);
        check(same, `${tier}: ${o.bits.length / 4} elements bit for bit against the CPU tier`);
      }
      // R3: the entry calls under device.use() run on that device, and give the CPU tier's bits.
      check(
        o.deviceBits.length === 130 * 4 &&
          o.deviceBits.every((b, i) => b === cpu.bits[cpu.bits.length - 130 * 4 + i]),
        `${tier}: two entry calls under device.use() give the bits of the default owner's calls`,
      );
      check(o.mixed, `${tier}: a call that mixes devices is a TypeError (R3)`);
      check(
        o.crossed,
        `${tier}: a call on another device between a write of an exported binding and read() is refused`,
      );
      const r = Math.fround;
      const want = [
        ...[0, 1, 2, 3].map((i) => r(i * 0.125)),
        ...[0, 1, 2, 3].map((i) => r(i * 0.125)),
        r(0),
        5,
        r(0.25),
        r(0.375),
        r(0),
        5,
        7,
        r(0.375),
      ];
      check(
        o.twoDevices.length === 16 && o.twoDevices.every((x, i) => Object.is(x, want[i])),
        `${tier}: an exported binding uploads its dirty ranges on each device that reads it (${o.twoDevices.join(', ')})`,
      );
      check(
        o.plainValues.join() === '2,4,6,8' && !o.plainRead.includes('fenceSync'),
        `${tier}: a call with plain data only reads back inside the call, and its read() places no fence (${o.plainValues.join(', ')}; ${o.plainRead.includes('fenceSync') ? 'a fence at read()' : 'no fence'})`,
      );
      check(
        o.afterDispose === [1, 1.125, 1.25, 1.375].join(', '),
        `${tier}: a device disposed after a write of an exported binding lands it first (${o.afterDispose})`,
      );
      if (tier === 'webgl2') {
        check(
          o.glEnd.join() === 'flush',
          `webgl2: the submission ends with a flush (${o.glEnd.join(', ')})`,
        );
        check(
          o.glRead[0] === 'fenceSync' && o.glRead.includes('clientWaitSync'),
          `webgl2: read() waits on a fence (${o.glRead[0]}, then ${o.glRead.filter((c) => c === 'clientWaitSync').length} polls)`,
        );
      }
      // The set of element 7 after read() is one range of one element (16 bytes at 7 * 16),
      // written before the next call.
      if (tier === 'webgpu')
        check(
          o.writes.includes('112:16'),
          `webgpu: the dirty element is one writeBuffer of its range, 16 bytes at 112 (${o.writes.join(', ')})`,
        );
    }
    return failures;
  } finally {
    server.close();
  }
}
