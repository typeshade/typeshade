// Browser evidence for change 0129. Real API commands are counted, not a recording device.
// Healthy controls prove each tier executes; disabling admission must expose every dependency.
// The CPU unit suite separately covers compiler/editor parity and argument precedence.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Page } from 'playwright';
import { hostFace } from '../src/compiler/ts/host-face.js';
import { createTypeshadeLanguageService } from '../src/language-service/service.js';
import type { Device } from '../src/runtime/device.js';
import type { Resident, ResidentArrayState } from '../src/core/resident.js';

const SOURCE = `"use typeshade";
export function fill(out: array<f32>, n: u32, value: f32) {
  for (let i: u32 = 0; i < n; i++) out[i] = value;
}
export function twice(out: array<f32>, xs: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) out[i] = 2. * xs[i];
}
export function words(out: array<u32>, n: u32) {
  for (let i: u32 = 0; i < n; i++) out[i] = 1;
}
export function append(out: array<u32>, n: u32) {
  for (let i: u32 = 0; i < n; i++) out.push(i);
}
export function bounds(out: array<u32>, n: array<u32>) {
  for (let i: u32 = 0; i < n[0]; i++) out[i] = i;
}
declare const xs: storage<array<f32>>;
declare const dst: storage<array<f32>, "read_write">;
@compute([1]) export function copy(gid: builtin<"global_invocation_id", vec3u>) {
  if (gid.x < dst.length) dst[gid.x] = 3. * xs[gid.x];
}
@compute([1]) export function reset(gid: builtin<"global_invocation_id", vec3u>) {
  if (gid.x < dst.length) dst[gid.x] = 7.;
}
@fragment export function color(): vec4 { return vec4(xs[0], 0., 0., 1.); }
`;

interface Bundler {
  build(options: {
    entrypoints: string[];
    target: 'browser';
    format: 'esm';
    plugins: {
      name: string;
      setup(build: {
        onLoad(
          filter: { filter: RegExp },
          callback: (args: { path: string }) => { contents: string; loader: 'ts' },
        ): void;
      }): void;
    }[];
  }): Promise<{ success: boolean; logs: unknown; outputs: { text(): Promise<string> }[] }>;
}
interface Result {
  name: string;
  dependency: boolean;
  ok: boolean;
}

async function bundle(disabled: boolean): Promise<string> {
  const root = resolve(import.meta.dirname, '..');
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-failure-'));
  try {
    const face = hostFace(SOURCE, {
      fileName: '/failure.shade.ts',
      runtime: join(root, 'src/core/host-runtime.ts'),
      fuse: true,
    });
    const ls = createTypeshadeLanguageService();
    ls.openDocument('/failure.shade.ts', SOURCE);
    if (
      face.code === undefined ||
      face.diagnostics.length !== 0 ||
      ls.getDiagnostics('/failure.shade.ts').length !== 0
    )
      throw new Error('Resident failure control must compile in both compiler and editor');
    ls.closeDocument('/failure.shade.ts');
    writeFileSync(join(dir, 'face.js'), face.code);
    const entry = join(dir, 'entry.ts');
    writeFileSync(
      entry,
      `import * as m from './face.js';
import { createDevice } from ${JSON.stringify(join(root, 'src/runtime/device.ts'))};
import { residentState } from ${JSON.stringify(join(root, 'src/core/resident.ts'))};
export { m, createDevice, residentState };`,
    );
    const bun = (globalThis as unknown as { Bun: Bundler }).Bun;
    let mutations = 0;
    const built = await bun.build({
      entrypoints: [entry],
      target: 'browser',
      format: 'esm',
      plugins: disabled
        ? [
            {
              name: 'disable-only-incoming-admission',
              setup(build) {
                build.onLoad({ filter: /[/\\]host-failure\.ts$/ }, ({ path }) => {
                  const text = readFileSync(path, 'utf8');
                  const statement =
                    'for (const s of states) if (!supplied?.has(s) && s.error !== undefined) throw s.error;';
                  if (!text.includes(statement)) throw new Error('admission fault target moved');
                  mutations++;
                  return {
                    contents: text.replace(statement, 'void states; void supplied;'),
                    loader: 'ts',
                  };
                });
              },
            },
          ]
        : [],
    });
    if (!built.success || built.outputs.length !== 1 || mutations !== Number(disabled))
      throw new Error(`failure arm bundle/instrument failed: ${JSON.stringify(built.logs)}`);
    return await built.outputs[0]!.text();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Serialized by Playwright. Imports above are types only inside this function.
async function runInPage(input: {
  url: string;
  tier: 'webgpu' | 'webgl2' | 'cpu';
}): Promise<Result[]> {
  const g = (await import(/* @vite-ignore */ input.url)) as {
    m: Record<string, (...args: unknown[]) => Promise<unknown>>;
    createDevice(options: { prefer: string[] }): Promise<Device>;
    residentState(value: unknown): ResidentArrayState | undefined;
  };
  const { m, residentState } = g;
  const d = await g.createDevice({ prefer: [input.tier] });
  if (d.tier !== input.tier) throw new Error(`requested ${input.tier}, got ${d.tier}`);
  let commands = 0;
  const restore: (() => void)[] = [];
  const instrument = (owner: object | undefined, name: string) => {
    if (owner === undefined) return;
    const proto = owner as Record<string, unknown>;
    const original = proto[name];
    if (typeof original !== 'function') throw new Error(`missing command ${name}`);
    proto[name] = function (this: unknown, ...args: unknown[]) {
      commands++;
      return Reflect.apply(original, this, args);
    };
    restore.push(() => {
      proto[name] = original;
    });
  };
  const globals = globalThis as unknown as Record<string, { prototype: object } | undefined>;
  for (const [type, names] of [
    ['GPUQueue', ['submit', 'writeBuffer']],
    ['GPUComputePassEncoder', ['dispatchWorkgroups', 'dispatchWorkgroupsIndirect']],
    ['GPURenderPassEncoder', ['draw', 'drawIndexed']],
    [
      'WebGL2RenderingContext',
      [
        'drawArrays',
        'drawElements',
        'bufferData',
        'bufferSubData',
        'texImage2D',
        'texSubImage2D',
        'clear',
      ],
    ],
  ] as const)
    for (const name of names) instrument(globals[type]?.prototype, name);
  const result: Result[] = [];
  const add = (name: string, dependency: boolean, ok: boolean) =>
    result.push({ name, dependency, ok });
  const capture = (p: Promise<unknown>) =>
    p.then(
      () => undefined,
      (error: unknown) => error,
    );
  const equal = (actual: ArrayLike<number>, expected: number[]) =>
    JSON.stringify(Array.from(actual)) === JSON.stringify(expected);
  const floats = (v: number) => d.array(new Float32Array(4).fill(v));
  const poison = async (value: Resident<unknown>, words = false) => {
    const error = await capture(words ? m.words!(value, 99) : m.fill!(value, 99, 1));
    if (!(error instanceof TypeError) || residentState(value)?.error !== error)
      throw new Error('producer instrument did not reject and retain the same error');
    return error;
  };
  try {
    // A healthy execution must produce independent, nonzero data on the requested API.
    const xs = floats(2),
      dst = floats(0);
    const beforeHealthy = commands;
    await m.copy!({ xs, dst }, 4);
    add(
      'healthy compute',
      false,
      equal(await dst.read(), [6, 6, 6, 6]) && (input.tier === 'cpu' || commands > beforeHealthy),
    );
    const a = floats(3),
      b = floats(0),
      c = floats(0);
    const producer = capture(m.fill!(a, 99, 1));
    const start = commands;
    const consumer = capture(m.twice!(b, a));
    const last = capture(m.twice!(c, b));
    const e = await producer;
    const chain = await Promise.all([consumer, last, capture(c.read())]);
    add(
      'queued chain',
      true,
      e instanceof TypeError && chain.every((error) => error === e) && commands === start,
    );

    const planInput = floats(2),
      planOut = floats(0),
      independent = floats(0);
    const pe = await poison(planInput);
    const planned: Promise<unknown>[] = [];
    const beforePlan = commands;
    const plan = await capture(
      d.fuse(() => {
        planned.push(capture(m.fill!(independent, 4, 8)));
        d.fuse(() => {
          planned.push(capture(m.twice!(planOut, planInput)));
        });
      }),
    );
    add(
      'nested plan',
      true,
      plan === pe &&
        (await Promise.all(planned)).every((error) => error === pe) &&
        (await capture(planOut.read())) === pe &&
        commands === beforePlan,
    );
    await d.fuse(() => {
      void m.fill!(planInput, 4, 5);
      void m.twice!(planOut, planInput);
    });
    add('ordered plan recovery', false, equal(await planOut.read(), [10, 10, 10, 10]));
    await m.fill!(independent, 4, 9);
    add('independent work', false, equal(await independent.read(), [9, 9, 9, 9]));

    const ce = await poison(xs);
    const beforeCompute = commands;
    add(
      'compute dependency',
      true,
      (await capture(m.copy!({ dst, xs }, 4))) === ce &&
        (await capture(dst.read())) === ce &&
        commands === beforeCompute,
    );
    await m.reset!({ dst }, 4);
    add('write-only entry recovery', false, equal(await dst.read(), [7, 7, 7, 7]));

    const counts = d.array(Uint32Array.of(4, 1, 1));
    const indirectOut = floats(0);
    const beforeHealthyIndirect = commands;
    await m.reset!({ dst: indirectOut }, { indirect: counts });
    const indirectExecuted = input.tier === 'cpu' || commands > beforeHealthyIndirect;
    add(
      'healthy indirect count',
      false,
      equal(await indirectOut.read(), [7, 7, 7, 7]) && indirectExecuted,
    );
    const ie = await poison(counts, true);
    const beforeIndirect = commands;
    add(
      'indirect dependency',
      true,
      (await capture(m.reset!({ dst }, { indirect: counts }))) === ie &&
        (await capture(dst.read())) === ie &&
        commands === beforeIndirect,
    );

    const out = d.array(new Uint32Array(4));
    const n = d.array(Uint32Array.of(3));
    await m.bounds!(out, n);
    add('healthy held bound', false, equal(await out.read(), [0, 1, 2, 0]));
    const he = await poison(n, true);
    const beforeBound = commands;
    add(
      'held bound dependency',
      true,
      (await capture(m.bounds!(out, n))) === he &&
        (await capture(out.read())) === he &&
        commands === beforeBound,
    );
    // Pushed arrays require atomics. WebGL2 cannot run the positive control on its sole tier.
    if (input.tier !== 'webgl2') {
      const pushed = d.array(new Uint32Array(4));
      const length = d.array(Uint32Array.of(0));
      await m.append!({ array: pushed, length }, 2);
      add(
        'healthy held length',
        false,
        equal(await pushed.read(), [0, 1, 0, 0]) && equal(await length.read(), [2]),
      );
      const le = await poison(length, true);
      const beforeLength = commands;
      add(
        'held length dependency',
        true,
        (await capture(m.append!({ array: pushed, length }, 1))) === le &&
          (await capture(pushed.read())) === le &&
          commands === beforeLength,
      );
    }

    // A Resident draw requires a runtime-sized storage array. WebGL2 has no storage-buffer
    // fragment path; a uniform cannot substitute, because uniform bindings take no Resident.
    if (input.tier === 'webgl2') {
      const refusal = await capture(
        m.color!(document.createElement('canvas'), { xs: floats(0.5) }),
      );
      add(
        'WebGL2 storage draw refusal',
        false,
        refusal instanceof TypeError &&
          String(refusal).includes('GLSL ES 3.00 has no storage buffer'),
      );
      return result;
    }
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    document.body.append(canvas);
    const color = floats(0.5);
    const pixels = () => {
      const copy = document.createElement('canvas');
      copy.width = copy.height = 1;
      const context = copy.getContext('2d')!;
      context.drawImage(canvas, 0, 0);
      return context.getImageData(0, 0, 1, 1).data;
    };
    await m.color!(canvas, { xs: color });
    const old = Array.from(pixels());
    add('healthy draw', false, equal(old, [128, 0, 0, 255]));
    const de = await poison(color);
    await color.write(new Float32Array(4).fill(0.25));
    let contexts = 0;
    const original = canvas.getContext;
    Object.defineProperty(canvas, 'getContext', {
      configurable: true,
      value: function (this: HTMLCanvasElement, ...args: unknown[]) {
        contexts++;
        return Reflect.apply(original, this, args);
      },
    });
    const beforeDraw = commands;
    const rejected = await capture(m.color!(canvas, { xs: color }));
    add(
      'draw dependency and canvas preservation',
      true,
      rejected === de && contexts === 0 && commands === beforeDraw && equal(pixels(), old),
    );
    canvas.remove();
    const fresh = document.createElement('canvas');
    fresh.width = fresh.height = 1;
    let freshContexts = 0;
    const freshContext = fresh.getContext;
    Object.defineProperty(fresh, 'getContext', {
      configurable: true,
      value: function (this: HTMLCanvasElement, ...args: unknown[]) {
        freshContexts++;
        return Reflect.apply(freshContext, this, args);
      },
    });
    const beforeFresh = commands;
    const freshError = await capture(m.color!(fresh, { xs: color }));
    add(
      'fresh draw rejects before context',
      true,
      freshError === de && freshContexts === 0 && commands === beforeFresh,
    );
    return result;
  } finally {
    restore.reverse().forEach((fn) => fn());
    await d.dispose();
  }
}

export async function residentFailureArm(page: Page): Promise<number> {
  const bundles = new Map([
    ['/healthy.js', await bundle(false)],
    ['/disabled.js', await bundle(true)],
  ]);
  const server = createServer((req, res) => {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('content-type', 'text/javascript');
    const body = bundles.get(req.url ?? '');
    res.statusCode = body === undefined ? 404 : 200;
    res.end(body ?? 'not found');
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  let failures = 0;
  let checked = 0;
  try {
    const port = (server.address() as AddressInfo).port;
    for (const tier of ['webgpu', 'webgl2', 'cpu'] as const) {
      for (const disabled of [false, true]) {
        const results = await page.evaluate(runInPage, {
          url: `http://127.0.0.1:${port}/${disabled ? 'disabled' : 'healthy'}.js`,
          tier,
        });
        const dependencies = results.filter((r) => r.dependency);
        if (dependencies.length !== (tier === 'webgl2' ? 5 : 8))
          throw new Error('dependency corpus lost a case');
        for (const r of results) {
          const expected = !(disabled && r.dependency);
          const ok = r.ok === expected;
          if (!ok) failures++;
          checked++;
          console.log(
            `${ok ? 'ok  ' : 'FAIL'} failure ${tier} ${disabled ? 'disabled admission' : 'current'}: ${r.name}`,
          );
        }
      }
    }
    console.log(
      `Resident failure arm: ${checked} controls, ${failures} failures; WebGL2 push and Resident draw excluded (atomics and fragment storage unavailable)`,
    );
    return failures;
  } finally {
    server.close();
  }
}
