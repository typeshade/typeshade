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
import { array, configure, uniform } from ${JSON.stringify(join(root, 'src/runtime.ts'))};
import { kernelQueue } from ${JSON.stringify(join(root, 'src/core/resident.ts'))};
export { m, array, configure, uniform, kernelQueue };`,
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
  /** The byte counts of the `writeBuffer` calls the second `age` made, WebGPU only. */
  writes: number[];
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
    };
    array(cls: unknown, data: unknown[]): Buffer;
    configure(o: { prefer: string[] }): void;
    uniform(cls: unknown, init: unknown): { dt: { set(v: number): void } };
    kernelQueue: { held: unknown[] };
  };
  const { m } = g;
  // A kernel function on a Buffer of structs has no WebGL2 tier (Rule 11.8): on WebGL2 it runs on
  // the CPU tier, and the entry runs its WebGL2 pass program.
  g.configure({ prefer: input.tier === 'webgl2' ? ['webgl2', 'cpu'] : [input.tier] });
  const out: Outcome = { bits: [], returned: [], early: false, writes: [] };
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
      if (counting) out.writes.push(d.byteLength);
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
    // The first call wrote xs on the device; the set reaches only the second call (A5, default 3).
    xs.at(7)!.life!.set(100);
    counting = true;
    out.returned.push(String(m.age(xs, 0.25)));
    out.early = g.kernelQueue.held.length !== 2;
    out.returned.push(String(m.move(xs, p)));
    p.dt.set(1000);
    const first = await xs.read();
    counting = false;
    m.ps.set(data.slice(0, 130));
    m.camera.set({ dt: 2, drag: 0.5 });
    out.returned.push(String(m.step({ camera: m.camera, ps: m.ps }, [3])));
    m.camera.set({ dt: 4 });
    out.returned.push(String(m.step({ camera: m.camera, ps: m.ps }, [3])));
    const second = await m.ps.read();
    const f = new Float32Array(1);
    const u = new Uint32Array(f.buffer);
    for (const e of [...first, ...second])
      for (const x of [...e.pos, e.life]) {
        f[0] = x;
        out.bits.push(u[0]!);
      }
  } catch (e) {
    out.error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  } finally {
    if (queue !== undefined && original !== undefined) queue.prototype.writeBuffer = original;
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
    for (const tier of ['webgpu', 'webgl2'] as const) {
      const o = await run(tier);
      check(o.error === undefined, `${tier} runs${o.error ? `: ${o.error}` : ''}`);
      check(
        o.returned.length === 5 && o.returned.every((r) => r === 'undefined'),
        `${tier}: every call on a resource returns nothing`,
      );
      check(!o.early, `${tier}: the calls are held until the checkpoint ends`);
      const same = o.bits.length === cpu.bits.length && o.bits.every((b, i) => b === cpu.bits[i]);
      check(same, `${tier}: ${o.bits.length / 4} elements bit for bit against the CPU tier`);
      // The set of element 7 after a call that wrote xs on the device is one range of one
      // element (32 bytes), written before the second call.
      if (tier === 'webgpu')
        check(
          o.writes.includes(32),
          `webgpu: the dirty element is one writeBuffer of its range (${o.writes.join(', ')} bytes)`,
        );
    }
    return failures;
  } finally {
    server.close();
  }
}
