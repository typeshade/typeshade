// Change 0127: actual host draws and manifest draws, held to independent host arithmetic.
// The packed journey uses the same authored fixtures and values. No synthetic shader can
// satisfy a supported case: each manifest must contain the compiler's real GLSL program.
import { configure } from '../src/core/host-runtime.js';
import { byteSize, pack } from '../src/core/host-entry.js';
import { layoutFromPack } from '../src/core/manifest-types.js';
import { createRuntime, type Pack, type Runtime } from '../src/runtime.js';
import { observeDrawShaders } from '../journeys/_host-import/src/draw-shader-observer.js';
import {
  uniforms,
  valueOf,
  expectedOf,
  type UniformSpec,
} from '../journeys/bare-uniforms/values.mjs';

type Flavor = 'float' | 'integer';
type Path = 'host webgpu' | 'host webgl2' | 'host cpu' | 'manifest webgpu' | 'manifest webgl2';
export interface BareUniformRun {
  readonly name: string;
  readonly flavor: Flavor;
  readonly manifest: Pack;
  readonly call: (canvas: HTMLCanvasElement, bindings: Record<string, unknown>) => Promise<void>;
}
interface Pixels {
  readonly pixels?: readonly number[];
  readonly error?: string;
}
interface Row extends Pixels {
  readonly name: string;
  readonly flavor: Flavor;
  readonly path: Path;
  readonly changed: boolean;
}
interface BlockProbe extends Pixels {
  readonly name: string;
  readonly flavor: Flavor;
  readonly size?: number;
  readonly shortError?: number;
  readonly zeroGuard?: readonly number[];
  readonly inactive?: boolean;
}
export interface BareUniformReport {
  readonly rows: readonly Row[];
  readonly blocks: readonly BlockProbe[];
  readonly brokenShader: boolean;
  readonly flavorObserved: boolean;
  readonly instrumentError?: string;
}
const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
const matches = (got: readonly number[] | undefined, want: readonly number[]): boolean =>
  got?.length === want.length && got.every((x, i) => Math.abs(x - want[i]!) <= 1);
const expected = (spec: UniformSpec, changed: boolean): number[] =>
  expectedOf(spec, changed).map((x) => Math.round(x * 255));
const paths = (run: Pick<BareUniformRun, 'flavor'>): readonly Path[] =>
  run.flavor === 'integer'
    ? ['host webgpu', 'manifest webgpu', 'manifest webgl2']
    : ['host webgpu', 'host webgl2', 'host cpu', 'manifest webgpu', 'manifest webgl2'];

async function hostDraw(
  run: BareUniformRun,
  spec: UniformSpec,
  path: Path,
  changed: boolean,
  canvas: HTMLCanvasElement,
): Promise<Pixels> {
  const tier = path === 'host cpu' ? 'cpu' : path === 'host webgl2' ? 'webgl2' : 'webgpu';
  const kind = tier === 'cpu' ? '2d' : tier;
  if (kind === 'webgl2') canvas.getContext(kind, { antialias: false, preserveDrawingBuffer: true });
  if (kind === '2d') canvas.getContext(kind);
  try {
    await run.call(canvas, { [spec.name + 'Value']: valueOf(spec, changed) });
    if (canvas.getContext(kind) === null) throw new Error(`host draw did not run on ${tier}`);
    const copy = document.createElement('canvas');
    copy.width = copy.height = 1;
    const ctx = copy.getContext('2d')!;
    ctx.drawImage(canvas, 0, 0);
    const pixels = [...ctx.getImageData(0, 0, 1, 1).data];
    if (kind === 'webgl2') {
      const gl = canvas.getContext('webgl2')!;
      const error = gl.getError();
      if (error !== gl.NO_ERROR) throw new Error(`host WebGL error ${error}`);
    }
    return { pixels };
  } catch (error) {
    return { error: message(error) };
  }
}

async function manifestDraw(
  rt: Runtime,
  run: BareUniformRun,
  spec: UniformSpec,
  changed: boolean,
): Promise<Pixels> {
  const out = rt.texture({ size: [1, 1], format: 'rgba8unorm' });
  try {
    const pipeline = await rt
      .load(run.manifest)
      .render({ vertex: 'vs', fragment: 'fs', targets: ['rgba8unorm'] });
    const frame = rt.frame();
    frame.pass({ color: [{ target: out, clear: [1, 0, 1, 1] }] }, (pass) =>
      pass.draw(pipeline, { [spec.name + 'Value']: valueOf(spec, changed) }, { count: 3 }),
    );
    await frame.submit();
    const pixels = [...(await out.read())];
    if (rt.tier === 'webgl2') {
      const gl = rt.device as WebGL2RenderingContext;
      const error = gl.getError();
      if (error !== gl.NO_ERROR) throw new Error(`manifest WebGL error ${error}`);
    }
    return { pixels };
  } catch (error) {
    return { error: message(error) };
  } finally {
    out.destroy();
  }
}

function shader(gl: WebGL2RenderingContext, stage: number, source: string): WebGLShader {
  const result = gl.createShader(stage);
  if (result === null) throw new Error('no WebGL shader');
  gl.shaderSource(result, source);
  gl.compileShader(result);
  if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) {
    const error = gl.getShaderInfoLog(result);
    gl.deleteShader(result);
    throw new Error(error ?? 'WebGL compilation failed');
  }
  return result;
}

/** Each block uses the delivered shader and pack() bytes. One byte below the driver's
 * reported minimum must fail; restoring a zero-padded allocation must draw the right pixel.
 * On float f64, changing the real guard texture to zero must change the actual readback. */
function blockProbe(
  gl: WebGL2RenderingContext,
  run: BareUniformRun,
  spec: UniformSpec,
): BlockProbe {
  const base = { name: run.name, flavor: run.flavor };
  const vertex = run.manifest.gl?.vertices?.vs;
  const fragment = run.manifest.gl?.draws?.fs;
  const name = spec.name + 'Value';
  const binding = run.manifest.bindings.find((b) => b.name === name);
  if (!vertex || 'none' in vertex || !fragment || 'none' in fragment || !binding?.layout)
    return { ...base, error: 'missing emitted stages or logical binding layout' };
  const shaders: WebGLShader[] = [];
  const program = gl.createProgram();
  const buffer = gl.createBuffer();
  const vao = gl.createVertexArray();
  let guard: WebGLTexture | undefined;
  try {
    if (!program || !buffer || !vao) throw new Error('no WebGL object');
    shaders.push(shader(gl, gl.VERTEX_SHADER, vertex.vertex));
    shaders.push(shader(gl, gl.FRAGMENT_SHADER, fragment.fragment));
    for (const compiled of shaders) gl.attachShader(program, compiled);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(program) ?? 'WebGL link failed');
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.viewport(0, 0, 1, 1);
    const tag = fragment.blocks[name];
    if (!tag) throw new Error('authored binding has no block mapping');
    const index = gl.getUniformBlockIndex(program, tag);
    const inactive = index === gl.INVALID_INDEX;
    if (inactive && !spec.dead) throw new Error('read uniform block is inactive');
    const size = inactive
      ? undefined
      : (gl.getActiveUniformBlockParameter(program, index, gl.UNIFORM_BLOCK_DATA_SIZE) as number);
    if (!inactive && (!Number.isInteger(size) || size! <= 0))
      throw new Error('uniform block has no positive size');
    const guarded = spec.kind === 'double' && run.flavor === 'float';
    const guardBinding = run.manifest.bindings.find((b) => b.injected && b.name === '_fp64');
    if (guarded !== (guardBinding !== undefined))
      throw new Error('manifest fp64 guard differs from flavor');
    if (guarded) {
      guard = gl.createTexture() ?? undefined;
      if (!guard) throw new Error('no guard texture');
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, guard);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, 1, 1, 0, gl.RED, gl.FLOAT, new Float32Array([1]));
      const location = gl.getUniformLocation(
        program,
        guardBinding!.emittedGlsl ?? guardBinding!.emitted,
      );
      if (location === null) throw new Error('float fp64 guard was not active');
      gl.uniform1i(location, 0);
    }
    let shortError: number | undefined;
    if (!inactive) {
      gl.bindBuffer(gl.UNIFORM_BUFFER, buffer);
      gl.uniformBlockBinding(program, index, 0);
      gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, buffer);
      gl.bufferData(gl.UNIFORM_BUFFER, new Uint8Array(size! - 1), gl.STREAM_DRAW);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      shortError = gl.getError();
      const layout = layoutFromPack(binding.layout);
      const value = valueOf(spec);
      const logicalBytes = byteSize(layout, value, name);
      const bytes = new ArrayBuffer(Math.max(size!, Math.ceil(logicalBytes / 16) * 16));
      pack(new DataView(bytes), 0, layout, value, name);
      gl.bufferData(gl.UNIFORM_BUFFER, bytes, gl.STREAM_DRAW);
    }
    const draw = (): number[] => {
      gl.clearColor(1, 0, 1, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const pixel = new Uint8Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      const error = gl.getError();
      if (error !== gl.NO_ERROR) throw new Error(`block draw WebGL error ${error}`);
      return [...pixel];
    };
    const pixels = draw();
    let zeroGuard: number[] | undefined;
    if (guarded) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1, 1, gl.RED, gl.FLOAT, new Float32Array([0]));
      zeroGuard = draw();
    }
    return { ...base, pixels, size, shortError, inactive, ...(zeroGuard ? { zeroGuard } : {}) };
  } catch (error) {
    return { ...base, error: message(error) };
  } finally {
    gl.deleteBuffer(buffer);
    gl.deleteVertexArray(vao);
    gl.deleteProgram(program);
    for (const compiled of shaders) gl.deleteShader(compiled);
    if (guard) gl.deleteTexture(guard);
  }
}

export async function runBareUniforms(runs: readonly BareUniformRun[]): Promise<BareUniformReport> {
  const gpu = await createRuntime({ prefer: ['webgpu'] });
  let gl: Runtime | undefined;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const native = canvas.getContext('webgl2', { antialias: false });
  const rows: Row[] = [];
  const blocks: BlockProbe[] = [];
  let observed: ReturnType<typeof observeDrawShaders> | undefined;
  let brokenShader = false;
  let flavorObserved = false;
  try {
    if (native === null) throw new Error('no WebGL2 block-probe context');
    try {
      const compiled = shader(native, native.FRAGMENT_SHADER, '#version 300 es\nTHIS IS NOT GLSL');
      native.deleteShader(compiled);
    } catch {
      brokenShader = true;
    }
    gl = await createRuntime({ prefer: ['webgl2'] });
    if (gpu.tier !== 'webgpu' || gl.tier !== 'webgl2')
      throw new Error('bare uniforms require both GPU tiers');
    for (const run of runs) {
      const spec = uniforms.find((s) => s.name === run.name);
      if (!spec) throw new Error(`unknown uniform fixture ${run.name}`);
      if (spec.kind === 'double') {
        observed ??= observeDrawShaders('fs');
        observed.select(run.flavor);
      }
      for (const path of paths(run)) {
        const canvas = path.startsWith('host ') ? document.createElement('canvas') : undefined;
        if (canvas) {
          canvas.width = canvas.height = 1;
          const tier = path === 'host cpu' ? 'cpu' : path === 'host webgl2' ? 'webgl2' : 'webgpu';
          configure({ prefer: [tier], fp64Flavor: run.flavor });
        }
        try {
          // The changed input reuses the same canvas/owner or runtime/pipeline. A cached
          // upload that keeps the first value must fail this second readback.
          for (const changed of [false, true]) {
            const pixels = canvas
              ? await hostDraw(run, spec, path, changed, canvas)
              : await manifestDraw(path === 'manifest webgpu' ? gpu : gl, run, spec, changed);
            rows.push({ name: run.name, flavor: run.flavor, path, changed, ...pixels });
          }
        } finally {
          if (path === 'host webgl2')
            canvas?.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
          if (canvas) configure({});
        }
      }
      blocks.push(blockProbe(native, run, spec));
    }
    observed?.verify();
    flavorObserved = observed !== undefined;
    return { rows, blocks, brokenShader, flavorObserved };
  } catch (error) {
    return { rows, blocks, brokenShader, flavorObserved, instrumentError: message(error) };
  } finally {
    observed?.close();
    native?.getExtension('WEBGL_lose_context')?.loseContext();
    gpu.destroy();
    gl?.destroy();
  }
}

/** A fixed inventory, changed host values, all native refusals and independent pixels.
 * A missing leg, duplicate row or a fallback can never produce a passing empty report. */
export function bareUniformFailures(report: BareUniformReport): string[] {
  const failures: string[] = [];
  if (
    uniforms.length !== 24 ||
    new Set(uniforms.filter((s) => !s.dead).map((s) => s.type)).size !== 22
  )
    failures.push('uniform corpus must cover 22 distinct types and both dead-binding controls');
  if (!report.brokenShader || !report.flavorObserved || report.instrumentError)
    failures.push(
      `uniform instruments: ${report.instrumentError ?? 'shader/flavor observation failed'}`,
    );
  let count = 0;
  let blockCount = 0;
  for (const spec of uniforms)
    for (const flavor of spec.kind === 'double'
      ? (['float', 'integer'] as const)
      : (['float'] as const)) {
      const run = { flavor };
      const label = `${spec.name} ${flavor}`;
      blockCount++;
      for (const path of paths(run)) {
        for (const changed of [false, true]) {
          count++;
          const rows = report.rows.filter(
            (r) =>
              r.name === spec.name &&
              r.flavor === flavor &&
              r.path === path &&
              r.changed === changed,
          );
          if (
            rows.length !== 1 ||
            rows[0]!.error ||
            !matches(rows[0]!.pixels, expected(spec, changed))
          )
            failures.push(`${label} ${path} changed=${changed}: ${JSON.stringify(rows)}`);
          if (changed && !spec.dead && matches(rows[0]?.pixels, expected(spec, false)))
            failures.push(`${label} ${path}: changed input was not observed`);
        }
      }
      const blocks = report.blocks.filter((b) => b.name === spec.name && b.flavor === flavor);
      const block = blocks[0];
      if (
        blocks.length !== 1 ||
        block?.error ||
        (block?.inactive ? !spec.dead : block?.shortError !== 1282) ||
        !matches(block?.pixels, expected(spec, false))
      )
        failures.push(`${label} block instrument: ${JSON.stringify(blocks)}`);
      if (
        spec.kind === 'double' &&
        flavor === 'float' &&
        (!block?.zeroGuard || matches(block.zeroGuard, expected(spec, false)))
      )
        failures.push(`${label}: zero fp64 guard did not change actual pixels`);
    }
  if (report.rows.length !== count || report.blocks.length !== blockCount)
    failures.push(
      `uniform inventory: ${report.rows.length}/${count} calls and ${report.blocks.length}/${blockCount} block probes`,
    );
  return failures;
}
