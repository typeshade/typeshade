// The derivative rewrite (change 0132, step 1): an implicit-LOD sample or a derivative that the
// uniformity walk finds in non-uniform control flow is recomputed before the statement that
// made the flow non-uniform, and sampled with its gradients inside. Every case reads both halves
// on the same source (Rule 12.7): `compile()`'s TS8052 and the language service's, and, where
// the rewrite reaches the call, the WGSL and the GLSL ES 3.00 it emits.
//
// Verifies: Rule 8.5 (docs/language-design.md; traced in reqs/).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compile } from '../../compiler/ts/compile.js';
import { DIAGNOSTIC_OPTION_REFUSAL } from '../../compiler/ts/stage-call.js';
import { TS_CODES } from '../../compiler/ts/codes.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';
import { compileModule } from '../oracle.js';

const HEAD = `declare const t: texture_2d<f32>;
declare const s: sampler;
declare const k: uniform<f32>;
interface VsOut {
  pos: builtin<"position", vec4>;
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

/** The TS8052 sentences of each half, which must agree (Rule 12.7). */
function uniformity(source: string) {
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

/** The rewrite reached every call: no TS8052 in either half, no error, and the emitted text. */
function reached(source: string) {
  const { c, said } = uniformity(source);
  expect(said).toEqual([]);
  expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return { wgsl: c.wgsl!, glsl: c.glsl?.fragment, c };
}

const UV = '"VsOut.uv" (a fragment input at @location(0))';

describe('the shapes the rewrite reaches', () => {
  it('an if: the gradients before the branch, textureSampleGrad and textureGrad inside', () => {
    const { wgsl, glsl } = reached(
      frag(`  if (v.uv.x > 0.5) { return textureSample(t, s, v.uv * 2.); }
  return vec4(0., 0., 0., 1.);`),
    );
    const hoisted = wgsl.indexOf('dpdx(');
    expect(hoisted).toBeGreaterThan(0);
    expect(hoisted).toBeLessThan(wgsl.indexOf('if ('));
    expect(wgsl).toMatch(/let hoist_gy_h\d+ = dpdy\(/);
    // The coordinate the branch computes (the optimizer may share it with the recompute), with
    // the hoisted gradients.
    expect(wgsl).toMatch(/return textureSampleGrad\(t, s, \w+, hoist_gx_h\d+, hoist_gy_h\d+\);/);
    expect(wgsl).not.toContain('textureSample(');
    expect(wgsl).not.toContain('diagnostic(');
    expect(glsl).toMatch(/textureGrad\(t, /);
    expect(glsl).toMatch(/= dFdx\(/);
    expect(glsl!.indexOf('dFdx(')).toBeLessThan(glsl!.indexOf('if ('));
  });

  it('a switch, a ?: picked by an if, and the right side of an &&', () => {
    reached(
      frag(`  switch (i32(v.uv.x)) {
    case 0: return textureSample(t, s, v.uv);
    default: return vec4(0., 0., 0., 1.);
  }`),
    );
    reached(
      frag(
        `  const z = new C2(vec4(0., 0., 0., 1.), 0.);
  const r = v.uv.x > 0.5 ? new C2(textureSample(t, s, v.uv), 1.) : z;
  return r.c;`,
        'class C2 { c: vec4; w: f32; constructor(c: vec4, w: f32) { this.c = c; this.w = w; } }\n',
      ),
    );
    const { wgsl } = reached(
      frag(`  if (v.uv.x > 0.5 && textureSample(t, s, v.uv).x > 0.5) { return vec4(1., 0., 0., 1.); }
  return vec4(0., 0., 0., 1.);`),
    );
    expect(wgsl).toContain('textureSampleGrad(');
  });

  it('an early return: before the statement that holds it', () => {
    const { wgsl } = reached(
      frag(`  if (v.uv.x > 1.) { return vec4(0., 0., 0., 1.); }
  return textureSample(t, s, v.uv);`),
    );
    expect(wgsl.indexOf('dpdx(')).toBeLessThan(wgsl.indexOf('if ('));
  });

  it('a loop, a break and a continue: before the loop, when the operand is loop-invariant', () => {
    for (const body of [
      `  let acc: vec4 = vec4(0.);
  for (let i: i32 = 0; i < i32(v.uv.x * 4.); i++) { acc = acc + textureSample(t, s, v.uv); }
  return acc;`,
      `  let acc: vec4 = vec4(0.);
  for (let i: i32 = 0; i < 4; i++) {
    if (v.uv.x > 0.5) { break; }
    const c: vec2 = v.uv * 0.5;
    acc = acc + textureSample(t, s, c);
  }
  return acc;`,
      `  let acc: vec4 = vec4(0.);
  for (let i: i32 = 0; i < 4; i++) {
    if (v.uv.x > 0.5) { continue; }
    acc = acc + vec4(dpdx(v.uv.y), 0., 0., 0.);
  }
  return acc;`,
    ]) {
      const { wgsl } = reached(frag(body));
      expect(wgsl.indexOf('dpdx('), body).toBeLessThan(wgsl.indexOf('for ('));
    }
  });

  it('a derivative: its value computed before the branch', () => {
    const { wgsl, glsl } = reached(
      frag(`  if (v.uv.x > 0.5) { return vec4(fwidth(v.uv.x * 8.), dpdy(v.uv.y), 0., 1.); }
  return vec4(0., 0., 0., 1.);`),
    );
    expect(wgsl).toMatch(/let hoist_d_h\d+ = fwidth\(\(v\.uv\.x \* 8\.0\)\);/);
    expect(wgsl).toMatch(/let hoist_d_h\d+ = dpdy\(v\.uv\.y\);/);
    expect(glsl).toMatch(/hoist_d_h\d+ = dFdy\(/);
  });

  it('a helper: specialized with the gradients as extra parameters, the original kept', () => {
    const { wgsl } = reached(
      frag(
        `  let base: vec4 = vec4(0.);
  if (v.uv.x > 0.5) { base = wide(v.uv); }
  return base + near(v.uv);`,
        `function wide(uv: vec2): vec4 {
  const inner: vec2 = uv * 0.5;
  return textureSample(t, s, inner);
}
function near(uv: vec2): vec4 { return textureSample(t, s, uv); }
`,
      ),
    );
    expect(wgsl).toMatch(
      /fn wide_grad\(uv: vec2<f32>, hoist_gx_h\d+: vec2<f32>, hoist_gy_h\d+: vec2<f32>\)/,
    );
    // The original stays, for host code that may call an exported one.
    expect(wgsl).toMatch(/fn wide\(uv: vec2<f32>\)/);
    // The slice is recomputed in the caller: the helper's own local, with a fresh name.
    expect(wgsl).toMatch(/let inner_h\d+ = \(uv_h\d+ \* 0\.5\);/);
    // A helper called under uniform control flow keeps its implicit-LOD sample.
    expect(wgsl).toContain(
      'fn near(uv: vec2<f32>) -> vec4<f32> {\n  return textureSample(t, s, uv);',
    );
  });

  it('a helper called under a uniform and a non-uniform call site: one copy, for the latter', () => {
    const { wgsl } = reached(
      frag(
        `  let base: vec4 = sharp(v.uv);
  if (v.uv.x > 0.5) { base = sharp(v.uv * 2.); }
  return base;`,
        'function sharp(uv: vec2): vec4 { return textureSample(t, s, uv); }\n',
      ),
    );
    expect(wgsl).toMatch(/fn sharp\(uv: vec2<f32>\)/);
    expect(wgsl).toMatch(/fn sharp_grad\(/);
  });

  it('textureSampleBias: the gradients scaled by 2^clamp(bias)', () => {
    const { wgsl, glsl } = reached(
      frag(`  if (v.uv.x > 0.5) { return textureSampleBias(t, s, v.uv, 1.5); }
  return vec4(0., 0., 0., 1.);`),
    );
    // The clamp of a constant bias folds, and the scale is shared; it multiplies both.
    expect(wgsl).toMatch(/= exp2\(1\.5\);/);
    expect(wgsl).toMatch(
      /textureSampleGrad\(t, s, v\.uv, \(hoist_gx_h\d+ \* \w+\), \(hoist_gy_h\d+ \* \w+\)\)/,
    );
    expect(glsl).toContain('textureGrad(');
  });

  it('textureSampleCompare: the whole call recomputed before the branch', () => {
    const { wgsl } = reached(`declare const shadowMap: texture_depth_2d;
declare const shadowSmp: sampler_comparison;
@fragment export function fs(p: builtin<"position", vec4>): vec4 {
  if (p.x > 0.5) { return vec4(textureSampleCompare(shadowMap, shadowSmp, p.xy * 0.01, 0.5)); }
  return vec4(0.);
}`);
    expect(wgsl).toMatch(
      /let hoist_r_h\d+ = textureSampleCompare\(shadowMap, shadowSmp, \(p\.xy \* 0\.01\), 0\.5\);/,
    );
    expect(wgsl.indexOf('textureSampleCompare(')).toBeLessThan(wgsl.indexOf('if ('));
  });

  it('a value written between the hoist point and the call: replayed on a copy', () => {
    const { wgsl } = reached(
      frag(`  let d: f32 = v.uv.x * 3.;
  d += v.uv.y;
  if (v.uv.x > 0.5) {
    d *= 2.;
    return vec4(dpdx(d), 0., 0., 1.);
  }
  return vec4(d, 0., 0., 1.);`),
    );
    // The original `d` keeps its value; the recompute writes a fresh copy.
    expect(wgsl).toMatch(
      /var d_h\d+: f32 = d;\n\s+d_h\d+ \*= 2\.0;\n\s+let hoist_d_h\d+ = dpdx\(d_h\d+\);/,
    );
  });

  it('a loop with a constant trip count on the slice: recomputed', () => {
    const { wgsl } = reached(
      frag(`  if (v.uv.x > 0.5) {
    let c: vec2 = v.uv;
    for (let i = 0; i < 3; i++) { c = c * 1.5; }
    return textureSample(t, s, c);
  }
  return vec4(0.);`),
    );
    // The optimizer may unroll it; either way the gradients come before the branch.
    expect(wgsl).toMatch(/let hoist_gx_h\d+ = dpdx\(/);
    expect(wgsl.indexOf('dpdx(')).toBeLessThan(wgsl.indexOf('if ('));
  });

  it('leaves a module with no non-uniform sample byte-identical', () => {
    const src = frag(`  if (k > 0.5) { return textureSample(t, s, v.uv); }
  return textureSample(t, s, v.uv * 2.);`);
    const { wgsl } = reached(src);
    expect(wgsl).not.toContain('hoist_');
    expect(wgsl).not.toContain('textureSampleGrad');
  });

  it('refuses a module that writes a derivative_uniformity filter, and rewrites it without one', () => {
    // Step 1 of change 0132 left such a module as it was written; the filter is now refused at
    // once (TS8028, in both halves), and the same source without it is rewritten.
    const src = frag(`  if (v.uv.x > 0.5) { return textureSample(t, s, v.uv); }
  return vec4(0.);`);
    // The filter was an option of the stage call of change 0111, which compiles until the
    // refusing pull request of change 0140, so the filtered module is written with that call.
    const called = src.replace(
      '@fragment export function fs(',
      'export const fs = fragment(function fs(',
    );
    expect(called).not.toBe(src);
    const filtered = called.replace(
      /\n\}$/,
      '\n}, { diagnostic: ["warning", "derivative_uniformity"] });',
    );
    expect(filtered).not.toBe(called);
    const { c, said } = uniformity(filtered);
    expect(said).toEqual([]);
    const service = createTypeshadeLanguageService();
    service.openDocument('a.shade.ts', `"use typeshade";\n${filtered}`);
    const refusal = [`TS8028 ${DIAGNOSTIC_OPTION_REFUSAL}`];
    expect(c.diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual(refusal);
    expect(
      service.getDiagnostics('a.shade.ts').map((d) => `${String(d.code)} ${d.message}`),
    ).toEqual(refusal);
    expect(c.wgsl).toBeUndefined();
    const without = uniformity(src);
    expect(without.said).toEqual([]);
    expect(without.c.wgsl).toContain('textureSampleGrad(t, s, v.uv,');
    expect(without.c.wgsl).not.toContain('diagnostic(');
  });
});

describe('the calls the rewrite cannot reach keep TS8052, with the reason', () => {
  const sample = (reached: string, past: string, reason: string): string =>
    `textureSample() is reached ${reached}, which WGSL's derivative_uniformity rule refuses: the implicit level of detail is a difference between neighbouring invocations, and one that did not run has no value to difference against. The compiler could not compute the gradients before ${past}: ${reason}. Move the call above ${past} and select from its result, or call textureSampleLevel or textureSampleGrad with the level or the gradients you want.`;

  it('reason 1: a read of memory the module writes', () => {
    const { said } = uniformity(
      frag(
        `  if (v.uv.x > 0.5) { return textureSample(t, s, held); }
  return vec4(0.);`,
        'let held: vec2 = vec2(0., 0.);\nexport function hold(uv: vec2): void { held = uv; }\n',
      ),
    );
    expect(said).toEqual([
      sample(`under ${UV}`, 'the branch', 'its operand reads "held", which the branch writes'),
    ]);
  });

  it('reason 1: a loop whose trip count is not a constant', () => {
    const { said } = uniformity(
      frag(`  if (v.uv.x > 0.5) {
    let c: vec2 = v.uv;
    for (let i = 0; i < i32(k); i++) { c = c * 1.5; }
    return textureSample(t, s, c);
  }
  return vec4(0.);`),
    );
    expect(said).toEqual([
      sample(
        `under ${UV}`,
        'the branch',
        'its operand is computed in a loop whose trip count is not a constant',
      ),
    ]);
  });

  it('reason 1: an atomic operation', () => {
    const { said } = uniformity(
      frag(
        `  if (v.uv.x > 0.5) {
    const n: f32 = f32(atomicLoad(counter));
    return textureSample(t, s, v.uv * n);
  }
  return vec4(0.);`,
        'declare const counter: storage<atomic<u32>, "read_write">;\n',
      ),
    );
    expect(said).toEqual([
      sample(`under ${UV}`, 'the branch', 'its operand depends on an atomic operation'),
    ]);
  });

  it('reason 2: a depth texture, whose arguments cannot be recomputed', () => {
    const { said } = uniformity(`let held: vec2 = vec2(0., 0.);
export function hold(uv: vec2): void { held = uv; }
declare const shadowMap: texture_depth_2d;
declare const shadowSmp: sampler_comparison;
@fragment export function fs(p: builtin<"position", vec4>): vec4 {
  if (p.x > 0.5) { return vec4(textureSampleCompare(shadowMap, shadowSmp, held, 0.5)); }
  return vec4(0.);
}`);
    expect(said).toHaveLength(1);
    expect(said[0]).toContain(
      'textureSampleCompare() is reached under "p" (@builtin(position)), which WGSL\'s derivative_uniformity rule refuses',
    );
    expect(said[0]).toContain(
      'The compiler could not compute the gradients before the branch: "shadowMap" is a depth texture, which has no gradient form, and its arguments are computed in the branch.',
    );
  });

  it('reason 3: an operand that changes on each iteration of a loop not every invocation runs', () => {
    const { said } = uniformity(
      frag(`  let acc: vec4 = vec4(0.);
  for (let i: i32 = 0; i < 4; i++) {
    if (v.uv.x > 0.5) { break; }
    acc = acc + textureSample(t, s, v.uv * f32(i));
  }
  return acc;`),
    );
    expect(said).toEqual([
      sample(
        `in a loop some invocations leave by a break taken under ${UV}`,
        'the loop',
        'its operand changes on each iteration of a loop that not every invocation runs',
      ),
    ]);
  });
});

describe('the CPU oracle reads the rewritten IR (change 0132, decision 2)', () => {
  const src = `"use typeshade";
declare const t: texture_2d<f32>;
declare const s: sampler;
@fragment export function fs(p: builtin<"position", vec4>): vec4 {
  if (p.x > 0.5) { return textureSample(t, s, p.xy); }
  return vec4(0., 0., 1., 1.);
}`;

  it('gives the same placeholder with gpuStubs on both sides of the branch', () => {
    const r = compile(src);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const cm = compileModule(r.module, { gpuStubs: true });
    cm.setBinding('t', 0);
    cm.setBinding('s', 0);
    expect(cm.fns['fs']!([1, 0, 0, 1])).toEqual([0, 0, 0, 1]);
    expect(cm.fns['fs']!([0, 0, 0, 1])).toEqual([0, 0, 1, 1]);
  });

  it('throws without gpuStubs on an invocation that skips the branch, at the moved derivative', () => {
    const r = compile(src);
    const cm = compileModule(r.module);
    cm.setBinding('t', 0);
    cm.setBinding('s', 0);
    expect(() => cm.fns['fs']!([0, 0, 0, 1])).toThrow(/dpdx.*GPU-only/);
  });
});

describe("the two examples that wrote the filter (change 0132's evidence)", () => {
  // Change 0132 deleted the option from both sources. Read as written, both compile with every
  // call reached.
  const without = (id: string): string => {
    const text = readFileSync(new URL(`../../../examples/${id}.shade.ts`, import.meta.url), 'utf8');
    expect(text).not.toContain('diagnostic: [');
    return text.replace(/^"use typeshade";\n/, '');
  };

  it('sample-branch: both samples of the branch reached, the uniform one left', () => {
    const { wgsl, glsl } = reached(without('sample-branch'));
    expect(wgsl).not.toContain('diagnostic(');
    expect(wgsl).toMatch(/fn sharp_grad\(/);
    expect(wgsl).toMatch(/fn wide_grad\(/);
    expect(wgsl).toContain('textureSample(albedo, smp, near)');
    expect(glsl!.match(/textureGrad\(/g)).toHaveLength(2);
  });

  it('capsule-corp-namek-class: the six derivatives of Terrain.shade reached', () => {
    const { wgsl } = reached(without('capsule-corp-namek-class'));
    expect(wgsl).not.toContain('diagnostic(');
    expect(wgsl.match(/let hoist_d_h\d+ = dpdx\(/g)).toHaveLength(3);
    expect(wgsl.match(/let hoist_d_h\d+ = dpdy\(/g)).toHaveLength(3);
  });
});
