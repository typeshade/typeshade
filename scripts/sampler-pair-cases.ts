// The finite render cases for #448. A black/white two-texel texture at u=3/8 gives
// nearest=0 and linear=1/4, so collapsing two sampler bindings changes a channel.
// Verifies: Rule 11.10, Rule 11.11, Rule 13.3.
import { createRuntime, type Pack, type Runtime } from '../src/runtime.js';

const PRE = `"use typeshade";
declare const tex: texture_2d<f32>;
declare const tex2: texture_2d<f32>;
declare const nearest: sampler;
declare const linear: sampler;`;
const VERTEX = `export const vs = vertex(function vs(i: builtin<"vertex_index", u32>): vec4 {
  const xs: array<f32, 3> = [-1., 3., -1.];
  const ys: array<f32, 3> = [-1., -1., 3.];
  return vec4(xs[i], ys[i], 0., 1.);
});`;
const read = (texture: string, sampler: string): string =>
  `textureSample(${texture}, ${sampler}, vec2(0.375, 0.5))`;
const load = 'textureLoad(tex, vec2i(0, 0), 0)';
const level = (sampler: string): string =>
  `textureSampleLevel(tex, ${sampler}, vec2(0.375, 0.5), 0.)`;
const fragment = (a: string, b: string): string => `${PRE}\n${VERTEX}
export const fs = fragment(function fs(): vec4 {
  return vec4(${a}.x, ${b}.x, 0., 1.);
});`;
const stages = (vertexRead: string, fragmentRead: string): string => `${PRE}
interface Out { p: builtin<"position", vec4>; r: location<0, f32>; }
export const vs = vertex(function vs(i: builtin<"vertex_index", u32>): Out {
  const xs: array<f32, 3> = [-1., 3., -1.];
  const ys: array<f32, 3> = [-1., -1., 3.];
  return { p: vec4(xs[i], ys[i], 0., 1.), r: ${vertexRead}.x };
});
export const fs = fragment(function fs(o: Out): vec4 {
  return vec4(o.r, ${fragmentRead}.x, 0., 1.);
});`;
const DEPTH_PRE = `"use typeshade";
declare const shadow: texture_depth_2d;
declare const cmpA: sampler_comparison;
declare const cmpB: sampler_comparison;`;

interface SamplerCase {
  readonly source: string;
  readonly expected: readonly number[];
  readonly vertex: Readonly<Record<string, string | null>>;
  readonly fragment: Readonly<Record<string, string | null>>;
  readonly refusal?: 'stage' | 'pipeline';
  readonly depth?: true;
}

/** Independent pixel expectations: nearest picks black; linear mixes 1/4 white.
 *  A depth cleared to 1/2 passes reference 1/4 under less, and fails under greater. */
export const SAMPLER_CASES: Readonly<Record<string, SamplerCase>> = {
  direct: {
    source: fragment(read('tex', 'nearest'), read('tex', 'linear')),
    expected: [0, 64, 0, 255],
    vertex: {},
    fragment: {},
    refusal: 'stage',
  },
  same: {
    source: fragment(read('tex', 'nearest'), read('tex', 'nearest')),
    expected: [0, 0, 0, 255],
    vertex: {},
    fragment: { tex: 'nearest' },
  },
  separate: {
    source: fragment(read('tex', 'nearest'), read('tex2', 'linear')),
    expected: [0, 64, 0, 255],
    vertex: {},
    fragment: { tex: 'nearest', tex2: 'linear' },
  },
  cross: {
    source: stages(level('nearest'), read('tex', 'linear')),
    expected: [0, 64, 0, 255],
    vertex: { tex: 'nearest' },
    fragment: { tex: 'linear' },
    refusal: 'pipeline',
  },
  crossReverse: {
    source: stages(level('linear'), read('tex', 'nearest')),
    expected: [64, 0, 0, 255],
    vertex: { tex: 'linear' },
    fragment: { tex: 'nearest' },
    refusal: 'pipeline',
  },
  crossSame: {
    source: stages(level('nearest'), read('tex', 'nearest')),
    expected: [0, 0, 0, 255],
    vertex: { tex: 'nearest' },
    fragment: { tex: 'nearest' },
  },
  crossSeparate: {
    source: stages(level('nearest'), read('tex2', 'linear')),
    expected: [0, 64, 0, 255],
    vertex: { tex: 'nearest' },
    fragment: { tex2: 'linear' },
  },
  vertexLinearFragmentLoad: {
    source: stages(level('linear'), load),
    expected: [64, 0, 0, 255],
    vertex: { tex: 'linear' },
    fragment: { tex: null },
  },
  vertexLoadFragmentLinear: {
    source: stages(load, read('tex', 'linear')),
    expected: [0, 64, 0, 255],
    vertex: { tex: null },
    fragment: { tex: 'linear' },
  },
  depthSingle: {
    source: `${DEPTH_PRE}\n${VERTEX}
export const fs = fragment(function fs(): vec4 {
  return vec4(textureSampleCompare(shadow, cmpA, vec2(0.5), 0.25), 0., 0., 1.);
});`,
    expected: [255, 0, 0, 255],
    vertex: {},
    fragment: { shadow: 'cmpA' },
    depth: true,
  },
  depthCross: {
    source: `${DEPTH_PRE}
interface Out { p: builtin<"position", vec4>; r: location<0, f32>; }
export const vs = vertex(function vs(i: builtin<"vertex_index", u32>): Out {
  const xs: array<f32, 3> = [-1., 3., -1.];
  const ys: array<f32, 3> = [-1., -1., 3.];
  return { p: vec4(xs[i], ys[i], 0., 1.),
    r: textureSampleCompareLevel(shadow, cmpA, vec2(0.5), 0.25) };
});
export const fs = fragment(function fs(o: Out): vec4 {
  return vec4(o.r, textureSampleCompare(shadow, cmpB, vec2(0.5), 0.25), 0., 1.);
});`,
    expected: [255, 0, 0, 255],
    vertex: { shadow: 'cmpA' },
    fragment: { shadow: 'cmpB' },
    refusal: 'pipeline',
    depth: true,
  },
};

const conflict = (texture: string, first: string, second: string): string =>
  `it samples "${texture}" with "${first}" and "${second}", and GLSL ES 3.00 fuses a texture with one sampler. Declare the texture twice, one binding per sampler.`;
export const SAMPLER_REFUSALS: Readonly<Record<string, string>> = {
  direct: conflict('tex', 'nearest', 'linear'),
  cross: conflict('tex', 'nearest', 'linear'),
  crossReverse: conflict('tex', 'linear', 'nearest'),
  depthCross: conflict('shadow', 'cmpA', 'cmpB'),
};

export interface SamplerPairRun {
  readonly name: string;
  readonly manifest: Pack;
}
interface SamplerPixels {
  readonly pixels?: readonly number[];
  readonly error?: string;
}
export interface SamplerPairReport {
  readonly rows: readonly {
    readonly name: string;
    readonly gpu: SamplerPixels;
    readonly gl: SamplerPixels;
  }[];
  readonly swapped: Readonly<Record<'webgpu' | 'webgl2', SamplerPixels>>;
}

/** The same upload and actual render path is used for each tier, with no fallback. */
async function drawSamplerCase(
  rt: Runtime,
  run: SamplerPairRun,
  swap = false,
): Promise<SamplerPixels> {
  const spec = SAMPLER_CASES[run.name]!;
  const tex = rt.texture({ size: [2, 1], format: 'rgba8unorm' });
  const tex2 = rt.texture({ size: [2, 1], format: 'rgba8unorm' });
  const out = rt.texture({ size: [1, 1], format: 'rgba8unorm' });
  const shadow = spec.depth ? rt.texture({ size: [1, 1], format: 'depth24plus' }) : undefined;
  try {
    const bytes = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]);
    for (const t of [tex, tex2]) {
      if (rt.tier === 'webgpu')
        (rt.device as GPUDevice).queue.writeTexture(
          { texture: t.texture as GPUTexture },
          bytes,
          { bytesPerRow: 8 },
          [2, 1],
        );
      else {
        const gl = rt.device as WebGL2RenderingContext;
        gl.bindTexture(gl.TEXTURE_2D, t.texture as WebGLTexture);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 2, 1, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
        gl.bindTexture(gl.TEXTURE_2D, null);
      }
    }
    if (shadow) {
      const init = rt.frame();
      init.pass({ depth: { target: shadow, clear: 0.5 } }, () => {});
      await init.submit();
    }
    const reached = new Set(
      run.manifest.entries.flatMap((entry) => {
        if (entry.bindings === undefined)
          throw new Error(`${run.name}: entry "${entry.name}" has no binding metadata`);
        return entry.bindings.map((binding) => binding.name);
      }),
    );
    const pipeline = await rt
      .load(run.manifest)
      .render({ vertex: 'vs', fragment: 'fs', targets: ['rgba8unorm'] });
    const available = {
      tex,
      tex2,
      shadow,
      nearest: rt.sampler({ filter: swap ? 'linear' : 'nearest' }),
      linear: rt.sampler({ filter: swap ? 'nearest' : 'linear' }),
      cmpA: rt.sampler({ filter: 'nearest', compare: 'less' }),
      cmpB: rt.sampler({ filter: 'nearest', compare: 'greater' }),
    };
    const given = Object.fromEntries(
      Object.entries(available).filter(([name]) => reached.has(name)),
    );
    const frame = rt.frame();
    frame.pass({ color: [{ target: out, clear: [1, 0, 1, 1] }] }, (pass) =>
      pass.draw(pipeline, given, { count: 3 }),
    );
    await frame.submit();
    const pixels = [...(await out.read())];
    if (rt.tier === 'webgl2') {
      const gl = rt.device as WebGL2RenderingContext;
      const error = gl.getError();
      if (error !== gl.NO_ERROR) throw new Error(`WebGL error ${String(error)}`);
    }
    return { pixels };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  } finally {
    tex.destroy();
    tex2.destroy();
    out.destroy();
    shadow?.destroy();
  }
}

export async function runSamplerPairs(runs: readonly SamplerPairRun[]): Promise<SamplerPairReport> {
  const gpu = await createRuntime({ prefer: ['webgpu'] });
  let gl: Runtime | undefined;
  try {
    gl = await createRuntime({ prefer: ['webgl2'] });
    if (gpu.tier !== 'webgpu' || gl.tier !== 'webgl2')
      throw new Error('sampler cases require both GPU tiers');
    const rows = [];
    for (const run of runs)
      rows.push({
        name: run.name,
        gpu: await drawSamplerCase(gpu, run),
        gl: await drawSamplerCase(gl, run),
      });
    const separate = runs.find((run) => run.name === 'separate');
    if (separate === undefined) throw new Error('missing sampler comparison instrument');
    const swapped = {
      webgpu: await drawSamplerCase(gpu, separate, true),
      webgl2: await drawSamplerCase(gl, separate, true),
    };
    return { rows, swapped };
  } finally {
    gpu.destroy();
    gl?.destroy();
  }
}

const matches = (got: readonly number[] | undefined, expected: readonly number[]): boolean =>
  got?.length === expected.length && got.every((value, i) => Math.abs(value - expected[i]!) <= 1);

/** Exact inventory, useful refusals, independent pictures and an actual wrong-sampler draw. */
export function samplerPairFailures(report: SamplerPairReport): string[] {
  const failures: string[] = [];
  const names = Object.keys(SAMPLER_CASES);
  if (
    report.rows.length !== names.length ||
    new Set(report.rows.map((row) => row.name)).size !== names.length
  )
    failures.push('sampler fixture inventory differs');
  for (const name of names) {
    const spec = SAMPLER_CASES[name]!;
    const row = report.rows.find((item) => item.name === name);
    if (row === undefined) {
      failures.push(`${name}: missing result`);
      continue;
    }
    if (row.gpu.error !== undefined || !matches(row.gpu.pixels, spec.expected))
      failures.push(`${name}: WebGPU ${JSON.stringify(row.gpu)}`);
    if (spec.refusal) {
      if (
        row.gl.pixels !== undefined ||
        row.gl.error === undefined ||
        !row.gl.error.endsWith(SAMPLER_REFUSALS[name]!)
      )
        failures.push(
          `${name}: WebGL2 did not refuse its conflicting samplers: ${JSON.stringify(row.gl)}`,
        );
    } else if (row.gl.error !== undefined || !matches(row.gl.pixels, spec.expected))
      failures.push(`${name}: WebGL2 ${JSON.stringify(row.gl)}`);
  }
  for (const tier of ['webgpu', 'webgl2'] as const) {
    const swapped = report.swapped[tier];
    if (
      swapped.error !== undefined ||
      !matches(swapped.pixels, [64, 0, 0, 255]) ||
      matches(swapped.pixels, SAMPLER_CASES.separate!.expected)
    )
      failures.push(`${tier}: wrong-sampler instrument was not observed`);
  }
  return failures;
}
