import { describe, expect, it } from 'vitest';
import { bothTake } from '../testing/both-halves.js';
import { emitModule } from '../backends/wgsl.js';
import type { ModuleDecl } from '../ir/nodes.js';
import { lowerKernel, type KernelPlan } from './kernel-lower.js';
import { proveKernels } from './parallel-loop.js';

function lower(body: string): KernelPlan {
  const module = bothTake(`"use typeshade";\n${body}\n`, { fileName: 'm.shade.ts' }).result.module;
  const proof = proveKernels(module).find((p) => p.fn === 'k')!;
  const plan = lowerKernel(
    module.funcs.find((f) => f.name === 'k')!,
    module,
    proof,
  );
  if ('noGpu' in plan) throw new Error(plan.noGpu);
  return plan;
}

function entry(module: ModuleDecl, name: string): string {
  const text = emitModule(module);
  const start = text.indexOf(`fn ${name}(`);
  if (start < 0) throw new Error(`no entry ${name}`);
  return text.slice(start, text.indexOf('\n}\n', start) + 2);
}

const count = (text: string, part: string): number => text.split(part).length - 1;

const REDUCE = (
  type: string,
  init: string,
  body: string,
): string => `export function k(xs: array<f32>): ${type} {
  let s: ${type} = ${init};
  for (let i: u32 = 0; i < xs.length; i++) { ${body} }
  return s;
}`;

const SUM = REDUCE('f32', '0.', 's += xs[i];');

describe('the tree of a loop that reduces (Rule 7.2)', () => {
  const plan = lower(SUM);
  const strides = [128, 64, 32, 16, 8, 4, 2, 1];

  it.each(['k_loop0', 'k_loop0_fold'])(
    'folds %s from stride 128 down to 1, slot t with slot t + s',
    (name) => {
      const text = entry(plan.module, name);
      const combines = [
        ...text.matchAll(
          /k_loop0_tree_s\[_lid\] = \(k_loop0_tree_s\[_lid\] \+ k_loop0_tree_s\[\(_lid \+ (\d+)u\)\]\);/g,
        ),
      ];
      expect(combines.map((m) => Number(m[1]))).toEqual(strides);
    },
  );

  it.each(['k_loop0', 'k_loop0_fold'])(
    'puts a barrier before each stride but not after the last one in %s',
    (name) => {
      const text = entry(plan.module, name);
      expect(count(text, 'workgroupBarrier();')).toBe(8);
      expect(text).toContain(
        'k_loop0_tree_s[(_lid + 1u)]);\n  }\n  if ((_lid == 0u)) {\n    k_loop0_s[',
      );
      for (const s of strides.slice(0, -1))
        expect(text).toContain(`(_lid + ${String(s)}u)]);\n  }\n  workgroupBarrier();`);
    },
  );

  it('combines min and max by the function, and the other operators by the operator', () => {
    const min = entry(lower(REDUCE('f32', '0.', 's = min(s, xs[i]);')).module, 'k_loop0');
    expect(min).toContain(
      'k_loop0_tree_s[_lid] = min(k_loop0_tree_s[_lid], k_loop0_tree_s[(_lid + 128u)]);',
    );
    const max = entry(lower(REDUCE('f32', '0.', 's = max(s, xs[i]);')).module, 'k_loop0');
    expect(max).toContain(
      'k_loop0_tree_s[_lid] = max(k_loop0_tree_s[_lid], k_loop0_tree_s[(_lid + 128u)]);',
    );
    const or = entry(lower(REDUCE('u32', '0', 's |= u32(xs[i]);')).module, 'k_loop0');
    expect(or).toContain(
      'k_loop0_tree_s[_lid] = (k_loop0_tree_s[_lid] | k_loop0_tree_s[(_lid + 128u)]);',
    );
  });
});

describe('the identity a loop that reduces starts from', () => {
  const identity = (type: string, init: string, body: string): string =>
    entry(lower(REDUCE(type, init, body)).module, 'k_loop0');

  it('is -0 for an f32 sum, through its bits', () => {
    expect(identity('f32', '0.', 's += xs[i];')).toContain(
      'var _sums: k_loop0_Sums = k_loop0_Sums(bitcast<f32>(2147483648u));',
    );
  });

  it('is the largest finite f32 for an f32 min, and its negative for a max, through their bits', () => {
    expect(identity('f32', '0.', 's = min(s, xs[i]);')).toContain('bitcast<f32>(2139095039u)');
    expect(identity('f32', '0.', 's = max(s, xs[i]);')).toContain('bitcast<f32>(4286578687u)');
  });

  it('is the largest finite f32 for an emulated double, never an infinity', () => {
    const min = identity('f64', '0.', 's = min(s, f64(xs[i]));');
    expect(min).toContain('k_loop0_Sums(vec2<f32>(3.4028234663852886e+38, 0.0))');
    const max = identity('f64', '0.', 's = max(s, f64(xs[i]));');
    expect(max).toContain('k_loop0_Sums(vec2<f32>(-3.4028234663852886e+38, 0.0))');
    expect(min + max).not.toMatch(/inf/i);
  });

  it('is the neutral element of the operator for an integer and a product', () => {
    expect(identity('u32', '0', 's += u32(xs[i]);')).toContain('k_loop0_Sums(0u)');
    expect(identity('f32', '1.', 's *= xs[i];')).toContain('k_loop0_Sums(1.0)');
  });
});

describe('a lane past the trip count (change 0096, Rule 8.22)', () => {
  const CLASS = `class Voice {
  phase: f32;
  freq: f32;
  tick(dt: f32): f32 {
    this.phase = this.phase + this.freq * dt;
    return this.phase;
  }
}`;
  const iteration = (body: string): string => {
    const plan = lower(body);
    const text = entry(plan.module, plan.loops[0]!.entry);
    return text.slice(text.indexOf('let i = '));
  };
  const skipping = (text: string): boolean => {
    const guard = text.indexOf('if (_live) {');
    const read = text.indexOf('let v');
    return guard >= 0 && read > guard;
  };

  it('runs iteration n - 1 beside the lane that runs it, with its writes masked', () => {
    const text = iteration(`export function k(xs: array<f32>, out: array<f32>) {
  for (let i: u32 = 0; i < xs.length; i++) { const v = xs[i] * 2.; out[i] = v; }
}`);
    expect(text).toMatch(/let i = [^\n]*u32\(_kc\)/);
    expect(skipping(text)).toBe(false);
    expect(text).toContain('if (_live) {\n    out[i] = v;');
  });

  it.each([
    [
      'the loop reads back an element of an array it writes',
      `export function k(xs: array<f32>, out: array<f32>) {
  for (let i: u32 = 0; i < xs.length; i++) { out[i] = xs[i]; const v = out[i] * 2.; out[i] = v; }
}`,
    ],
    [
      'the loop loads a texel of a texture it stores',
      `export function k(t: texture_storage_2d<"r32float", "read_write">, w: u32, h: u32) {
  for (let i: u32 = 0; i < w * h; i++) {
    const v = textureLoad(t, vec2u(i % w, i / w));
    textureStore(t, vec2u(i % w, i / w), v + vec4(1.));
  }
}`,
    ],
    [
      'the loop writes through an object argument of a call',
      `${CLASS}
export function k(vs: array<Voice>, ts: array<f32>) {
  for (let i: u32 = 0; i < vs.length; i++) { const v = vs[i].tick(0.1); ts[i] = v; }
}`,
    ],
    [
      'the loop passes an element to a function that writes through it',
      `${CLASS}
function fill(o: Voice, d: f32): void { o.phase = d; }
export function k(vs: array<Voice>, xs: array<f32>, ts: array<f32>) {
  for (let i: u32 = 0; i < vs.length; i++) { fill(vs[i], 1.); const v = xs[i] * 2.; ts[i] = v; }
}`,
    ],
  ])('skips the iteration under its flag when %s', (_label, body) => {
    expect(skipping(iteration(body))).toBe(true);
  });

  it('runs a workgroup wholly past the trip count as one, before anything else', () => {
    const plan = lower(`export function k(xs: array<f32>, out: array<f32>) {
  for (let i: u32 = 0; i < xs.length; i++) { out[i] = xs[i]; }
}`);
    const text = entry(plan.module, 'k_loop0');
    expect(text).toContain(
      'if ((((_wid.x + (_wid.y * _nwg.x)) * 64u) >= k_args._n)) {\n    return;\n  }\n  let _live = (_k < k_args._n);',
    );
  });

  it('gives the tree of a loop that reduces the identity from a lane past the trip count', () => {
    const text = entry(lower(SUM).module, 'k_loop0');
    expect(text).toContain('let _live = (_k < k_args._n);');
    expect(text).toContain(
      'if (_live) {\n    _sums = _i0ret;\n  }\n  k_loop0_tree_s[_lid] = _sums.s;',
    );
  });

  it('runs nothing in a lane that skips, and calls the helper only under its flag', () => {
    const plan = lower(`export function k(xs: array<f32>, out: array<f32>): f32 {
  let s: f32 = 0.;
  for (let i: u32 = 0; i < xs.length; i++) { out[i] = xs[i]; const v = out[i]; s += v; }
  return s;
}`);
    const text = entry(plan.module, 'k_loop0');
    expect(text).toContain('if (_live) {\n    k_loop0_iteration_into(&_sums, _k, _live);\n  }');
    expect(text).not.toContain('_kc');
  });
});

describe('the subgroup variant of a kernel function (change 0119)', () => {
  const folds = (plan: KernelPlan): boolean[] => plan.loops.map((l) => l.subgroupFold === true);

  it.each([
    ['an f32 min', REDUCE('f32', '0.', 's = min(s, xs[i]);'), true],
    ['an f32 max', REDUCE('f32', '0.', 's = max(s, xs[i]);'), true],
    ['a u32 sum', REDUCE('u32', '0', 's += u32(xs[i]);'), true],
    ['a u32 or', REDUCE('u32', '0', 's |= u32(xs[i]);'), true],
    ['an i32 vector sum', REDUCE('vec2i', 'vec2i(0, 0)', 's += vec2i(i32(xs[i]), 1);'), true],
    ['an f32 sum', SUM, false],
    ['an f32 product', REDUCE('f32', '1.', 's *= xs[i];'), false],
    ['an emulated double sum', REDUCE('f64', '0.', 's += f64(xs[i]);'), false],
  ])('folds %s inside a subgroup: %s', (_label, body, folded) => {
    const plan = lower(body);
    expect(folds(plan)).toEqual([folded]);
    expect(plan.subgroupModule !== undefined).toBe(folded);
  });

  it('folds a loop only when every variable it reduces gives one value in every order', () => {
    const both = (second: string): string => `export function k(xs: array<f32>): f32 {
  let s: f32 = 0.;
  let t: ${second === 'u32' ? 'u32' : 'f32'} = 0${second === 'u32' ? '' : '.'};
  for (let i: u32 = 0; i < xs.length; i++) { s = max(s, xs[i]); t += ${second === 'u32' ? '1' : 'xs[i]'}; }
  return s + f32(t);
}`;
    expect(folds(lower(both('u32')))).toEqual([true]);
    expect(folds(lower(both('f32')))).toEqual([false]);
  });

  const scatter = (body: string): KernelPlan =>
    lower(`export function k(keys: array<u32>, bins: array<u32>) {
  for (let i: u32 = 0; i < keys.length; i++) { ${body} }
}`);

  it.each([
    ['one add', 'bins[keys[i]] += 1;', true],
    ['two adds', 'bins[keys[i]] += 1; bins[0] += 2;', true],
    [
      'an add under an if and its else',
      'if (keys[i] > 3) { bins[keys[i]] += 1; } else { bins[0] += 1; }',
      true,
    ],
    [
      'an add in a switch',
      'switch (keys[i]) { case 1: { bins[1] += 1; break; } default: { bins[0] += 1; } }',
      true,
    ],
    [
      'an add that may repeat in an inner loop',
      'for (let q: u32 = 0; q < 2; q++) { bins[keys[i] + q] += 1; }',
      false,
    ],
    [
      'an add after a continue of the loop',
      'if (keys[i] > 3) { continue; } bins[keys[i]] += 1;',
      false,
    ],
  ])('folds a loop that scatters with %s: %s', (_label, body, folded) => {
    const plan = scatter(body);
    expect(folds(plan)).toEqual([folded]);
    expect(plan.subgroupModule !== undefined).toBe(folded);
  });

  it('has no subgroup module when no loop has a variant', () => {
    expect(lower(SUM).subgroupModule).toBeUndefined();
    expect(
      lower(`export function k(xs: array<f32>, out: array<f32>) {
  for (let i: u32 = 0; i < xs.length; i++) { out[i] = xs[i]; }
}`).subgroupModule,
    ).toBeUndefined();
  });

  it('replaces each entry that has a variant and keeps every other function and binding', () => {
    const plan = lower(`export function k(xs: array<f32>, out: array<f32>): f32 {
  let s: f32 = 0.;
  for (let i: u32 = 0; i < xs.length; i++) { s = min(s, xs[i]); }
  for (let j: u32 = 0; j < xs.length; j++) { out[j] = xs[j]; }
  return s;
}`);
    const variant = plan.subgroupModule!;
    expect(variant.funcs.map((f) => f.name)).toEqual(plan.module.funcs.map((f) => f.name));
    expect(variant.bindings).toEqual(plan.module.bindings);
    const changed = plan.module.funcs.filter((f, i) => variant.funcs[i] !== f).map((f) => f.name);
    expect(changed).toEqual(['k_loop0_iteration', 'k_loop0', 'k_loop0_fold']);
    expect(emitModule(variant)).toContain('enable subgroups;');
    expect(emitModule(plan.module)).not.toContain('subgroup');
  });

  it('folds each subgroup, waits once, and folds the subgroups in lane 0', () => {
    const plan = lower(REDUCE('f32', '0.', 's = min(s, xs[i]);'));
    for (const name of ['k_loop0', 'k_loop0_fold']) {
      const text = entry(plan.subgroupModule!, name);
      expect(count(text, 'workgroupBarrier();')).toBe(1);
      expect(count(text, 'subgroupMin(')).toBe(1);
      expect(text).toContain(
        'if ((_sgi == 0u)) {\n    k_loop0_tree_s[_sgid] = _sg_s;\n  }\n  workgroupBarrier();',
      );
      expect(text).toContain('for (var _sgj: u32 = 0u; (_sgj < _nsg); _sgj = (_sgj + 1u)) {');
    }
  });
});
