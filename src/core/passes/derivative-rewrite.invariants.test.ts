import { describe, expect, it } from 'vitest';
import { compile } from '../../compiler/ts/compile.js';
import { TS_CODES } from '../../compiler/ts/codes.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';
import { keepHelpers } from '../testing/keep-helpers.js';

const HEAD = `declare const t: texture_2d<f32>;
declare const s: sampler;
declare const k: uniform<f32>;
interface VsOut {
  pos: builtin<"position">;
  uv: location<0, vec2>;
}
@vertex export function vs(): VsOut {
  return { pos: vec4(0., 0., 0., 1.), uv: vec2(0., 0.) };
}
`;

const frag = (body: string, before = ''): string =>
  `${HEAD}${before}@fragment export function fs(v: VsOut): vec4 {
${body}
}`;

function outcome(source: string) {
  const full = `"use typeshade";\n${source}`;
  const c = compile(full);
  const service = createTypeshadeLanguageService();
  service.openDocument('a.shade.ts', full);
  const editor = service
    .getDiagnostics('a.shade.ts')
    .filter((d) => String(d.code) === TS_CODES.UNIFORMITY)
    .map((d) => d.message);
  const compiler = c.diagnostics
    .filter((d) => d.code === TS_CODES.UNIFORMITY)
    .map((d) => d.message);
  expect(editor).toEqual(compiler);
  return { c, said: compiler };
}

function reached(source: string) {
  const { c, said } = outcome(source);
  expect(said).toEqual([]);
  expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return { wgsl: c.wgsl!, glsl: c.glsl?.fragment };
}

const branch = (
  coord: string,
): string => `  if (v.uv.x > 0.5) { return textureSample(t, s, ${coord}); }
  return vec4(0.);`;

describe('the bias of textureSampleBias is clamped to the range WGSL clamps it to', () => {
  const bias = (value: string) =>
    reached(
      frag(`  if (v.uv.x > 0.5) { return textureSampleBias(t, s, v.uv, ${value}); }
  return vec4(0.);`),
    );

  it('an upper bias scales by exp2(15.99)', () => {
    expect(bias('100.').wgsl).toMatch(/= exp2\(15\.99\);/);
  });

  it('a lower bias scales by exp2(-16)', () => {
    expect(bias('-100.').wgsl).toMatch(/= exp2\(-16\.0\);/);
  });
});

describe('a call with no gradient form is recomputed whole', () => {
  it('a sample of a texture_1d: its value before the branch', () => {
    const { wgsl } = reached(`declare const t1: texture_1d<f32>;
declare const s1: sampler;
@fragment export function fs(p: builtin<"position">): vec4 {
  if (p.x > 0.5) { return textureSample(t1, s1, p.x * 0.01); }
  return vec4(0.);
}`);
    expect(wgsl).toMatch(/let hoist_r_h\d+ = textureSample\(t1, s1, /);
    expect(wgsl).not.toContain('textureSampleGrad');
    expect(wgsl.indexOf('textureSample(')).toBeLessThan(wgsl.indexOf('if ('));
  });

  it('a depth sample in a loop some invocations leave: the reason names the loop, not the texture', () => {
    const { said } = outcome(`declare const shadowMap: texture_depth_2d;
declare const shadowSmp: sampler_comparison;
@fragment export function fs(p: builtin<"position">): vec4 {
  let acc: f32 = 0.;
  for (let i: i32 = 0; i < 4; i++) {
    if (p.x > 0.5) { break; }
    acc = acc + textureSampleCompare(shadowMap, shadowSmp, p.xy * f32(i), 0.5);
  }
  return vec4(acc);
}`);
    expect(said).toHaveLength(1);
    expect(said[0]).toContain('changes on each iteration of a loop that not every invocation runs');
    expect(said[0]).not.toContain('depth texture');
  });
});

describe('a helper the slice calls must run again at the hoist point', () => {
  it('a pure helper: recomputed', () => {
    reached(frag(branch('twice(v.uv)'), 'function twice(uv: vec2): vec2 { return uv * 2.; }\n'));
  });

  it('a helper that changes its object through a method: refused', () => {
    const { said } = outcome(
      frag(
        `  const o = new C(v.uv.x);
  if (v.uv.x > 0.5) { return textureSample(t, s, vec2(g(o), 0.)); }
  return vec4(0.);`,
        `class C { x: f32; constructor(x: f32) { this.x = x; } bump(): void { this.x = this.x * 2.; } }
function g(o: C): f32 { o.bump(); return o.x; }
`,
      ),
    );
    expect(said).toHaveLength(1);
    expect(said[0]).toContain('a value the compiler cannot recompute there');
  });

  it('a helper with a loop of no constant trip count: refused', () => {
    const { said } = outcome(
      frag(
        branch('spin(v.uv)'),
        `function spin(uv: vec2): vec2 {
  let c: vec2 = uv;
  for (let i = 0; i < i32(k); i++) { c = c * 1.5; }
  return c;
}
`,
      ),
    );
    expect(said).toHaveLength(1);
    expect(said[0]).toContain('trip count is not a constant');
  });

  it('a helper that reads memory the module writes: refused', () => {
    const { said } = outcome(
      frag(
        branch('peek(v.uv)'),
        `let held: vec2 = vec2(0., 0.);
export function hold(uv: vec2): void { held = uv; }
function peek(uv: vec2): vec2 { return uv + held; }
`,
      ),
    );
    expect(said).toHaveLength(1);
    expect(said[0]).toContain('"held"');
  });
});

describe('the slice reads the length of a runtime-sized array as the size the host bound', () => {
  it('arrayLength of a storage array the module writes: recomputed', () => {
    reached(
      frag(
        branch('vec2(f32(xs.length) * 0.01, v.uv.y)'),
        `declare const xs: storage<f32[], "read_write">;
export function fill(i: u32): void { xs[i] = 1.; }
`,
      ),
    );
  });

  it('an element of that array: refused', () => {
    const { said } = outcome(
      frag(
        branch('vec2(xs[0], v.uv.y)'),
        `declare const xs: storage<f32[], "read_write">;
export function fill(i: u32): void { xs[i] = 1.; }
`,
      ),
    );
    expect(said).toHaveLength(1);
  });
});

describe('a loop the slice runs again must end where it ended before', () => {
  const jump = (statement: string) =>
    outcome(
      frag(`  if (v.uv.x > 0.5) {
    let c: vec2 = v.uv;
    for (let i = 0; i < 3; i++) {
      if (c.x > 4.) { ${statement} }
      c = c * 1.5;
    }
    return textureSample(t, s, c);
  }
  return vec4(0.);`),
    ).said;

  it('a constant trip count with a break: refused', () => {
    const said = jump('break;');
    expect(said).toHaveLength(1);
    expect(said[0]).toContain('trip count is not a constant');
  });

  it('a constant trip count with a continue: refused', () => {
    const said = jump('continue;');
    expect(said).toHaveLength(1);
    expect(said[0]).toContain('trip count is not a constant');
  });
});

describe('the copies of a helper', () => {
  it('stand in the module right after the helper they copy', () => {
    const c = keepHelpers(() =>
      compile(
        `"use typeshade";\n${frag(
          `  let base: vec4 = vec4(0.);
  if (v.uv.x > 0.5) { base = wide(v.uv); }
  return base;`,
          'function wide(uv: vec2): vec4 { return textureSample(t, s, uv * 0.5); }\n',
        )}`,
      ),
    )();
    const names = c.module.funcs.map((f) => f.name);
    expect(names.indexOf('wide_grad')).toBe(names.indexOf('wide') + 1);
    expect(names.indexOf('wide_grad')).toBeLessThan(names.indexOf('fs'));
  });

  it('a copy that a later copy replaces leaves the module', () => {
    const { wgsl } = keepHelpers(reached)(
      frag(
        `  if (v.uv.x > 0.5) { return outer(v.uv); }
  return vec4(0.);`,
        `function inner(uv: vec2): vec4 { return textureSample(t, s, uv); }
function outer(uv: vec2): vec4 { return inner(uv) + inner(uv * 2.); }
`,
      ),
    );
    expect(wgsl).toMatch(/fn outer_grad_grad\(/);
    expect(wgsl).not.toMatch(/fn outer_grad\(/);
    for (const [, name] of wgsl.matchAll(/fn (\w+_grad\w*)\(/g)) {
      expect(wgsl.split(`${name}(`).length - 1, name).toBeGreaterThan(1);
    }
  });
});

describe('a barrier and a subgroup call are never rewritten', () => {
  it('workgroupBarrier under a non-uniform condition: reported as written', () => {
    const { said, c } = outcome(`declare const out: storage<f32[], "read_write">;
let tile: workgroup<f32[64]>;
@compute([64, 1, 1]) export function cs(@builtin("local_invocation_id") lid: vec3u): void {
  tile[lid.x] = 1.;
  if (lid.x < u32(4)) { workgroupBarrier(); }
  out[lid.x] = tile[lid.x];
}`);
    expect(said).toHaveLength(1);
    expect(said[0]).toContain('workgroupBarrier() is reached under');
    expect(c.wgsl).toBeUndefined();
  });

  it('subgroupAdd under a non-uniform condition: reported as written', () => {
    const { said, c } =
      outcome(`@compute([64]) export function cs(gid: builtin<"global_invocation_id">): void {
  if (gid.x > 4) {
    const total = subgroupAdd(f32(gid.x));
  }
}`);
    expect(said).toHaveLength(1);
    expect(said[0]).toContain('subgroupAdd() is reached under');
    expect(c.wgsl).toBeUndefined();
  });
});
