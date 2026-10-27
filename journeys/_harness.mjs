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
//   5. each run that does not record the console produces it on a runtime of the WebGL2 tier too
//      (change 0054): a compute run through the pass program its manifest carries, a render run
//      through its vertex and fragment programs;
//   6. the same run on the CPU oracle (`compileModule`) produces it too.
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
// clears the target, so that the read is held to the frame submitted before it. A render run may
// name a depth format (`depth`, `depth24plus` or `depth24plus-stencil8`): its pipeline tests that
// format, and its pass draws into a depth target of it, cleared to 1, beside the colour. The
// harness writes no WebGPU of its own.
//
// A run of an engine (`kind: 'engine'`, change 0025) is a host module that draws frames on the
// runtime's public exports alone: the harness refuses any other import and any WebGPU call in
// it, hands it a device, runs its frames, counts the GPU objects each frame after the first
// creates, which must be none, and holds the last frame to the journey's reference.
//
// A run of a kernel function (`kind: 'kernel'`, change 0013) is called with the journey's own
// host values. It runs here on the CPU oracle, and on WebGPU through the import, which is how a
// host calls one and which `journeys/_host-import` checks (`scripts/user-journey.ts`).
//
// A run of a limits host (`kind: 'limits'`, change 0051) is a host module that calls the runtime
// alone, as an engine does, and names one program of its journey. The page asks the default
// device, which WebGPU gives eight storage buffers per stage, to run the entry, and the runtime
// must refuse it by name (R4). Then the page runs the entry on a device the runtime requests with
// the limit the entry needs, where the adapter allows it, and holds the result to the journey's
// numbers. Where the adapter allows fewer, the run reports the second half as skipped.
//
// A run of a fuse scope (`kind: 'fuse'`, change 0058) is a host module that calls kernel functions
// inside `fuse()` from `typeshade/fuse`. The harness gives the page the shader modules the Vite
// plugin generates under `typeshade({ fuse: true })`, runs the host on WebGPU, WebGL2 and the CPU
// tier, counts the dispatches, the submissions and the buffers of one array's size that the device
// itself is given, and holds the host's report (its groups, which of them fused and why the others
// did not) and its result to the journey's numbers and reference. A scratch array a group holds as
// a local is a buffer the device is never asked for, which the count of buffers shows. It also
// counts the indirect dispatches among the dispatches, and the buffers the device maps but those
// of the timestamps, which a run holds to its reads to show that nothing was read back between
// the calls (change 0094).

import { compile, compileModule, packModule } from 'typeshade';
import { createTypeshadeLanguageService } from 'typeshade/language-service';
import { typeshade } from 'typeshade/vite';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { engineOffence } from './engine-boundary.mjs';

const ROOT = 'journeys';
const PLAYWRIGHT = process.env.TYPESHADE_PLAYWRIGHT;
const CHROMIUM = process.env.TYPESHADE_CHROMIUM || undefined;
// The canonical gate stages the shared helper as plain JS, including for Node 20.
// Standalone software stays compatible; native must never silently fall back.
const GATE_BROWSER = process.env.TYPESHADE_GATE_BROWSER_MODULE;
if (GATE_BROWSER !== undefined && !GATE_BROWSER.startsWith('file://'))
  throw new Error('TYPESHADE_GATE_BROWSER_MODULE must be an absolute file URL');
if (
  GATE_BROWSER === undefined &&
  process.env.TYPESHADE_GPU_BACKEND !== undefined &&
  process.env.TYPESHADE_GPU_BACKEND !== 'software'
)
  throw new Error(
    'native/custom GPU backend requires TYPESHADE_GATE_BROWSER_MODULE; run the canonical gate:journeys command',
  );
const gateBrowser = GATE_BROWSER === undefined ? undefined : await import(GATE_BROWSER);
const browserSettings = gateBrowser?.gateBrowserSettings(process.env);
if (!PLAYWRIGHT) throw new Error('TYPESHADE_PLAYWRIGHT must point at playwright/index.mjs');
const { chromium } = await import(pathToFileURL(PLAYWRIGHT).href);

/** The targets a render run may name: floats, which the harness reads back as numbers with
 *  `readFloats()` and does not clamp. Without one the run draws into an `rgba8unorm` target. */
const FLOAT_TARGETS = new Set(['rgba16float', 'rgba32float']);
/** The integer targets a draws run may name: their texels are read as they are (proposal 0064, PR-3). */
const INT_TARGETS = new Set(['rgba8uint']);

/** The depth formats a render run may name: its pipeline tests the format, and the pass draws into
 *  a depth target of it, cleared to 1. The colour is what the harness reads back. */
const DEPTH_TARGETS = new Set(['depth24plus', 'depth24plus-stencil8', 'depth32float']);

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

/** Plain `tsc` cannot model the override-sized workgroup arrays in these journeys. */
const isDocumentedTsc = (code, line) =>
  TSC_DOCUMENTED.has(code) ||
  (['TS2454', 'TS2749'].includes(code) &&
    /(?:workgroup-override(?:-f64)?[\\/]copy|_host-import[\\/]src[\\/](?:overrides|override-double))\.shade\.ts/.test(
      line,
    ));

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
    if (!isDocumentedTsc(code, line)) fail('tsc -p tsconfig.shade.json', line.trim());
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
const fuses = [];
const limitsRuns = [];
/** The shader modules a fuse host imports, as the plugin generates them, by the URL the page
 *  asks for. */
const hostModules = new Map();

/** What an engine may import: the runtime's public subpath, and nothing else. */
const ENGINE_IMPORTS = new Set(['typeshade/runtime']);
/** What a fuse host may import: the runtime, the fuse plug-in and the journey's own shaders. */
const FUSE_IMPORTS = {
  allows: (spec) =>
    spec === 'typeshade/runtime' ||
    spec === 'typeshade/fuse' ||
    /^\.\/[\w-]+\.shade\.ts$/.test(spec),
  why: 'is none of typeshade/runtime, typeshade/fuse and a shader module of the journey',
};
/** The engine boundary's check of a source: the imports it may make, and the WebGPU calls it may not
 *  make (`engine-boundary.mjs`, which `src/journeys-boundary.test.ts` reads too). */
const ENGINE_CHECK = {
  allows: (spec) => ENGINE_IMPORTS.has(spec),
  why: "is not the runtime's public subpath",
};
for (const id of journeys) {
  const spec = (await import(pathToFileURL(join(process.cwd(), ROOT, id, 'journey.mjs')).href))
    .default;
  for (const [n, run] of spec.runs.entries()) {
    if (run.kind === 'fuse') {
      const offence = engineOffence(readFileSync(join(ROOT, id, run.host), 'utf8'), FUSE_IMPORTS);
      if (offence) fail(`${id}#${n}`, `${run.host} ${offence}`);
      for (const file of readdirSync(join(ROOT, id)).filter((f) => f.endsWith('.shade.ts'))) {
        const path = join(process.cwd(), ROOT, id, file);
        try {
          // The facts and the loop IR a scope fuses a chain from are written under `fuse: true`.
          const out = await typeshade({ fuse: true }).transform(readFileSync(path, 'utf8'), path);
          hostModules.set(`/${ROOT}/${id}/${file}`, out.code);
        } catch (e) {
          fail(`${id}#${n}`, `the host module of ${file}: ${e.message.split('\n')[0]}`);
        }
      }
      fuses.push({ id: `${id}#${n}`, spec, run, url: `/${ROOT}/${id}/${run.host}`, offence });
      continue;
    }
    if (run.kind === 'limits') {
      // A limits host (change 0051) imports the runtime alone, like an engine, and names one
      // program that the harness compiles and packs.
      const offence = engineOffence(readFileSync(join(ROOT, id, run.host), 'utf8'));
      if (offence) fail(`${id}#${n}`, `${run.host} ${offence}`);
      const r = compiled.get(join(ROOT, id, run.program));
      if (r?.module)
        limitsRuns.push({
          id: `${id}#${n}`,
          spec,
          run,
          url: `/journeys/${id}/${run.host}`,
          program: packModule(r.module),
          offence,
        });
      continue;
    }
    if (run.kind === 'engine') {
      const source = readFileSync(join(ROOT, id, run.engine), 'utf8');
      const offence = engineOffence(source, ENGINE_CHECK);
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
    if (
      run.target !== undefined &&
      (run.kind !== 'render' || (!FLOAT_TARGETS.has(run.target) && !INT_TARGETS.has(run.target)))
    ) {
      fail(
        `${id}#${n}`,
        `target ${JSON.stringify(run.target)}: a render run's target is one of ${[...FLOAT_TARGETS, ...INT_TARGETS].join(', ')}, or none for an rgba8unorm one`,
      );
      continue;
    }
    if (run.depth !== undefined && (run.kind !== 'render' || !DEPTH_TARGETS.has(run.depth))) {
      fail(
        `${id}#${n}`,
        `depth ${JSON.stringify(run.depth)}: a render run's depth is one of ${[...DEPTH_TARGETS].join(', ')}, or none for no depth target`,
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
    ...(job.tier !== undefined ? { prefer: [job.tier] } : {}),
    console: (e) => events.push(e),
    ...(job.consoleCapacity !== undefined ? { consoleBytes: 4 * (2 + job.consoleCapacity) } : {}),
  });
  const TYPED = { u32: Uint32Array, i32: Int32Array, f32: Float32Array, f64: Float64Array };
  const bindings = {};
  for (const [name, b] of Object.entries(job.bindings))
    bindings[name] = b.typed ? new TYPED[b.typed](b.data) : b.value;
  // A run that needs a WebGL2 extension does not run on a context that lacks it: it reports so.
  if (
    job.requires !== undefined &&
    rt.tier === 'webgl2' &&
    rt.device.getExtension(job.requires) === null
  )
    return { notRun: job.requires };
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
  let hostState;
  let glError;
  let depthValues;
  let rows = [];
  let error = null;
  try {
    if (job.tier !== undefined && rt.tier !== job.tier)
      throw new Error(`the runtime runs on ${rt.tier}, not ${job.tier}`);
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
    } else if (job.draws !== undefined) {
      // Several draws into one pass, each with the state its item names (proposal 0064, PR-1): a
      // scissor, a viewport, a pass blend constant, and a pipeline that blends with the constant
      // or declares one of its own. The pipelines are made first, since a pass records synchronously.
      const [w, h] = job.size;
      const format = job.target ?? 'rgba8unorm';
      const target = rt.texture({ size: [w, h], format });
      const depth =
        job.depth === undefined ? undefined : rt.texture({ size: [w, h], format: job.depth });
      const made = new Map();
      const built = [];
      for (const item of job.draws) {
        const state = {
          vertex: item.vertex ?? job.vertex,
          fragment: item.fragment ?? job.fragment,
          targets: [
            {
              format,
              ...(item.colorWrite === false
                ? { writeMask: 0 }
                : item.writeMask !== undefined
                  ? { writeMask: item.writeMask }
                  : {}),
              ...(item.blend === 'constant'
                ? {
                    blend: {
                      color: {
                        srcFactor: 'constant',
                        dstFactor: 'one-minus-constant',
                        operation: 'add',
                      },
                      alpha: {
                        srcFactor: 'constant',
                        dstFactor: 'one-minus-constant',
                        operation: 'add',
                      },
                    },
                  }
                : {}),
            },
          ],
          ...(job.depth !== undefined ? { depth: { format: job.depth, ...item.depth } } : {}),
          ...(item.topology !== undefined ? { primitive: { topology: item.topology } } : {}),
          ...(item.mask !== undefined ? { multisample: { mask: item.mask } } : {}),
          ...(item.pipelineBlend !== undefined ? { blendConstant: item.pipelineBlend } : {}),
          ...(item.constants !== undefined ? { constants: item.constants } : {}),
        };
        const key = JSON.stringify(state);
        if (!made.has(key)) made.set(key, await program.render(state));
        built.push(made.get(key));
      }
      // One pass per value of `pass` (0 when omitted), in order. A pass after the first loads the
      // colour and the depth, so the stencil and the depth it wrote persist (the E1 fix).
      const passes = [];
      job.draws.forEach((item, i) => {
        const n = item.pass ?? 0;
        (passes[n] ??= []).push(i);
      });
      const f = rt.frame();
      passes.forEach((indices, n) => {
        // A run states a pass's attachments whole with `passes[n]`; the default is the first pass
        // clears, and a later one loads (proposal 0064, PR-1 and PR-2).
        const spec = job.passes?.[n] ?? {};
        const colour = {
          target,
          ...(spec.color ?? (n === 0 ? { clear: [0, 0, 0, 0] } : { load: 'load' })),
        };
        const dep =
          depth === undefined
            ? undefined
            : spec.depth !== undefined
              ? { target: depth, ...spec.depth }
              : n === 0
                ? depth
                : { target: depth, load: 'load' };
        f.pass({ color: [colour], depth: dep }, (p) => {
          for (const i of indices) {
            const item = job.draws[i];
            if (item.scissor) p.setScissorRect(...item.scissor);
            if (item.viewport) p.setViewport(...item.viewport);
            if (item.passBlend) p.setBlendConstant(item.passBlend);
            if (item.passStencil !== undefined) p.setStencilReference(item.passStencil);
            p.draw(built[i], bindings, { count: item.count ?? 3 });
          }
        });
      });
      rows = (await f.submit()).console;
      // WebGL2 keeps the first error a call raised until it is read: a run with one fails.
      if (rt.tier === 'webgl2') glError = rt.device.getError();
      values = job.integer
        ? [...(await target.read())]
        : [...(await target.read())].map((v) => v / 255);
      // The depth of a `readDepth` run, read from its depth32float target (readFloats takes that format).
      depthValues = job.readDepth ? [...(await depth.readFloats())] : undefined;
    } else {
      const [w, h] = job.size;
      const format = job.target ?? 'rgba8unorm';
      // A depth run's pipeline tests the depth format with the runtime's defaults, and its pass
      // draws into a depth target of that format, cleared to 1 (surface §69).
      const pipeline = await program.render({
        vertex: job.vertex,
        fragment: job.fragment,
        targets: [format],
        constants: job.constants,
        ...(job.depth !== undefined ? { depth: { format: job.depth } } : {}),
      });
      const target = rt.texture({ size: [w, h], format });
      const depth =
        job.depth === undefined ? undefined : rt.texture({ size: [w, h], format: job.depth });
      const f = rt.frame();
      f.pass({ color: [{ target, clear: [0, 0, 0, 0] }], depth }, (p) => {
        // The scissor and the viewport are the pass's own calls (proposal 0064, PR-1).
        if (job.scissor) p.setScissorRect(...job.scissor);
        if (job.viewport) p.setViewport(...job.viewport);
        p.draw(pipeline, bindings, { count: 3 });
      });
      if (job.target === undefined) {
        // The host state leg (O10, WebGL2 only): the host's own GL state is set before the submit,
        // the pass runs, and the state after it is read, with a kernel pass run after the render.
        const gl = job.hostState && rt.tier === 'webgl2' ? rt.device : undefined;
        if (gl !== undefined) {
          gl.viewport(1, 2, 3, 4);
          gl.depthRange(0.125, 0.875);
          gl.blendColor(0.5, 0.25, 0.125, 0.0625);
          gl.enable(gl.SCISSOR_TEST);
          gl.scissor(1, 1, 2, 2);
          gl.colorMask(true, false, true, false);
          gl.depthMask(false);
          gl.stencilMask(0x0f);
        }
        rows = (await f.submit()).console;
        if (gl !== undefined) {
          const bits = (v) => Number(v) & 0xff;
          hostState = {
            viewport: [...gl.getParameter(gl.VIEWPORT)],
            depthRange: [...gl.getParameter(gl.DEPTH_RANGE)],
            blend: [...gl.getParameter(gl.BLEND_COLOR)],
            scissor: gl.isEnabled(gl.SCISSOR_TEST),
            colorMask: [...gl.getParameter(gl.COLOR_WRITEMASK)],
            depthMask: gl.getParameter(gl.DEPTH_WRITEMASK),
            stencilMask: bits(gl.getParameter(gl.STENCIL_WRITEMASK)),
            error: gl.getError(),
          };
          // A kernel pass after the render pass still runs, and writes what it should.
          const out = resident(new Float32Array(1));
          const next = rt.frame();
          next.dispatch(await program.compute('bump'), { out }, 1);
          await next.submit();
          hostState.bump = [...(await out.read())];
        }
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
    depthValues,
    after,
    hostState,
    glError,
    // What `submit()` said each console buffer held, a plain copy for the page to hand back.
    rows: rows.map((r) => ({ entry: r.entry, lines: r.lines, dropped: r.dropped })),
    printed,
    events: events.map((e) => ({
      method: e.method,
      args: e.args,
      invocation: e.invocation ? [...e.invocation] : undefined,
    })),
    tier: rt.tier,
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

/** Runs INSIDE the page: a limits host's two halves (change 0051). The default device refuses the
 *  entry, and the device the runtime requests runs it where the adapter allows the limit. */
async function runLimits(job) {
  try {
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();
    const host = await import(job.url);
    const refusal = await host.refused({ device, program: job.program });
    const have = device.limits.maxStorageBuffersPerShaderStage;
    const adapterHas = adapter.limits.maxStorageBuffersPerShaderStage;
    if (adapterHas < job.need) return { refusal, have, adapterHas, values: null };
    const values = await host.requested({ program: job.program, size: job.size });
    return { refusal, have, adapterHas, values };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** Runs INSIDE the page: a fuse host's run on one tier. The device is not instrumented: the
 *  queue's `submit`, the compute pass's `dispatchWorkgroups` and the device's `createBuffer` are
 *  counted on their prototypes, so that the host's report can be held to what the device was
 *  given. `sizes` are the byte sizes of the buffers it was asked to make. */
async function runFuse(job) {
  const submit = GPUQueue.prototype.submit;
  const dispatch = GPUComputePassEncoder.prototype.dispatchWorkgroups;
  const indirect = GPUComputePassEncoder.prototype.dispatchWorkgroupsIndirect;
  const createBuffer = GPUDevice.prototype.createBuffer;
  const mapAsync = GPUBuffer.prototype.mapAsync;
  const resolveQuerySet = GPUCommandEncoder.prototype.resolveQuerySet;
  const copy = GPUCommandEncoder.prototype.copyBufferToBuffer;
  const seen = { submits: 0, dispatches: 0, indirect: 0, maps: 0, sizes: [] };
  // The buffers that hold a pass's timestamps (change 0066), resolved and then staged: mapping
  // one reads a time, not a value of the program.
  const stamps = new WeakSet();
  GPUCommandEncoder.prototype.resolveQuerySet = function (...a) {
    stamps.add(a[3]);
    return resolveQuerySet.apply(this, a);
  };
  GPUCommandEncoder.prototype.copyBufferToBuffer = function (...a) {
    if (stamps.has(a[0])) stamps.add(typeof a[1] === 'number' ? a[2] : a[1]);
    return copy.apply(this, a);
  };
  GPUQueue.prototype.submit = function (...a) {
    seen.submits++;
    return submit.apply(this, a);
  };
  GPUComputePassEncoder.prototype.dispatchWorkgroups = function (...a) {
    seen.dispatches++;
    return dispatch.apply(this, a);
  };
  // An indirect dispatch is a dispatch the report counts once, whatever its counts hold (change
  // 0094); it is also counted apart.
  GPUComputePassEncoder.prototype.dispatchWorkgroupsIndirect = function (...a) {
    seen.dispatches++;
    seen.indirect++;
    return indirect.apply(this, a);
  };
  // Each read back maps a buffer: a host's `read()` and a call that reads a result.
  GPUBuffer.prototype.mapAsync = function (...a) {
    if (!stamps.has(this)) seen.maps++;
    return mapAsync.apply(this, a);
  };
  GPUDevice.prototype.createBuffer = function (...a) {
    seen.sizes.push(a[0].size);
    return createBuffer.apply(this, a);
  };
  try {
    const host = await import(job.url);
    const { values, report } = await host.run(job.tier, job.inputs);
    return { values, report, seen };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  } finally {
    GPUQueue.prototype.submit = submit;
    GPUComputePassEncoder.prototype.dispatchWorkgroups = dispatch;
    GPUComputePassEncoder.prototype.dispatchWorkgroupsIndirect = indirect;
    GPUDevice.prototype.createBuffer = createBuffer;
    GPUBuffer.prototype.mapAsync = mapAsync;
    GPUCommandEncoder.prototype.resolveQuerySet = resolveQuerySet;
    GPUCommandEncoder.prototype.copyBufferToBuffer = copy;
  }
}

const browser = await chromium.launch(
  browserSettings?.launch ?? {
    executablePath: CHROMIUM,
    args: [
      '--enable-unsafe-webgpu',
      '--enable-unsafe-swiftshader',
      '--use-angle=swiftshader',
      '--use-vulkan=swiftshader',
      '--enable-features=Vulkan',
    ],
  },
);
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
  // A shader module a fuse host imports, as the plugin generates it.
  const generated = hostModules.get(url.pathname);
  if (generated !== undefined) {
    res.setHeader('content-type', 'text/javascript; charset=utf-8');
    res.end(generated);
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
      '<script type="importmap">{"imports":{' +
      '"typeshade/runtime":"/typeshade/runtime.js",' +
      '"typeshade/runtime/internal":"/typeshade/runtime-internal.js",' +
      '"typeshade/fuse":"/typeshade/fuse.js"}}</script>',
  );
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
if (gateBrowser !== undefined) {
  try {
    await gateBrowser.verifyGateGpu(
      browser,
      `http://127.0.0.1:${server.address().port}/`,
      browserSettings,
      { webgpu: true, webgl: true },
    );
  } catch (error) {
    server.close();
    await browser
      .close()
      .catch((cleanup) => console.error('journey browser cleanup also failed', cleanup));
    throw error;
  }
}
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

// The compute and render runs that ran on WebGL2, and the ones with no WebGL2 program.
let glRuns = 0;
let glDraws = 0;
let glNone = 0;
let glRefused = 0;
// The runs whose WebGL2 leg needs an extension the context lacks: reported, not run.
let glNotRun = 0;
/** Why a manifest's WebGL2 program is none, `'missing'` where it carries none, or undefined. */
const noProgram = (p) => (p === undefined ? 'missing' : 'none' in p ? p.none : undefined);
for (const job of jobs) {
  const { run } = job;
  let expected;
  // A scissor rectangle and a viewport keep the pixels they cover; the others keep the clear value,
  // 0. A run of several draws keeps each pixel its expected function gives (proposal 0064, PR-1).
  const within = (x, y, [rx, ry, rw, rh]) => x >= rx && x < rx + rw && y >= ry && y < ry + rh;
  const inside = (x, y) =>
    run.draws !== undefined ||
    ((!run.scissor || within(x, y, run.scissor)) && (!run.viewport || within(x, y, run.viewport)));
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
      viewport: run.viewport,
      draws: run.draws,
      constants: run.constants,
      target: run.target,
      depth: run.depth,
      passes: run.passes,
      readDepth: run.readDepth,
      integer: run.integer,
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
  if (run.expectedDepth !== undefined) {
    const [dw, dh] = run.size;
    const wantDepth = [];
    for (let y = 0; y < dh; y++)
      for (let x = 0; x < dw; x++) wantDepth.push(run.expectedDepth(x, y));
    const gd = worst(gpu.depthValues ?? [], wantDepth, run.tolerance);
    if (!gd.ok) fail(job.id, `WebGPU depth off by ${gd.text} (tolerance ${run.tolerance})`);
  }
  // A float target was read while a later frame was submitted after the read: the frame ran, and
  // cleared every channel of the target to -1, which the read must not have seen.
  if (run.target !== undefined && run.draws === undefined) {
    const cleared = gpu.after?.length === expected.length && gpu.after.every((v) => v === -1);
    if (!cleared)
      fail(
        job.id,
        'the frame submitted after the read did not clear the target: the read cannot be shown to precede it',
      );
  }

  // WebGL2 (change 0054): the run again on a runtime of the WebGL2 tier, held to the same
  // reference. A compute run runs the pass program its manifest carries, and a render run links
  // its vertex and fragment programs. A run that records the console is WebGPU's alone, since
  // the WebGL2 tier does not record. A scissor and a viewport are the pass's own calls on both
  // tiers (proposal 0064, PR-1), so a scissor run runs here too. A program with none says why.
  let gl = '';
  if (run.console === undefined) {
    const none =
      run.kind === 'compute'
        ? noProgram(job.pack.gl?.computes?.[run.entry])
        : (noProgram(job.pack.gl?.vertices?.[run.vertex]) ??
          noProgram(job.pack.gl?.draws?.[run.fragment]));
    if (none === 'missing') fail(job.id, 'the manifest carries no WebGL2 program for the run');
    else if (none !== undefined) {
      if (run.webgl2Must) fail(job.id, `the WebGL2 leg did not run: ${none}`);
      glNone++;
      gl = `, WebGL2 none (${none})`;
    } else {
      let ran;
      try {
        ran = await page.evaluate(runOnGpu, {
          kind: run.kind,
          tier: 'webgl2',
          pack: job.pack,
          bindings: job.bindings,
          entry: run.entry,
          workgroups: run.workgroups,
          repeat: run.repeat ?? 1,
          read: run.read,
          vertex: run.vertex,
          fragment: run.fragment,
          size: run.size,
          scissor: run.scissor,
          viewport: run.viewport,
          draws: run.draws,
          hostState: run.hostState,
          constants: run.constants,
          target: run.target,
          depth: run.depth,
          passes: run.passes,
          readDepth: run.readDepth,
          integer: run.integer,
          requires: run.webgl2Requires,
        });
      } catch (e) {
        ran = { error: `threw: ${e.message.split('\n')[0]}` };
      }
      if (ran.notRun !== undefined) {
        if (run.webgl2Must) fail(job.id, `the WebGL2 leg did not run: ${ran.notRun} absent`);
        glNotRun++;
        gl = `, WebGL2 not run (${ran.notRun} absent)`;
      } else if (ran.error && run.webgl2Unsupported !== undefined) {
        if (ran.error.includes(run.webgl2Unsupported)) {
          glRefused++;
          gl = `, WebGL2 expected refusal (${run.webgl2Unsupported})`;
        } else fail(job.id, `WebGL2 refusal differed: ${ran.error}`);
      } else if (ran.error) fail(job.id, `WebGL2, through typeshade/runtime: ${ran.error}`);
      else if (run.webgl2Unsupported !== undefined)
        fail(
          job.id,
          `WebGL2 unexpectedly ran; expected refusal containing "${run.webgl2Unsupported}"`,
        );
      else {
        if (run.kind === 'compute') glRuns++;
        else glDraws++;
        const w = worst(ran.values, expected, run.tolerance);
        if (!w.ok) fail(job.id, `WebGL2 result off by ${w.text} (tolerance ${run.tolerance})`);
        if (run.expectedDepth !== undefined) {
          const [dw, dh] = run.size;
          const wantDepth = [];
          for (let y = 0; y < dh; y++)
            for (let x = 0; x < dw; x++) wantDepth.push(run.expectedDepth(x, y));
          const wd = worst(ran.depthValues ?? [], wantDepth, run.tolerance);
          if (!wd.ok) fail(job.id, `WebGL2 depth off by ${wd.text} (tolerance ${run.tolerance})`);
        }
        // A draws run on WebGL2 must leave the context with no error (proposal 0064, PR-2, H3).
        if (ran.glError !== undefined && ran.glError !== 0)
          fail(job.id, `WebGL2 error 0x${ran.glError.toString(16)} after the pass`);
        // The O10 leg: the host's GL state is what it was before the pass, and a kernel pass after
        // the render pass still wrote its value (proposal 0064, O10).
        if (run.hostState) {
          const want = {
            viewport: [1, 2, 3, 4],
            depthRange: [0.125, 0.875],
            blend: [0.5, 0.25, 0.125, 0.0625],
            scissor: false,
            colorMask: [true, true, true, true],
            depthMask: true,
            stencilMask: 0xff,
            error: 0,
            bump: [7],
          };
          const got = JSON.stringify(ran.hostState);
          if (got !== JSON.stringify(want))
            fail(
              job.id,
              `WebGL2 host state after the pass: ${got}, expected ${JSON.stringify(want)}`,
            );
        }
        if (run.target !== undefined && run.draws === undefined) {
          const cleared = ran.after?.length === expected.length && ran.after.every((v) => v === -1);
          if (!cleared)
            fail(
              job.id,
              'on WebGL2, the frame submitted after the read did not clear the target: the read cannot be shown to precede it',
            );
        }
        gl = `, WebGL2 ${w.text}`;
      }
    }
  }

  // The CPU oracle, and the console lines it delivers to the sink.
  let cpuValues;
  const cpuLines = [];
  // The pixel a render's fragment entry is running for, which is the invocation a line
  // decoded from WebGPU carries (surface §66).
  let pixel;
  const oracle = run.cpuOracle !== false;
  try {
    // A run with `constants` sets the program's overrides by name on its pipeline. The oracle
    // receives those same values so workgroup dimensions and scratch arrays match (surface §69).
    if (oracle) {
      const m = compileModule(job.module, {
        overrides: run.constants,
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
    }
  } catch (e) {
    fail(job.id, `CPU oracle threw: ${e.message}`);
    continue;
  }
  // A run that skips the oracle (`cpuOracle: false`) reports it as not run.
  const c = oracle ? worst(cpuValues, expected, run.tolerance) : { ok: true, text: 'not run' };
  if (oracle && !c.ok)
    fail(job.id, `CPU oracle result off by ${c.text} (tolerance ${run.tolerance})`);

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
    `${g.ok && c.ok ? 'ok  ' : 'FAIL'} ${job.id.padEnd(16)} ${job.spec.title}${run.emit ? ` (packed with ${JSON.stringify(run.emit)})` : ''}: ${expected.length} values, worst relative error WebGPU ${g.text}${gl}, CPU oracle ${c.text}`,
  );
}
// The WebGL2 arm must run something: a manifest that carried no pass program would pass it
// vacuously.
if (glRuns === 0) fail('webgl2', 'no compute run ran on the WebGL2 tier of typeshade/runtime');
if (glDraws === 0) fail('webgl2', 'no render run drew on the WebGL2 tier of typeshade/runtime');
const expectedRefusals = jobs.filter((job) => job.run.webgl2Unsupported !== undefined);
if (glRefused < expectedRefusals.length)
  fail('webgl2', `observed ${glRefused} expected refusals; wanted ${expectedRefusals.length}`);
console.log(
  `     WebGL2 tier of typeshade/runtime: ${glRuns} compute runs and ${glDraws} render runs, ${glNone} with no program, ${glRefused} expected refusals, ${glNotRun} not run (extension absent)`,
);
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
/** The fuse runs, on each tier. What the report says is held to what the device was given.
 *  Only WebGPU fuses: on WebGL2 each loop is a draw of its own and the report says the calls run
 *  apart, and the CPU tier runs them one after another and says nothing. `groups` are the calls of
 *  each group, in order, and `why` is each group's reason to stand apart (none for the first). */
const FUSE_TIERS = {
  webgpu: (run) => ({
    groups: run.webgpu.groups,
    why: run.webgpu.why ?? [],
    dispatches: run.webgpu.dispatches,
    submissions: run.webgpu.submissions,
    buffers: run.webgpu.buffers,
    indirect: run.webgpu.indirect,
    maps: run.webgpu.maps,
    seen: true,
  }),
  webgl2: (run) => ({
    groups: run.calls.map((c) => [c]),
    // A call WebGL2 has no program for runs on the CPU tier, which says nothing: `webgl2.why`.
    why:
      run.webgl2.why ??
      run.calls.map((_, i) => (i === 0 ? undefined : 'WebGL2 runs the calls apart')),
    dispatches: run.webgl2.dispatches,
    submissions: 0,
    buffers: run.webgpu.buffers === undefined ? undefined : 0,
    seen: false,
  }),
  cpu: (run) => ({
    groups: run.calls.map((c) => [c]),
    why: [],
    dispatches: 0,
    submissions: 0,
    buffers: run.webgpu.buffers === undefined ? undefined : 0,
    seen: false,
  }),
};
for (const job of limitsRuns) {
  const { run } = job;
  let got;
  try {
    got = await page.evaluate(runLimits, {
      url: job.url,
      program: job.program,
      need: run.need,
      size: run.size,
    });
  } catch (e) {
    fail(job.id, `the limits host threw: ${e.message.split('\n')[0]}`);
    continue;
  }
  if (got.error) {
    fail(job.id, `the limits host, on typeshade/runtime: ${got.error}`);
    continue;
  }
  if (got.refusal === null) {
    fail(job.id, `the default device ran the entry; it has ${got.have} storage buffers per stage`);
    continue;
  }
  if (!run.refusal(got.have).test(got.refusal)) {
    fail(job.id, `the default device refused the entry with another text: ${got.refusal}`);
    continue;
  }
  if (got.values === null) {
    // The adapter allows fewer storage buffers per stage than the entry needs: the second half
    // is not run, and the run says so instead of passing it.
    console.log(
      `skip ${job.id.padEnd(16)} ${job.spec.title}: the default device refuses the entry by name (R4); the adapter allows ${got.adapterHas} storage buffers per stage, below the ${run.need} the device the runtime requests needs, so that half is not run`,
    );
    continue;
  }
  const want = run.expected();
  const bad = got.values.findIndex((v, i) => Math.abs(v - want[i]) > run.tolerance);
  if (bad >= 0)
    fail(job.id, `the requested device's out[${bad}] is ${got.values[bad]}, want ${want[bad]}`);
  console.log(
    `${bad < 0 ? 'ok  ' : 'FAIL'} ${job.id.padEnd(16)} ${job.spec.title}: the default device, ${got.have} storage buffers per stage, refuses the entry by name (R4); the adapter's ${got.adapterHas} runs it on the requested device, ${want.length} values exact`,
  );
}
for (const job of fuses) {
  const { run } = job;
  const expected = run.expected();
  const failed = failures.length;
  const done = [];
  for (const [tier, want] of Object.entries(FUSE_TIERS)) {
    const at = `${job.id} on ${tier}`;
    const n = want(run);
    let got;
    try {
      got = await page.evaluate(runFuse, { url: job.url, tier, inputs: run.inputs });
    } catch (e) {
      fail(at, `the host threw: ${e.message.split('\n')[0]}`);
      continue;
    }
    if (got.error) {
      fail(at, `the host, on typeshade/fuse: ${got.error}`);
      continue;
    }
    const w = worst(got.values, expected, run.tolerance);
    if (!w.ok) fail(at, `result off by ${w.text} (tolerance ${run.tolerance})`);
    const r = got.report;
    if (r.tier !== tier) fail(at, `the report says it ran on ${r.tier}`);
    if (r.dispatches !== n.dispatches || r.submissions !== n.submissions)
      fail(
        at,
        `the report counts ${r.dispatches} dispatches and ${r.submissions} submissions; expected ${n.dispatches} and ${n.submissions}`,
      );
    // The device is the witness: the report counts what it was given, and the host's reads are
    // submissions the report does not count.
    const device = n.seen
      ? { submits: n.submissions + run.reads, dispatches: n.dispatches }
      : { submits: 0, dispatches: 0 };
    if (got.seen.submits !== device.submits || got.seen.dispatches !== device.dispatches)
      fail(
        at,
        `the device was given ${got.seen.dispatches} dispatches and ${got.seen.submits} submissions; expected ${device.dispatches} and ${device.submits}`,
      );
    // The indirect dispatches among them, and the buffers the device mapped but those of the
    // timestamps: with `maps` equal to the host's reads, nothing was read back while the scope ran.
    if (n.indirect !== undefined && got.seen.indirect !== n.indirect)
      fail(
        at,
        `the device was given ${got.seen.indirect} indirect dispatches; expected ${n.indirect}`,
      );
    if (n.maps !== undefined && got.seen.maps !== n.maps)
      fail(at, `the device mapped ${got.seen.maps} buffers; expected ${n.maps}`);
    // The buffers of one array's size the device was asked for: the host's own residents and the
    // staging buffer of its one `read()`, and a scratch array only where it stays a buffer.
    if (n.buffers !== undefined) {
      const made = got.seen.sizes.filter((size) => size === run.arrayBytes).length;
      if (made !== n.buffers)
        fail(
          at,
          `the device was asked for ${made} buffers of one array's size; expected ${n.buffers}`,
        );
    }
    const named = r.groups.map((g) => g.calls);
    if (JSON.stringify(named) !== JSON.stringify(n.groups))
      fail(
        at,
        `the report's groups name ${JSON.stringify(named)}; expected ${JSON.stringify(n.groups)}`,
      );
    // A group of more than one call is one dispatch, and is the only kind that is fused.
    const fused = r.groups.map((g) => g.fused);
    if (JSON.stringify(fused) !== JSON.stringify(n.groups.map((g) => g.length > 1)))
      fail(at, `the report says the groups fused ${JSON.stringify(fused)}`);
    // The reasons, word for word: a group that stands apart says why, in the author's words.
    const why = r.groups.map((g) => g.why);
    if (JSON.stringify(why) !== JSON.stringify(n.groups.map((_, i) => n.why[i])))
      fail(
        at,
        `the report's reasons are ${JSON.stringify(why)}; expected ${JSON.stringify(n.groups.map((_, i) => n.why[i]))}`,
      );
    done.push(`${tier} ${w.text}`);
  }
  console.log(
    `${failures.length === failed && !job.offence ? 'ok  ' : 'FAIL'} ${job.id.padEnd(16)} ${job.spec.title}: ${expected.length} values; worst relative error ${done.join(', ')}`,
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
  `\n${journeys.length} journeys, ${jobs.length + kernels.length + engines.length + fuses.length + limitsRuns.length} runs: every check passed.`,
);
