// ═══ The common modules on the GPU tiers against the f32 oracle (change 0072, Rule 11.20) ═══
//
// WHAT IT PROVES. Rule 11.20 says every function of `typeshade/algorithms` and `typeshade/random`
// gives, on WebGPU, on WebGL2 and on the CPU tier, the bits the CPU oracle gives, under the
// determinism report's rows. This arm bundles each module's baked host face for the browser, as a
// consumer's bundler does, imports it in the page, and calls every kernel function through the
// call layer on one required tier at a time (`configure({ prefer: ['webgpu'] })`, then
// `['webgl2']`), with the inputs this file makes. The oracle's answer is the f32 oracle
// (`compileModule(module, { precision: 'f32' })`) run on the same function of the same IR. So the
// whole host face is under test: the generated module, the call layer's tier, the lowering, the
// emitted WGSL or GLSL, the upload and the read-back.
//
// BIT FOR BIT, OR UNDER A ROW. A function whose IR the determinism report lists no row for (an
// `order` row aside, which every tier folds in Rule 7.2's one tree) must give the oracle's bits.
// The inputs are small dyadic numbers (multiples of 1/8), so a sum or a product rounds in no
// grouping. A function whose IR carries a row (`exp`, `log`, `sin`, `cos`, `tan`, `tanh`,
// `inverseSqrt`, `/`) is held to an envelope instead, since WGSL §15.7.4 gives the driver room
// there: each value within 32 ULP of the oracle's or within 2^-11 of it, and the arm prints the
// largest distance it saw. A tier that refuses a function (WebGL2 has no atomics, so `histogram`
// falls to the next tier; Rule 11.8) is reported, and allowed only for the functions listed in
// `REFUSED_ON`.
//
//   TYPESHADE_CHROMIUM=/path/to/headless_shell TYPESHADE_DIFF_ARMS=common bun scripts/gpu-differential.ts

import type { Page } from 'playwright';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '../src/compiler/ts/compile.js';
import { hostFace } from '../src/compiler/ts/host-face.js';
import type { CpuValue } from '../src/core/cpu-runtime.js';
import type { ModuleDecl } from '../src/core/ir/index.js';
import { compileModule } from '../src/core/oracle.js';
import { determinismReport } from '../src/core/passes/determinism.js';
import { COMMON_MODULES, publicName } from './bake-common-modules.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string): string | undefined =>
  existsSync(file) ? readFileSync(file, 'utf8') : undefined;

/** The tiers each function is held on, each required alone. */
const TIERS = ['webgpu', 'webgl2'] as const;

/** The functions a tier may refuse, with why (Rule 11.8): the call then falls to the next tier
 *  in a host's `prefer`, and the arm holds the function on the tiers that run it. */
const REFUSED_ON: Readonly<Record<string, readonly string[]>> = {
  // A loop that writes a reduction variable and no array is not a WebGL2 loop (Rule 11.8); a
  // scatter by atomics has no GLSL ES 3.00; a body that reads a second array's `.length` has no
  // GLSL spelling of `arrayLength` (the scan and the compaction; typeshade/typeshade#689). Each
  // falls to the next tier of a host's `prefer`.
  webgl2: ['sum', 'maxAll', 'minAll', 'histogram', 'inclusiveScan', 'exclusiveScan', 'compact'],
};

/** The envelope a function with a determinism row is held to. */
const ULP_ENVELOPE = 32;
const ABS_ENVELOPE = 2 ** -11;

/** How many functions the arm must compare on WebGPU, so a run that read nothing is red. */
const FUNCTIONS_FLOOR = 43;

/** A call: the function's shader name, and its arguments, each array as a plain array of numbers
 *  with its element. */
interface Call {
  readonly fn: string;
  readonly args: readonly (readonly number[] | number)[];
  readonly elems: readonly ('f32' | 'u32' | undefined)[];
  readonly key: string;
}

interface CallResult {
  readonly arrays: readonly (readonly number[])[];
  readonly result: number | undefined;
  readonly error?: string;
}

// ─── the inputs ──────────────────────────────────────────────────────────────────────────────

/** A deterministic generator (mulberry32), so a failure names a reproducible input. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `n` dyadic numbers in [lo, hi], multiples of 1/8. */
const dyadic = (rnd: () => number, n: number, lo: number, hi: number): number[] =>
  Array.from({ length: n }, () => Math.round((lo + rnd() * (hi - lo)) * 8) / 8);
/** `n` f32 numbers in [lo, hi], for a function held to an envelope. */
const floats = (rnd: () => number, n: number, lo: number, hi: number): number[] =>
  Array.from({ length: n }, () => Math.fround(lo + rnd() * (hi - lo)));
const zeros = (n: number): number[] => new Array<number>(n).fill(0);
const words = (rnd: () => number, n: number, hi: number): number[] =>
  Array.from({ length: n }, () => Math.floor(rnd() * hi));

/** The calls of the algorithms module at size `n` (a multiple of 60, for the axis reductions). */
function algorithmCalls(n: number, seed: number): Call[] {
  const rnd = mulberry32(seed);
  const f = (
    name: string,
    args: (number[] | number)[],
    elems: ('f32' | 'u32' | undefined)[],
  ): Call => ({
    fn: name,
    args,
    elems,
    key: `${name} n=${String(n)}`,
  });
  const F = ['f32', 'f32'] as const;
  const x = dyadic(rnd, n, -4, 4);
  const calls: Call[] = [
    f('copy', [zeros(n), x], [...F]),
    f('fill', [zeros(n), 2.5], ['f32', undefined]),
    f('sequence', [zeros(n), 0.5, 0.25], ['f32', undefined, undefined]),
    f('add', [zeros(n), x, dyadic(rnd, n, -4, 4)], ['f32', 'f32', 'f32']),
    f('sub', [zeros(n), x, dyadic(rnd, n, -4, 4)], ['f32', 'f32', 'f32']),
    f('mul', [zeros(n), x, dyadic(rnd, n, -4, 4)], ['f32', 'f32', 'f32']),
    f(
      'div',
      [
        zeros(n),
        x,
        Array.from({ length: n }, () => [0.5, 1, 2, 4, -0.5, -2][Math.floor(rnd() * 6)]!),
      ],
      ['f32', 'f32', 'f32'],
    ),
    f('scale', [zeros(n), x, 0.75], ['f32', 'f32', undefined]),
    f('absMap', [zeros(n), x], [...F]),
    f('negMap', [zeros(n), x], [...F]),
    f(
      'sqrtMap',
      [
        zeros(n),
        Array.from({ length: n }, () => [0, 0.25, 1, 4, 9, 16, 2.25, 6.25][Math.floor(rnd() * 8)]!),
      ],
      [...F],
    ),
    f('rsqrtMap', [zeros(n), floats(rnd, n, 0.25, 16)], [...F]),
    f('expMap', [zeros(n), floats(rnd, n, -4, 4)], [...F]),
    f('logMap', [zeros(n), floats(rnd, n, 0.5, 8)], [...F]),
    f(
      'expm1Map',
      [zeros(n), floats(rnd, n, -0.5, 0.5).map((v, i) => (i % 4 === 0 ? v / 1000 : v))],
      [...F],
    ),
    f(
      'log1pMap',
      [zeros(n), floats(rnd, n, -0.5, 0.5).map((v, i) => (i % 4 === 0 ? v / 1000 : v))],
      [...F],
    ),
    f('floorMap', [zeros(n), x], [...F]),
    f('ceilMap', [zeros(n), x], [...F]),
    f('roundMap', [zeros(n), x], [...F]),
    f('signMap', [zeros(n), x], [...F]),
    f('sinMap', [zeros(n), floats(rnd, n, -3, 3)], [...F]),
    f('cosMap', [zeros(n), floats(rnd, n, -3, 3)], [...F]),
    f('tanMap', [zeros(n), floats(rnd, n, -1, 1)], [...F]),
    f('tanhMap', [zeros(n), floats(rnd, n, -3, 3)], [...F]),
    f('sigmoidMap', [zeros(n), floats(rnd, n, -8, 8)], [...F]),
    f('reluMap', [zeros(n), x], [...F]),
    f('clipMap', [zeros(n), x, -1.5, 2.5], ['f32', 'f32', undefined, undefined]),
    f('sum', [x], ['f32']),
    f('maxAll', [x], ['f32']),
    f('minAll', [x], ['f32']),
  ];
  // The axis reductions read x as [outer, axis, inner] with outer * axis * inner = n.
  const [outer, axis, inner] = n === 60 ? [4, 5, 3] : [10, 20, 5];
  const o = zeros(outer * inner);
  const A = ['f32', 'f32', undefined, undefined] as const;
  for (const name of ['sumAxis', 'meanAxis', 'maxAxis', 'minAxis', 'argMaxAxis', 'argMinAxis'])
    calls.push(f(name, [o.slice(), x, axis, inner], [...A]));
  // The product of up to 20 factors in [-2, 2]: small dyadic factors keep it finite and exact.
  calls.push(
    f('prodAxis', [o.slice(), x.map((v) => Math.round(v / 2) / 2 || 0.5), axis, inner], [...A]),
  );
  // The scan over u32 with ceil(sqrt(n)) blocks, the compaction of a flagged third, a histogram.
  const u = words(rnd, n, 6);
  const sums = zeros(Math.ceil(Math.sqrt(n)));
  calls.push(f('exclusiveScan', [zeros(n), u, sums.slice()], ['u32', 'u32', 'u32']));
  calls.push(f('inclusiveScan', [zeros(n), u, sums.slice()], ['u32', 'u32', 'u32']));
  const flags = Array.from({ length: n }, () => (rnd() < 0.34 ? 1 : 0));
  const offsets: number[] = [];
  let acc = 0;
  for (const flag of flags) {
    offsets.push(acc);
    acc += flag;
  }
  calls.push(f('compact', [zeros(acc + 2), x, flags, offsets], ['f32', 'f32', 'u32', 'u32']));
  calls.push(
    f(
      'histogram',
      [zeros(8), floats(rnd, n, -0.5, 1.5), 0, 1],
      ['u32', 'f32', undefined, undefined],
    ),
  );
  return calls;
}

/** The calls of the random module at size `n`. */
function randomCalls(n: number, seed: number): Call[] {
  return [
    {
      fn: 'fillUniform',
      args: [zeros(n), seed],
      elems: ['f32', undefined],
      key: `fillUniform n=${String(n)}`,
    },
    {
      fn: 'fillWords',
      args: [zeros(n), seed],
      elems: ['u32', undefined],
      key: `fillWords n=${String(n)}`,
    },
  ];
}

// ─── the oracle ──────────────────────────────────────────────────────────────────────────────

/** The IR of a module's shader entry, with the files it imports linked (Rule 3.9). */
function moduleOf(dir: string): ModuleDecl {
  const entry = join(ROOT, dir, 'index.shade.ts');
  const r = compile(read(entry)!, { fileName: entry, readDocument: read });
  const errors = r.diagnostics.filter((d) => d.category === 'error');
  if (errors.length > 0)
    throw new Error(`${dir}: ${errors.map((d) => `${d.code} ${d.message}`).join('; ')}`);
  return r.module;
}

/** The kernel functions of a module's host face, by shader name. */
function kernelsOf(dir: string): string[] {
  const entry = join(ROOT, dir, 'index.shade.ts');
  const g = hostFace(read(entry)!, { fileName: entry, fuse: true, readDocument: read });
  return (g.exports ?? []).filter((e) => e.kind === 'kernel').map((e) => e.name);
}

/** The oracle's answer: the arrays after the call, and its result. */
function oracleOf(m: ModuleDecl, call: Call): CallResult {
  const values = call.args.map((a) => (Array.isArray(a) ? [...a] : a)) as CpuValue[];
  const result = compileModule(m, { precision: 'f32' }).fns[call.fn]!(...values) as
    number | undefined;
  return {
    arrays: values.filter((_, i) => Array.isArray(call.args[i])) as number[][],
    result: typeof result === 'number' ? result : undefined,
  };
}

/** Whether the determinism report lists a row for `fn` other than `order`. */
function hasRow(m: ModuleDecl, fn: string): string[] {
  return determinismReport(m)
    .filter((r) => r.kind !== 'order' && r.where.includes(fn))
    .map((r) => `${r.op} (${r.kind})`);
}

// ─── the comparison ──────────────────────────────────────────────────────────────────────────

const F32 = new Float32Array(1);
const U32 = new Uint32Array(F32.buffer);
/** The f32 bit distance between two numbers of one sign. */
function ulps(a: number, b: number): number {
  F32[0] = a;
  const x = U32[0]!;
  F32[0] = b;
  const y = U32[0]!;
  if ((x ^ y) & 0x80000000) return Infinity;
  return Math.abs(x - y);
}

/** The first difference, bit for bit, or past the envelope when `rows` is non-empty; and the
 *  largest distances seen for a function under the envelope: in ULP among values of magnitude at
 *  least 1/16 (a value near zero is many ULP from a near one), and absolute. */
function compare(
  want: CallResult,
  got: CallResult,
  rows: readonly string[],
  elems: readonly ('f32' | 'u32' | undefined)[],
): { diff?: string; maxUlp: number; maxAbs: number } {
  let maxUlp = 0;
  let maxAbs = 0;
  const one = (w: number, g: number, at: string, integer: boolean): string | undefined => {
    if (Object.is(w, g) || (w === 0 && g === 0)) return undefined;
    if (integer || rows.length === 0) {
      // A zero's sign and a subnormal carry no claim (as the kernel arm reads them).
      if (!Number.isFinite(w)) return undefined;
      if (Math.abs(w) < 2 ** -126 && g === 0) return undefined;
      return `${at}: oracle ${String(w)} ≠ gpu ${String(g)}`;
    }
    if (!Number.isFinite(w) || !Number.isFinite(g))
      return Number.isFinite(w) === Number.isFinite(g)
        ? undefined
        : `${at}: oracle ${String(w)} ≠ gpu ${String(g)}`;
    const d = ulps(w, g);
    if (Math.abs(w - g) <= ABS_ENVELOPE || d <= ULP_ENVELOPE) {
      maxAbs = Math.max(maxAbs, Math.abs(w - g));
      if (Math.abs(w) >= 1 / 16 && Number.isFinite(d)) maxUlp = Math.max(maxUlp, d);
      return undefined;
    }
    return `${at}: oracle ${String(w)} ≠ gpu ${String(g)} (${String(d)} ULP)`;
  };
  const arrayElems = elems.filter((e) => e !== undefined);
  for (let a = 0; a < want.arrays.length; a++) {
    const w = want.arrays[a]!;
    const g = got.arrays[a];
    if (g === undefined || g.length !== w.length)
      return {
        diff: `array ${String(a)}: ${String(w.length)} values, gpu gave ${String(g?.length)}`,
        maxUlp,
        maxAbs,
      };
    for (let i = 0; i < w.length; i++) {
      const d = one(w[i]!, g[i]!, `array ${String(a)}[${String(i)}]`, arrayElems[a] === 'u32');
      if (d !== undefined) return { diff: d, maxUlp, maxAbs };
    }
  }
  if (want.result !== undefined) {
    if (got.result === undefined) return { diff: 'result: gpu gave none', maxUlp, maxAbs };
    const d = one(want.result, got.result, 'result', false);
    if (d !== undefined) return { diff: d, maxUlp, maxAbs };
  }
  return { maxUlp, maxAbs };
}

// ─── the page ────────────────────────────────────────────────────────────────────────────────

/** The part of Bun's bundler this uses. */
interface Bundler {
  build(o: { entrypoints: string[]; target: 'browser'; format: 'esm'; minify: boolean }): Promise<{
    success: boolean;
    logs: unknown[];
    outputs: { text(): Promise<string> }[];
  }>;
}

/** The host face of a module and the runtime's `configure`, bundled for the browser as a
 *  consumer's bundler bundles them, as one script that sets `globalThis.__common`. */
async function bundleOf(dir: string): Promise<string> {
  const bun = (globalThis as { Bun?: Bundler }).Bun;
  if (bun === undefined) throw new Error('the common-module arm needs Bun: run it with bun');
  const tmp = mkdtempSync(join(tmpdir(), 'typeshade-common-'));
  try {
    const entry = join(tmp, 'entry.ts');
    writeFileSync(
      entry,
      `import * as m from ${JSON.stringify(join(ROOT, dir, 'index.ts'))};\n` +
        `import { configure } from ${JSON.stringify(join(ROOT, 'src/runtime.ts'))};\n` +
        `(globalThis as Record<string, unknown>).__common = { m, configure };\n`,
    );
    const built = await bun.build({
      entrypoints: [entry],
      target: 'browser',
      format: 'esm',
      minify: false,
    });
    if (!built.success) throw new Error(`bundling ${dir} failed: ${JSON.stringify(built.logs)}`);
    return await built.outputs[0]!.text();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Serve the bundles on loopback, with CORS, so the gate's page may import them. */
function serveBundles(bundles: ReadonlyMap<string, string>): Promise<Server> {
  return new Promise((ok) => {
    const server = createServer((req, res) => {
      const body = bundles.get(req.url ?? '');
      res.setHeader('access-control-allow-origin', '*');
      if (body === undefined) {
        res.statusCode = 404;
        res.end('not here');
        return;
      }
      res.setHeader('content-type', 'text/javascript; charset=utf-8');
      res.end(body);
    });
    server.listen(0, '127.0.0.1', () => ok(server));
  });
}

/** Runs INSIDE the browser: import the bundle, then call each function on the one tier. */
async function callInPage(input: {
  url: string;
  tier: string;
  calls: { name: string; args: (number[] | number)[]; elems: (string | undefined)[] }[];
}): Promise<CallResult[]> {
  await import(/* @vite-ignore */ input.url);
  const g = (globalThis as Record<string, unknown>)['__common'] as {
    m: Record<string, (...a: unknown[]) => Promise<unknown>>;
    configure: (o: { prefer: string[] }) => void;
  };
  g.configure({ prefer: [input.tier] });
  const out: CallResult[] = [];
  for (const call of input.calls) {
    const values = call.args.map((a, i) =>
      Array.isArray(a) ? (call.elems[i] === 'u32' ? Uint32Array.from(a) : Float32Array.from(a)) : a,
    );
    try {
      const result = await g.m[call.name]!(...values);
      out.push({
        arrays: values
          .filter((v) => typeof v !== 'number')
          .map((v) => Array.from(v as ArrayLike<number>)),
        result: typeof result === 'number' ? result : undefined,
      });
    } catch (e) {
      out.push({ arrays: [], result: undefined, error: String(e) });
    }
  }
  return out;
}

// ─── the arm ─────────────────────────────────────────────────────────────────────────────────

export async function commonModulesArm(page: Page): Promise<number> {
  let failures = 0;
  const bundles = new Map<string, string>();
  const modules: { dir: string; m: ModuleDecl; kernels: string[]; calls: Call[]; url: string }[] =
    [];
  for (const module of COMMON_MODULES) {
    const name = module.dir.slice('src/'.length);
    const calls =
      name === 'algorithms'
        ? [...algorithmCalls(60, 11), ...algorithmCalls(1000, 12)]
        : [...randomCalls(7, 12345), ...randomCalls(1000, 7)];
    bundles.set(`/${name}.js`, await bundleOf(module.dir));
    modules.push({
      dir: module.dir,
      m: moduleOf(module.dir),
      kernels: kernelsOf(module.dir),
      calls,
      url: `/${name}.js`,
    });
  }
  const server = await serveBundles(bundles);
  const port = (server.address() as AddressInfo).port;
  try {
    const seen = new Set<string>();
    const refusals: string[] = [];
    let compared = 0;
    let underEnvelope = 0;
    let largest = { fn: '', ulp: 0 };
    let largestAbs = { fn: '', abs: 0 };
    for (const { dir, m, kernels, calls, url } of modules) {
      // Every kernel function of the module is called; one with no call here is a gap in this
      // file, which the floor below also catches.
      for (const k of kernels)
        if (!calls.some((c) => c.fn === k)) {
          console.error(`FAIL  ${dir}: ${k} has no call in the common-module arm`);
          failures += 1;
        }
      const wants = calls.map((c) => oracleOf(m, c));
      for (const tier of TIERS) {
        const results = await page.evaluate(callInPage, {
          url: `http://127.0.0.1:${String(port)}${url}`,
          tier,
          calls: calls.map((c) => ({
            // The host face exports a kernel named `<op>Map` or `<op>All` under the builtin's name.
            name: publicName(c.fn),
            args: [...c.args] as (number[] | number)[],
            elems: [...c.elems],
          })),
        });
        calls.forEach((call, i) => {
          const got = results[i]!;
          if (got.error !== undefined) {
            if (REFUSED_ON[tier]?.includes(call.fn)) {
              refusals.push(`${tier}: ${call.fn}`);
              return;
            }
            failures += 1;
            console.log(`FAIL  ${tier} ${call.key}: ${got.error.slice(0, 160)}`);
            return;
          }
          const rows = hasRow(m, call.fn);
          const { diff, maxUlp, maxAbs } = compare(wants[i]!, got, rows, call.elems);
          compared += 1;
          if (tier === 'webgpu') seen.add(call.fn);
          if (rows.length > 0) {
            underEnvelope += 1;
            if (maxUlp > largest.ulp) largest = { fn: `${call.fn} on ${tier}`, ulp: maxUlp };
            if (maxAbs > largestAbs.abs) largestAbs = { fn: `${call.fn} on ${tier}`, abs: maxAbs };
          }
          if (diff !== undefined) {
            failures += 1;
            console.log(
              `FAIL  ${tier} ${call.key}${rows.length > 0 ? ` [${rows.join(', ')}]` : ''}: ${diff}`,
            );
          }
        });
      }
    }
    if (seen.size < FUNCTIONS_FLOOR) {
      console.error(
        `FAIL  the arm compared ${String(seen.size)} functions on WebGPU, under its floor of ${String(FUNCTIONS_FLOOR)}`,
      );
      failures += 1;
    }
    console.log(
      `common modules: ${String(seen.size)} functions of typeshade/algorithms and typeshade/random, ${String(compared)} calls on WebGPU and WebGL2 against the f32 oracle, ` +
        `${String(compared - underEnvelope)} bit for bit and ${String(underEnvelope)} under the envelope of a determinism row (largest ${String(largest.ulp)} ULP at magnitude 1/16 or more, ${largest.fn}; largest ${largestAbs.abs.toExponential(2)} absolute, ${largestAbs.fn}) · ` +
        `refused as Rule 11.8 allows: ${refusals.length > 0 ? [...new Set(refusals)].join(', ') : 'none'} · failures: ${String(failures)}`,
    );
  } finally {
    server.close();
  }
  return failures;
}
