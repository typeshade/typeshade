// The user-journey harness. `scripts/user-journey.ts` copies this directory into a fresh project
// that has installed the packed `typeshade` tarball, and runs this file there with Node. So it
// sees exactly what a user sees: the published exports, the compiled `dist/`, the README's
// `tsconfig.shade.json`, and a real WebGPU device. It imports nothing from the repository.
//
// For each journey (a directory holding `*.shade.ts` sources and a `journey.mjs` host), it
// checks that:
//
//   1. `compile()` accepts every source with no diagnostic at all, error or warning;
//   2. the language service (`typeshade/language-service`) reports nothing on it;
//   3. `tsc -p tsconfig.shade.json`, the README's file, reports only the error classes the
//      README documents (decorators, and operators on vectors);
//   4. each run, on WebGPU, produces what the journey's plain-JavaScript reference computes;
//   5. the same run on the CPU oracle (`compileModule`) produces it too.
//
// The WebGPU half is `typeshade/runtime` (change 0025, Rule 11.11): the page imports the
// runtime the tarball ships, loads the run's manifest (`packModule`), binds each binding by its
// name with the journey's host value, and reads the result back through a `Resident` or the
// target texture. The console's lines reach the runtime's sink, and the count of them and of the
// calls that did not fit is what `submit()` resolves to (change 0028). A run may pack its program
// under emit options (`emit`, change 0028): the level, `parens` and `fp64Flavor` of surface §69,
// which must run on WebGPU as the manifest says. A render run may name a float `target` (change
// 0028): the harness makes the texture in that format and reads it back with `readFloats()`, the
// numbers of its texels, starting the read while the frame is pending and before a later frame
// clears the target, so that the read is held to the frame submitted before it. The harness writes
// no WebGPU of its own.
//
// A run of an engine (`kind: 'engine'`, change 0025) is a host module that draws frames on the
// runtime's public exports alone: the harness refuses any other import and any WebGPU call in
// it, hands it a device, runs its frames, counts the GPU objects each frame after the first
// creates, which must be none, and holds the last frame to the journey's reference.
//
// A run of a kernel function (`kind: 'kernel'`, change 0013) is called with the journey's own
// host values. It runs here on the CPU oracle, and on WebGPU through the import, which is how a
// host calls one and which `journeys/_host-import` checks (`scripts/user-journey.ts`).

import { compile, compileModule, packModule } from 'typeshade';
import { createTypeshadeLanguageService } from 'typeshade/language-service';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = 'journeys';
const PLAYWRIGHT = process.env.TYPESHADE_PLAYWRIGHT;
const CHROMIUM = process.env.TYPESHADE_CHROMIUM || undefined;
if (!PLAYWRIGHT) throw new Error('TYPESHADE_PLAYWRIGHT must point at playwright/index.mjs');
const { chromium } = await import(pathToFileURL(PLAYWRIGHT).href);

/** The targets a render run may name: floats, which the harness reads back as numbers with
 *  `readFloats()` and does not clamp. Without one the run draws into an `rgba8unorm` target. */
const FLOAT_TARGETS = new Set(['rgba16float', 'rgba32float']);

/** The `tsc` codes the README documents as what plain `tsc` cannot see through. */
const TSC_DOCUMENTED = new Set([
  'TS1206',
  'TS2322',
  'TS2339',
  'TS2345',
  'TS2362',
  'TS2363',
  'TS2365',
  'TS2769',
]);

const failures = [];
const fail = (where, what) => failures.push(`${where}: ${what}`);

const journeys = readdirSync(ROOT)
  .filter((d) => !d.startsWith('_') && statSync(join(ROOT, d)).isDirectory())
  .sort();
if (journeys.length === 0) throw new Error('no journeys found: the harness is broken');

// ---- 1 and 2: the compiler and the editor -------------------------------------------------------
const service = createTypeshadeLanguageService();
const compiled = new Map();
for (const id of journeys) {
  for (const file of readdirSync(join(ROOT, id)).filter((f) => f.endsWith('.shade.ts'))) {
    const path = join(ROOT, id, file);
    const source = readFileSync(path, 'utf8');
    const r = compile(source, { fileName: path });
    for (const d of r.diagnostics) fail(path, `compile() ${d.category} ${d.code}: ${d.message}`);
    if (!r.wgsl) fail(path, 'compile() emitted no WGSL');
    compiled.set(path, r);
    service.openDocument(path, source);
    for (const d of service.getDiagnostics(path)) {
      fail(path, `editor ${d.source} ${String(d.code)}: ${d.message}`);
    }
  }
}

// ---- 3: plain tsc, through the README's tsconfig ------------------------------------------------
{
  const tsc = spawnSync('npx', ['tsc', '-p', 'tsconfig.shade.json', '--pretty', 'false'], {
    encoding: 'utf8',
  });
  const lines = `${tsc.stdout}${tsc.stderr}`.split('\n').filter((l) => /error TS\d+/.test(l));
  const counts = {};
  for (const line of lines) {
    const code = /error (TS\d+)/.exec(line)[1];
    counts[code] = (counts[code] ?? 0) + 1;
    if (!TSC_DOCUMENTED.has(code)) fail('tsc -p tsconfig.shade.json', line.trim());
  }
  console.log(`tsc (README tsconfig): ${JSON.stringify(counts)}`);
}

// ---- 4 and 5: WebGPU and the CPU oracle ---------------------------------------------------------
/** A binding's host value (Rule 8.21) from the journey's CPU value, as the page can receive it:
 *  an array of scalars or vectors is the typed array of its component type, its components in
 *  order, and anything else (a struct, an array of structs, a scalar) is the value itself. */
function wire(layout, v) {
  const leaf = (l) => (l.kind === 'scalar' || l.kind === 'vector' ? l.type : undefined);
  const type = layout.kind === 'array' ? leaf(layout.element) : undefined;
  if (type !== undefined && (Array.isArray(v) || ArrayBuffer.isView(v)))
    return { typed: type, data: [...v].flat(Infinity) };
  return { value: v };
}

/** The bindings the run's entries reach, by the manifest. */
function reached(pack, run) {
  const names = run.kind === 'render' ? [run.vertex, run.fragment] : [run.entry];
  return new Set(
    pack.entries
      .filter((e) => names.includes(e.name))
      .flatMap((e) => e.bindings.map((b) => b.name)),
  );
}

const jobs = [];
const kernels = [];
const engines = [];

/** What an engine may import: the runtime's public subpath, and nothing else. */
const ENGINE_IMPORTS = new Set(['typeshade/runtime']);
/** A WebGPU call or global an engine's own code must not reach for: the runtime makes and
 *  records everything, and `raw` is the pass the runtime hands a host that owns its frame. */
const WEBGPU_CALL =
  /\bnavigator\s*\.\s*gpu\b|\bGPU[A-Z]\w*|\.\s*(createBuffer|createTexture|createView|createSampler|createBindGroup|createBindGroupLayout|createPipelineLayout|createShaderModule|createRenderPipeline|createRenderPipelineAsync|createComputePipeline|createComputePipelineAsync|createCommandEncoder|beginRenderPass|beginComputePass|setPipeline|setBindGroup|setVertexBuffer|setIndexBuffer|setScissorRect|setViewport|writeBuffer|writeTexture|queue|raw|mapAsync|getMappedRange)\b/;

/** Why an engine's source is not on the public runtime alone, or '' when it is. */
function engineOffence(source) {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  for (const m of code.matchAll(
    /\bimport\s*(?:[^'"]*?\bfrom\s*)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]/g,
  )) {
    const spec = m[1] ?? m[2];
    if (!ENGINE_IMPORTS.has(spec))
      return `imports "${spec}", which is not the runtime's public subpath`;
  }
  const call = WEBGPU_CALL.exec(code);
  return call ? `calls WebGPU itself: "${call[0].trim()}"` : '';
}
for (const id of journeys) {
  const spec = (await import(pathToFileURL(join(process.cwd(), ROOT, id, 'journey.mjs')).href))
    .default;
  for (const [n, run] of spec.runs.entries()) {
    if (run.kind === 'engine') {
      const source = readFileSync(join(ROOT, id, run.engine), 'utf8');
      const offence = engineOffence(source);
      if (offence) fail(`${id}#${n}`, `${run.engine} ${offence}`);
      const programs = {};
      for (const [name, file] of Object.entries(run.programs)) {
        const r = compiled.get(join(ROOT, id, file));
        if (r?.module) programs[name] = packModule(r.module);
      }
      if (Object.keys(programs).length === Object.keys(run.programs).length)
        engines.push({
          id: `${id}#${n}`,
          spec,
          run,
          url: `/journeys/${id}/${run.engine}`,
          programs,
          offence,
        });
      continue;
    }
    const path = join(ROOT, id, run.shader);
    const r = compiled.get(path);
    if (!r?.wgsl) continue;
    // A kernel function (change 0013) runs on WebGPU through the import, which
    // `journeys/_host-import` checks; here it runs on the CPU oracle.
    if (run.kind === 'kernel') {
      kernels.push({ id: `${id}#${n}`, run, module: r.module, spec });
      continue;
    }
    if (run.target !== undefined && (run.kind !== 'render' || !FLOAT_TARGETS.has(run.target))) {
      fail(
        `${id}#${n}`,
        `target ${JSON.stringify(run.target)}: a render run's target is one of ${[...FLOAT_TARGETS].join(', ')}, or none for an rgba8unorm one`,
      );
      continue;
    }
    // The runtime binds each binding the entries reach by its name, with the host value
    // (Rule 8.21) of the journey's value, which the CPU oracle is handed too.
    const pack = packModule(r.module, {
      console: run.console !== undefined,
      ...(run.emit !== undefined ? { emit: run.emit } : {}),
    });
    // A run with `emit` packs the program under those options, which the manifest records. The
    // journey shows nothing of them if they emit the program the defaults do, so that is a failure.
    if (run.emit !== undefined) {
      // What a manifest can record of them, in one order: a plugin, which it cannot, is left out.
      const recorded = (e) =>
        JSON.stringify(
          Object.fromEntries(
            ['level', 'parens', 'fp64Flavor']
              .filter((k) => e?.[k] !== undefined)
              .map((k) => [k, e[k]]),
          ),
        );
      if (recorded(pack.emit) !== recorded(run.emit))
        fail(
          `${id}#${n}`,
          `packed with ${JSON.stringify(run.emit)}, the manifest records ${JSON.stringify(pack.emit)}`,
        );
      if (pack.wgsl === packModule(r.module).wgsl)
        fail(
          `${id}#${n}`,
          `packed with ${JSON.stringify(run.emit)}, the WGSL is the one the defaults emit: the run shows nothing of the options`,
        );
    }
    const layouts = new Map(pack.bindings.map((b) => [b.name, b.layout]));
    const reach = reached(pack, run);
    const bindings = Object.fromEntries(
      Object.entries(run.bindings)
        .filter(([k]) => reach.has(k))
        .map(([k, v]) => [k, wire(layouts.get(k), v)]),
    );
    // A run with `console` loads the recorded variant, and the runtime binds the console buffer
    // (surface §66, §69). The compile is asked once more for what it says about recording.
    if (run.console) {
      const rc = compile(readFileSync(path, 'utf8'), { fileName: path, console: 'gpu' });
      for (const d of rc.diagnostics)
        fail(path, `compile({ console: 'gpu' }) ${d.category} ${d.code}: ${d.message}`);
      if (!rc.wgsl || !rc.console) {
        fail(path, "compile({ console: 'gpu' }) recorded no console call");
        continue;
      }
    }
    jobs.push({
      id: `${id}#${n}`,
      spec,
      run,
      module: r.module,
      pack,
      bindings,
    });
  }
}

/** Runs INSIDE the page, on `typeshade/runtime` as the tarball ships it: no WebGPU of its own. */
async function runOnGpu(job) {
  const { createRuntime, resident } = await import('/typeshade/runtime.js');
  const events = [];
  const rt = await createRuntime({
    console: (e) => events.push(e),
    ...(job.consoleCapacity !== undefined ? { consoleBytes: 4 * (2 + job.consoleCapacity) } : {}),
  });
  const TYPED = { u32: Uint32Array, i32: Int32Array, f32: Float32Array, f64: Float64Array };
  const bindings = {};
  for (const [name, b] of Object.entries(job.bindings))
    bindings[name] = b.typed ? new TYPED[b.typed](b.data) : b.value;
  const program = rt.load(job.pack);
  // A runtime given a sink prints nothing, the warning for the calls that did not fit the console
  // buffer included: their count is what `submit()` resolves to. The page's console is watched all
  // the same, so that a runtime that printed the warning would be seen.
  const printed = [];
  const warn = console.warn;
  console.warn = (...a) => {
    if (/console calls did not fit the console buffer/.test(a.join(' '))) printed.push(a.join(' '));
    else warn(...a);
  };
  let values;
  let after;
  let rows = [];
  let error = null;
  try {
    if (job.kind === 'compute') {
      // The binding read back is a Resident: it stays on the device across the repeats, and
      // `read()` brings it back.
      const out = resident(bindings[job.read]);
      bindings[job.read] = out;
      const pipeline = await program.compute(job.entry, { constants: job.constants });
      const f = rt.frame();
      for (let i = 0; i < job.repeat; i++) f.dispatch(pipeline, bindings, job.workgroups);
      rows = (await f.submit()).console;
      const got = await out.read();
      values = ArrayBuffer.isView(got) ? [...got] : got;
    } else {
      const [w, h] = job.size;
      const format = job.target ?? 'rgba8unorm';
      const pipeline = await program.render({
        vertex: job.vertex,
        fragment: job.fragment,
        targets: [format],
        constants: job.constants,
      });
      const target = rt.texture({ size: [w, h], format });
      const f = rt.frame();
      f.pass({ color: [{ target, clear: [0, 0, 0, 0] }] }, (p) => {
        // The scissor is the one call on the pass the runtime leaves to the host.
        if (job.scissor) p.raw.setScissorRect(...job.scissor);
        p.draw(pipeline, bindings, { count: 3 });
      });
      if (job.target === undefined) {
        rows = (await f.submit()).console;
        values = [...(await target.read())].map((v) => v / 255);
      } else {
        // A float target is read back as numbers. The frame's commands are with the queue once
        // `submit()` is called, and the read is started right after, while the frame's promise is
        // pending: it reads the frame. A later frame then clears the target, and the read, whose
        // copy was submitted before that frame, must still hold the first one (surface §69).
        const submitted = f.submit();
        const pending = target.readFloats();
        const later = rt.frame();
        later.pass({ color: [{ target, clear: [-1, -1, -1, -1] }] }, () => {});
        await later.submit();
        rows = (await submitted).console;
        values = [...(await pending)];
        // The later frame ran: what the target holds now is its clear.
        after = [...(await target.readFloats())];
      }
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  } finally {
    console.warn = warn;
  }
  rt.destroy();
  return {
    values,
    after,
    // What `submit()` said each console buffer held, a plain copy for the page to hand back.
    rows: rows.map((r) => ({ entry: r.entry, lines: r.lines, dropped: r.dropped })),
    printed,
    events: events.map((e) => ({
      method: e.method,
      args: e.args,
      invocation: e.invocation ? [...e.invocation] : undefined,
    })),
    error,
  };
}

/** Runs INSIDE the page: an engine's frames, on a device the harness instruments. Every GPU
 *  object the device makes while the frames after the first run is counted; an engine whose
 *  frames repeat their shapes makes none. Command encoders and passes are per submit, and not
 *  counted. */
async function runEngine(job) {
  const COUNTED = [
    'createBuffer',
    'createTexture',
    'createSampler',
    'createBindGroup',
    'createBindGroupLayout',
    'createPipelineLayout',
    'createShaderModule',
    'createComputePipeline',
    'createComputePipelineAsync',
    'createRenderPipeline',
    'createRenderPipelineAsync',
    'createQuerySet',
  ];
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();
  const made = {};
  let counting = false;
  const count = (what) => {
    if (counting) made[what] = (made[what] ?? 0) + 1;
  };
  for (const name of COUNTED) {
    const make = device[name].bind(device);
    device[name] = (...args) => {
      count(name);
      const object = make(...args);
      if (name === 'createTexture') {
        const view = object.createView.bind(object);
        object.createView = (...v) => (count('createView'), view(...v));
      }
      return object;
    };
  }
  device.pushErrorScope('validation');
  let values;
  let error = null;
  try {
    const engine = await import(job.url);
    const scene = await engine.setup({ device, programs: job.programs, size: job.size });
    await scene.frame(0);
    counting = true;
    for (let i = 1; i < job.frames; i++) await scene.frame(i / 60);
    counting = false;
    values = [...(await scene.read())].map((v) => v / 255);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const invalid = await device.popErrorScope();
  return { values, made, error: error ?? (invalid ? invalid.message : null) };
}

const browser = await chromium.launch({
  executablePath: CHROMIUM,
  args: [
    '--enable-unsafe-webgpu',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--use-vulkan=swiftshader',
    '--enable-features=Vulkan',
  ],
});
// WebGPU needs a secure context, and http://127.0.0.1 is one. The page imports the runtime the
// tarball installed, `/typeshade/runtime.js`, from the directory `typeshade/runtime` resolves
// into: its modules import one another by relative path, and nothing else.
const RUNTIME_DIR = dirname(fileURLToPath(import.meta.resolve('typeshade/runtime')));
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname.startsWith('/typeshade/')) {
    const file = normalize(join(RUNTIME_DIR, url.pathname.slice('/typeshade/'.length)));
    if (!file.startsWith(RUNTIME_DIR + sep) || extname(file) !== '.js') {
      res.statusCode = 404;
      res.end();
      return;
    }
    try {
      const text = readFileSync(file, 'utf8');
      res.setHeader('content-type', 'text/javascript; charset=utf-8');
      res.end(text);
    } catch {
      res.statusCode = 404;
      res.end();
    }
    return;
  }
  // An engine's own module, which imports the runtime by its package name: the page's import
  // map resolves it, as an application's bundler would.
  if (url.pathname.startsWith('/journeys/') && url.pathname.endsWith('.mjs')) {
    const file = normalize(join(process.cwd(), url.pathname.slice(1)));
    if (!file.startsWith(join(process.cwd(), ROOT) + sep)) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader('content-type', 'text/javascript; charset=utf-8');
    res.end(readFileSync(file, 'utf8'));
    return;
  }
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(
    '<!doctype html><title>typeshade journeys</title>' +
      '<script type="importmap">{"imports":{"typeshade/runtime":"/typeshade/runtime.js"}}</script>',
  );
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${server.address().port}/`);

/** Where two lists of console lines first differ, or '' when they agree: the method and the
 *  invocation exactly, a number in the arguments to `tolerance` of its size (or of 1). */
function firstDifference(got, want, tolerance) {
  if (got.length !== want.length) return `${got.length} lines, expected ${want.length}`;
  const same = (a, b) => {
    if (typeof a === 'number' && typeof b === 'number')
      return Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(b));
    if (Array.isArray(a) && Array.isArray(b))
      return a.length === b.length && a.every((v, i) => same(v, b[i]));
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      const keys = Object.keys(b);
      return keys.length === Object.keys(a).length && keys.every((k) => same(a[k], b[k]));
    }
    return a === b;
  };
  for (let i = 0; i < want.length; i++) {
    const g = got[i];
    const w = want[i];
    if (
      g.method !== w.method ||
      JSON.stringify(g.invocation) !== JSON.stringify(w.invocation) ||
      !same(g.args, w.args)
    )
      return `line ${i}: ${JSON.stringify(g)} for ${JSON.stringify(w)}`;
  }
  return '';
}

const worst = (got, want, tolerance) => {
  if (got.length < want.length)
    return { ok: false, text: `${got.length} values, expected ${want.length}` };
  let max = 0;
  for (let i = 0; i < want.length; i++) {
    const d = Math.abs(got[i] - want[i]) / Math.max(1, Math.abs(want[i]));
    max = Number.isNaN(d) ? Infinity : Math.max(max, d);
  }
  return { ok: max <= tolerance, text: max.toExponential(2) };
};

for (const job of jobs) {
  const { run } = job;
  let expected;
  // A scissor rectangle keeps the pixels it covers; the others keep the clear value, 0.
  const inside = (x, y) =>
    !run.scissor ||
    (x >= run.scissor[0] &&
      x < run.scissor[0] + run.scissor[2] &&
      y >= run.scissor[1] &&
      y < run.scissor[1] + run.scissor[3]);
  if (run.kind === 'render') {
    const [w, h] = run.size;
    expected = [];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        expected.push(
          ...(inside(x, y) ? run.expected(x, y) : [0, 0, 0, 0]).map((c) =>
            run.target === undefined ? Math.min(1, Math.max(0, c)) : c,
          ),
        );
  } else expected = run.expected();

  // WebGPU.
  let gpu;
  try {
    gpu = await page.evaluate(runOnGpu, {
      kind: run.kind,
      pack: job.pack,
      bindings: job.bindings,
      consoleCapacity: run.console?.capacity,
      entry: run.entry,
      workgroups: run.workgroups,
      repeat: run.repeat ?? 1,
      read: run.read,
      vertex: run.vertex,
      fragment: run.fragment,
      size: run.size,
      scissor: run.scissor,
      constants: run.constants,
      target: run.target,
    });
  } catch (e) {
    fail(job.id, `WebGPU threw: ${e.message.split('\n')[0]}`);
    continue;
  }
  if (gpu.error) {
    fail(job.id, `WebGPU, through typeshade/runtime: ${gpu.error}`);
    continue;
  }
  const g = worst(gpu.values, expected, run.tolerance);
  if (!g.ok) fail(job.id, `WebGPU result off by ${g.text} (tolerance ${run.tolerance})`);
  // A float target was read while a later frame was submitted after the read: the frame ran, and
  // cleared every channel of the target to -1, which the read must not have seen.
  if (run.target !== undefined) {
    const cleared = gpu.after?.length === expected.length && gpu.after.every((v) => v === -1);
    if (!cleared)
      fail(
        job.id,
        'the frame submitted after the read did not clear the target: the read cannot be shown to precede it',
      );
  }

  // The CPU oracle, and the console lines it delivers to the sink.
  let cpuValues;
  const cpuLines = [];
  // The pixel a render's fragment entry is running for, which is the invocation a line
  // decoded from WebGPU carries (surface §66).
  let pixel;
  try {
    // A run with `constants` sets the program's overrides by name on its pipeline. The oracle has
    // no pipeline, so it runs the module with each value as the override's default (surface §15).
    const module = run.constants
      ? {
          ...job.module,
          overrides: job.module.overrides.map((o) =>
            o.name in run.constants ? { ...o, default: run.constants[o.name] } : o,
          ),
        }
      : job.module;
    const m = compileModule(module, {
      ...(run.gpuStubs ? { gpuStubs: true } : {}),
      consoleSink: (e) =>
        cpuLines.push({ method: e.method, args: e.args, invocation: e.invocation ?? pixel }),
    });
    for (const [name, b] of Object.entries(run.bindings)) m.setBinding(name, structuredClone(b));
    if (run.kind === 'render') {
      const [w, h] = run.size;
      cpuValues = [];
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          if (!inside(x, y)) {
            cpuValues.push(0, 0, 0, 0);
            continue;
          }
          pixel = [x, y, 0];
          const color = run.fragmentColor(m.fns[run.fragment](...run.fragmentArgs(x, y)));
          // What an rgba8unorm target stores: clamped, rounded to 1/255. A float target stores the
          // value, which the run's tolerance holds to what its format keeps.
          cpuValues.push(
            ...(run.target === undefined
              ? color.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255) / 255)
              : color),
          );
        }
    } else {
      const bound = structuredClone(run.bindings[run.read]);
      m.setBinding(run.read, bound);
      for (let i = 0; i < (run.repeat ?? 1); i++) m.dispatch(run.entry, run.workgroups);
      cpuValues = run.flattenCpu ? run.flattenCpu(bound) : bound;
    }
  } catch (e) {
    fail(job.id, `CPU oracle threw: ${e.message}`);
    continue;
  }
  const c = worst(cpuValues, expected, run.tolerance);
  if (!c.ok) fail(job.id, `CPU oracle result off by ${c.text} (tolerance ${run.tolerance})`);

  // The console lines: decoded from WebGPU, delivered on the CPU, and the host's own, all equal.
  if (run.console) {
    // A compute run dispatches `repeat` times, each into a console buffer of its own, and each
    // dispatch makes the same calls.
    const dispatches = run.kind === 'render' ? 1 : (run.repeat ?? 1);
    const want = Array.from({ length: dispatches }, () => run.console.expected()).flat();
    const tolerance = run.console.tolerance ?? 0;
    // The runtime hands the sink every event it decoded, and `submit()` resolves to what each
    // console buffer held: a row for each dispatch or draw, its entry, the lines it kept and the
    // calls that did not fit.
    const gpuLines = gpu.events;
    const decoded = { dropped: gpu.rows.reduce((n, r) => n + r.dropped, 0) };
    const counted = gpu.rows.reduce((n, r) => n + r.lines, 0);
    const recorder = run.kind === 'render' ? run.fragment : run.entry;
    if (gpu.rows.length !== dispatches || gpu.rows.some((r) => r.entry !== recorder))
      fail(
        job.id,
        `submit() resolved to ${gpu.rows.length} console rows (${gpu.rows.map((r) => r.entry).join(', ')}); expected ${dispatches} of "${recorder}"`,
      );
    if (counted !== gpuLines.length)
      fail(
        job.id,
        `submit() counted ${counted} console lines and the sink was handed ${gpuLines.length}`,
      );
    if (gpu.printed.length > 0)
      fail(
        job.id,
        `the runtime printed the dropped calls' warning though it was given a sink: ${gpu.printed[0]}`,
      );
    const cpuPlain = cpuLines.map((l) => ({ ...l, invocation: [...l.invocation] }));
    if (run.console.kept === undefined) {
      if (decoded.dropped > 0) fail(job.id, `WebGPU dropped ${decoded.dropped} console lines`);
      const off = firstDifference(gpuLines, want, tolerance);
      if (off) fail(job.id, `WebGPU console lines differ from the host's: ${off}`);
    } else {
      // A buffer with room for `kept` lines: that many whole lines, the rest counted as
      // dropped, and each kept line is its own pixel's. Which ones are kept is the GPU's order.
      if (
        gpuLines.length !== run.console.kept ||
        decoded.dropped !== want.length - run.console.kept
      )
        fail(
          job.id,
          `WebGPU kept ${gpuLines.length} console lines and dropped ${decoded.dropped}; expected ${run.console.kept} and ${want.length - run.console.kept}`,
        );
      const byInvocation = new Map(want.map((l) => [l.invocation.join(','), l]));
      for (const l of gpuLines) {
        const own = byInvocation.get(l.invocation.join(','));
        const off = own ? firstDifference([l], [own], tolerance) : 'no such invocation';
        if (off) fail(job.id, `a kept WebGPU console line is not its own: ${off}`);
      }
    }
    const offCpu = firstDifference(cpuPlain, want, tolerance);
    if (offCpu) fail(job.id, `CPU oracle console lines differ from the host's: ${offCpu}`);
    console.log(
      `     ${job.id.padEnd(16)} console: ${gpuLines.length} lines from WebGPU` +
        (decoded.dropped > 0 ? `, ${decoded.dropped} dropped` : ''),
    );
  } else if (gpu.rows.length > 0)
    fail(
      job.id,
      `submit() resolved to ${gpu.rows.length} console rows for a run that does not record`,
    );
  console.log(
    `${g.ok && c.ok ? 'ok  ' : 'FAIL'} ${job.id.padEnd(16)} ${job.spec.title}${run.emit ? ` (packed with ${JSON.stringify(run.emit)})` : ''}: ${expected.length} values, worst relative error WebGPU ${g.text}, CPU oracle ${c.text}`,
  );
}
for (const job of engines) {
  const { run } = job;
  let got;
  try {
    got = await page.evaluate(runEngine, {
      url: job.url,
      programs: job.programs,
      size: run.size,
      frames: run.frames,
    });
  } catch (e) {
    fail(job.id, `the engine threw: ${e.message.split('\n')[0]}`);
    continue;
  }
  if (got.error) {
    fail(job.id, `the engine, on typeshade/runtime: ${got.error}`);
    continue;
  }
  const made = Object.entries(got.made);
  if (made.length > 0)
    fail(
      job.id,
      `frames 2 to ${run.frames} made GPU objects: ${made.map(([k, v]) => `${k} ${v}`).join(', ')}`,
    );
  const g = worst(got.values, run.expected(), run.tolerance);
  if (!g.ok) fail(job.id, `the last frame is off by ${g.text} (tolerance ${run.tolerance})`);
  const after = made.reduce((n, [, v]) => n + v, 0);
  console.log(
    `${g.ok && after === 0 && !job.offence ? 'ok  ' : 'FAIL'} ${job.id.padEnd(16)} ${job.spec.title}: ${run.frames} frames, ${after} GPU objects made after the first; the last frame's worst error ${g.text}`,
  );
}
await browser.close();
server.close();

// A kernel function on the CPU oracle: called with the journey's own host values, `repeat`
// times, and the array it writes read back.
for (const job of kernels) {
  const { run } = job;
  const expected = run.expected();
  let values;
  try {
    const m = compileModule(job.module);
    const args = structuredClone(run.args);
    for (let i = 0; i < (run.repeat ?? 1); i++) m.fns[run.fn](...Object.values(args));
    values = run.flatten(args[run.read]);
  } catch (e) {
    fail(job.id, `CPU oracle threw: ${e.message}`);
    continue;
  }
  const c = worst(values, expected, run.tolerance);
  if (!c.ok) fail(job.id, `CPU oracle result off by ${c.text} (tolerance ${run.tolerance})`);
  console.log(
    `${c.ok ? 'ok  ' : 'FAIL'} ${job.id.padEnd(16)} ${job.spec.title}: ${expected.length} values, worst relative error CPU oracle ${c.text} (WebGPU through the import journey)`,
  );
}

if (failures.length > 0) {
  console.log(`\n${failures.length} failure(s):`);
  for (const f of failures) console.log(`  ${f}`);
  process.exit(1);
}
console.log(
  `\n${journeys.length} journeys, ${jobs.length + kernels.length + engines.length} runs: every check passed.`,
);
