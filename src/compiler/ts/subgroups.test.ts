// Verifies: Rule 11.21 (docs/language-design.md; traced in reqs/).
//
// ═══ The subgroup built-in functions and values (change 0117, surface §77) ═══
//
// Both halves on one source (Rule 12.7): `compile()` and the language service read the same
// program, and the program must draw no error from either. Then each tier's meaning: WGSL's
// own calls behind `enable subgroups;`, the one-lane values of GLSL ES 3.00 and of the CPU
// oracle (Rule 11.21), the determinism rows for what the one-lane meaning cannot keep, and the
// refusals the front end states before Tint would (Rule 12.6).
//
// MEASURED ON TINT (Chrome for Testing 153.0.8010.12, SwiftShader, 2026-11-02), with a broken
// shader fed to the same instrument first:
//   - the 21 functions, `subgroup_id` and `num_subgroups` compile behind `enable subgroups;`;
//   - `subgroupBroadcast(x, gid.x % 4u)`: "the 'sourceLaneIndex' argument of
//     'subgroupBroadcast' must be a const-expression"; `subgroupBroadcast(x, 2)` compiles;
//   - `subgroupAdd` under `if (gid.x > 4u)`: "'subgroupAdd' must only be called from subgroup
//     uniform control flow"; under `if (u.k > 0.5)` on a uniform it compiles; the right side
//     of `subgroupElect() && subgroupAny(...)` is refused the same way;
//   - `@builtin(subgroup_id)` on a fragment entry: "is only valid as a compute shader input",
//     and `num_subgroups` likewise;
//   - a call with no `enable subgroups;`: "cannot call built-in function 'subgroupAdd' without
//     extension 'subgroups'", which is why the call derives the capability.

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { TS_CODES } from './codes.js';
import { emitModule } from '../../core/backends/wgsl.js';
import { emitGlslModule } from '../../core/backends/glsl.js';
import { reflect } from '../../core/reflect.js';
import { compileModule } from '../../core/oracle.js';
import { determinismReport } from '../../core/passes/determinism.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';
import { SUBGROUP_INTRINSICS } from '../../core/intrinsics.js';

const HEAD = `"use typeshade";
class V {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}
`;

/** Every subgroup function once, in a fragment entry, with the two fragment built-in values. */
const EVERY = `${HEAD}@fragment
export function fs(v: V, @builtin("subgroup_invocation_id") lane: u32, @builtin("subgroup_size") size: u32): vec4 {
  const x = v.uv.x;
  const u = u32(x * 8.);
  const a = subgroupAdd(x) + subgroupMul(x) + subgroupMin(x) + subgroupMax(x);
  const b = subgroupAnd(u) + subgroupOr(u) + subgroupXor(u);
  const c = subgroupExclusiveAdd(x) + subgroupInclusiveAdd(x) + subgroupExclusiveMul(x) + subgroupInclusiveMul(x);
  const d = subgroupBroadcast(x, 3) + subgroupBroadcastFirst(x) + subgroupShuffle(x, lane) + subgroupShuffleDown(x, 1) + subgroupShuffleUp(x, 1) + subgroupShuffleXor(x, 1);
  const e = subgroupExclusiveAdd(vec2(x, x));
  const ballot = subgroupBallot(x > 0.5);
  const votes = select(0., 1., subgroupAll(x > 0.)) + select(0., 1., subgroupAny(x > 2.)) + select(0., 1., subgroupElect());
  return vec4(a + f32(b) + c + d + e.x, f32(ballot.x), votes, f32(size + lane));
}
`;

const editorErrors = (source: string): string[] => {
  const service = createTypeshadeLanguageService();
  service.openDocument('a.ts', source);
  return service.getDiagnostics('a.ts').map((d) => `${d.source} ${String(d.code)}: ${d.message}`);
};
const errorsOf = (source: string): string[] =>
  compile(source)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `${d.code} ${d.message}`);

describe('the subgroup family on both halves (Rule 12.7)', () => {
  it('compiles every function and both fragment built-in values with no error in either half', () => {
    expect(errorsOf(EVERY)).toEqual([]);
    expect(editorErrors(EVERY)).toEqual([]);
  });

  it('is the 21 functions of the extension, each spelled by WGSL and named by the registry', () => {
    expect([...SUBGROUP_INTRINSICS].sort()).toEqual([
      'subgroupAdd',
      'subgroupAll',
      'subgroupAnd',
      'subgroupAny',
      'subgroupBallot',
      'subgroupBroadcast',
      'subgroupBroadcastFirst',
      'subgroupElect',
      'subgroupExclusiveAdd',
      'subgroupExclusiveMul',
      'subgroupInclusiveAdd',
      'subgroupInclusiveMul',
      'subgroupMax',
      'subgroupMin',
      'subgroupMul',
      'subgroupOr',
      'subgroupShuffle',
      'subgroupShuffleDown',
      'subgroupShuffleUp',
      'subgroupShuffleXor',
      'subgroupXor',
    ]);
  });
});

describe('WGSL: the calls, behind the directive the use derives (§50)', () => {
  const source = `"use typeshade";
declare const src: storage<array<u32>>;
declare const bins: storage<array<atomic<u32>>, "read_write">;
@compute([64])
export function cs(@builtin("global_invocation_id") gid: vec3u, @builtin("subgroup_id") sg: u32, @builtin("num_subgroups") n: u32): void {
  const v = subgroupAdd(src[gid.x]);
  if (subgroupElect()) {
    atomicAdd(bins[sg % n], v);
  }
}
`;
  it('emits enable subgroups;, the calls as WGSL spells them, and a u32 lane', () => {
    const c = compile(source);
    expect(errorsOf(source)).toEqual([]);
    const wgsl = emitModule(c.module);
    expect(wgsl.startsWith('enable subgroups;\n')).toBe(true);
    expect(wgsl).toContain('let v = subgroupAdd(src[gid.x]);');
    expect(wgsl).toContain('if (subgroupElect()) {');
    expect(wgsl).toContain('@builtin(subgroup_id) sg: u32');
    expect(wgsl).toContain('@builtin(num_subgroups) n: u32');
    expect(reflect(c.module).requiredFeatures).toContain('subgroups');
    const every = emitModule(compile(EVERY).module);
    expect(every).toContain('@builtin(subgroup_invocation_id) lane: u32');
    expect(every).toContain('@builtin(subgroup_size) size: u32');
    expect(every).toContain('subgroupBallot((x > 0.5))');
    const lane = compile(
      `${HEAD}export function f(x: f32): f32 { return subgroupBroadcast(x, 3); }`,
    );
    expect(emitModule(lane.module)).toContain('subgroupBroadcast(x, 3u)');
  });

  it('a function the file declares under a subgroup name wins, and derives nothing (Rule 9.5)', () => {
    const own = compile(`"use typeshade";
function subgroupAdd(x: f32): f32 { return x * 2.; }
export function f(x: f32): f32 { return subgroupAdd(x); }
`);
    expect(own.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(emitModule(own.module)).not.toContain('enable subgroups');
    expect(reflect(own.module).requiredFeatures).toEqual([]);
  });
});

describe('GLSL ES 3.00 and the CPU oracle: a subgroup of one invocation (Rule 11.21)', () => {
  it('spells each call as its one-lane value, with no directive and no feature', () => {
    const c = compile(EVERY);
    const glsl = emitGlslModule(c.module, 'fragment');
    expect(glsl).not.toContain('subgroup');
    expect(glsl).toContain('uint lane = 0u;');
    expect(glsl).toContain('uint size = 1u;');
    expect(glsl).toContain('uvec4 ballot = uvec4(uint((x > 0.5)), 0u, 0u, 0u);');
    // An exclusive scan is the identity of the operator (the folder then drops `0.0 + x`,
    // and the constant `e` with it); an inclusive scan, a fold and a lane read are the lane's own
    // value.
    expect(glsl).toContain('float c = ((x + 1.0) + x);');
    expect(glsl).toContain('float d = ((_gv0 + x) + x);');
    expect(glsl).not.toContain('vec2 e');
    // A vote is the lane's own bool and the lane is elected.
    expect(glsl).toContain('((x > 0.0) ? 1.0 : 0.0)');
    expect(glsl).toContain('+ 1.0);');
  });

  it('leaves an assigned binding whole: the rewrite clones only the subtrees it changes', () => {
    // `autoVars` materialises an assigned binding by the identity of its expressions, after this
    // rewrite; a clone of an untouched expression would orphan every later read (the GLSL would
    // read the initializer forever).
    const c = compile(`${HEAD}@fragment
export function fs(v: V): vec4 {
  let acc = vec2(-1., -1.);
  if (v.uv.x > 0.5) {
    acc = vec2(3., -1.);
  }
  const sum = subgroupAdd(acc.x);
  return vec4(acc, sum, 1.);
}
`);
    const glsl = emitGlslModule(c.module, 'fragment');
    expect(glsl).toContain('acc = vec2(3.0, -1.0);');
    expect(glsl).toContain('float sum = acc.x;');
    expect(glsl).toContain('_ret = vec4(acc, sum, 1.0);');
  });

  it('gives the same values on the oracle, and the compute pair the workgroup size and the index', () => {
    const c = compile(EVERY);
    const cm = compileModule(c.module, { precision: 'f32' });
    // x = 0.75: a = 3 * 0.75, b = 6 + 6 + 6 (u = 6), c = 0 + 0.75 + 1 + 0.75, d = 6 * 0.75, e.x = 0.
    const out = cm.fns.fs!({ pos: [0, 0, 0, 1], uv: [0.75, 0] }, 0, 1) as number[];
    expect(out[0]).toBeCloseTo(0.75 * 4 + 18 + 2.5 + 4.5 + 0, 5);
    expect(out[1]).toBe(1);
    expect(out[2]).toBe(2);
    expect(out[3]).toBe(1);
    const compute = compile(`"use typeshade";
declare const out: storage<array<u32>, "read_write">;
@compute([8, 2, 1])
export function cs(@builtin("local_invocation_index") i: u32, @builtin("subgroup_id") sg: u32, @builtin("num_subgroups") n: u32, @builtin("subgroup_invocation_id") lane: u32, @builtin("subgroup_size") size: u32): void {
  out[i] = sg * 1000 + n * 100 + lane * 10 + size;
}
`);
    const cmc = compileModule(compute.module, { precision: 'f32' });
    const words = new Array<number>(16).fill(0);
    cmc.setBinding('out', words);
    cmc.dispatch('cs', 1);
    expect(words[0]).toBe(0 * 1000 + 16 * 100 + 0 + 1);
    expect(words[13]).toBe(13 * 1000 + 16 * 100 + 0 + 1);
  });

  it('lists a float fold as order and a lane read as target, and an integer fold not at all', () => {
    const c = compile(EVERY);
    const rows = determinismReport(c.module).map((r) => `${r.op} ${r.kind} ${r.elem}`);
    // A read of lane 0 is the one lane the two tiers have, and `subgroupBroadcastFirst` reads it.
    expect(rows).not.toContain('subgroupBroadcastFirst target f32');
    const laneZero = compile(
      `${HEAD}export function f(x: f32): f32 { return subgroupBroadcast(x, 0) + subgroupShuffleXor(x, 0); }`,
    );
    expect(determinismReport(laneZero.module)).toEqual([]);
    const laneRuntime = compile(
      `${HEAD}export function f(x: f32, i: u32): f32 { return subgroupShuffle(x, i); }`,
    );
    expect(determinismReport(laneRuntime.module).map((r) => r.kind)).toEqual(['target']);
    for (const op of [
      'subgroupAdd',
      'subgroupMul',
      'subgroupExclusiveAdd',
      'subgroupInclusiveAdd',
      'subgroupExclusiveMul',
      'subgroupInclusiveMul',
    ])
      expect(rows).toContain(`${op} order f32`);
    for (const op of [
      'subgroupBroadcast',
      'subgroupShuffle',
      'subgroupShuffleDown',
      'subgroupShuffleUp',
      'subgroupShuffleXor',
    ])
      expect(rows).toContain(`${op} target f32`);
    for (const op of [
      'subgroupMin',
      'subgroupMax',
      'subgroupAnd',
      'subgroupOr',
      'subgroupXor',
      'subgroupAll',
      'subgroupAny',
      'subgroupBallot',
      'subgroupElect',
    ])
      expect(rows.some((r) => r.startsWith(`${op} `))).toBe(false);
  });
});

describe('the refusals the front end states (Rule 12.6)', () => {
  it('an argument no row takes, in the sentence that names the kinds', () => {
    expect(errorsOf(`${HEAD}export function f(p: bool): bool { return subgroupAdd(p); }`)).toEqual([
      `${TS_CODES.TYPE_MISMATCH} subgroupAdd takes an f32, i32 or u32, or a vector of them; got bool.`,
    ]);
    expect(errorsOf(`${HEAD}export function f(x: f32): u32 { return subgroupAnd(x); }`)).toEqual([
      `${TS_CODES.TYPE_MISMATCH} subgroupAnd takes an i32 or u32, or a vector of them; got f32.`,
    ]);
    expect(errorsOf(`${HEAD}export function f(x: f32): bool { return subgroupAll(x); }`)).toEqual([
      `${TS_CODES.TYPE_MISMATCH} subgroupAll takes a bool; got f32.`,
    ]);
  });

  it('the arity, a computed broadcast lane, and a lane of the wrong type', () => {
    expect(errorsOf(`${HEAD}export function f(x: f32): f32 { return subgroupAdd(x, x); }`)).toEqual(
      [`${TS_CODES.ARITY_MISMATCH} subgroupAdd expects 1 argument(s), got 2.`],
    );
    expect(
      errorsOf(`${HEAD}export function f(x: f32, i: u32): f32 { return subgroupBroadcast(x, i); }`),
    ).toEqual([
      `${TS_CODES.TYPE_MISMATCH} subgroupBroadcast's lane is a number written in the call (a const-expression in WGSL). For a lane computed at run time write subgroupShuffle(e, id).`,
    ]);
    expect(
      errorsOf(`${HEAD}export function f(x: f32, i: f32): f32 { return subgroupShuffle(x, i); }`),
    ).toEqual([`${TS_CODES.TYPE_MISMATCH} subgroupShuffle's lane must be a u32; got f32.`]);
  });

  it('a vertex entry, which has no subgroup to fold', () => {
    const errors = errorsOf(`${HEAD}@vertex
export function vs(@builtin("vertex_index") i: u32): V {
  const s = subgroupAdd(f32(i));
  return { pos: vec4(s), uv: vec2(0., 0.) };
}`);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(
      'WGSL allows a subgroup built-in function in a fragment or compute stage only.',
    );
  });

  it('a call reached under a value the invocations do not share (§54), and not under a uniform', () => {
    const under = errorsOf(`${HEAD}@compute([64])
export function cs(@builtin("global_invocation_id") gid: vec3u): void {
  if (gid.x > 4) {
    const s = subgroupAdd(f32(gid.x));
  }
}`);
    expect(under).toHaveLength(1);
    expect(under[0]).toContain(
      'subgroupAdd() is reached under "gid" (@builtin(global_invocation_id)), and every invocation of the subgroup has to reach it together',
    );
    expect(
      errorsOf(`${HEAD}class U { k: f32; }
declare const u: uniform<U>;
@compute([64])
export function cs(@builtin("global_invocation_id") gid: vec3u): void {
  if (u.k > 0.5) {
    const s = subgroupAdd(f32(gid.x));
  }
}`),
    ).toEqual([]);
  });

  it('the compute-only built-in values on a fragment entry', () => {
    const errors = errorsOf(`${HEAD}@fragment
export function fs(v: V, @builtin("subgroup_id") s: u32): vec4 { return vec4(f32(s)); }`);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('subgroup_id');
  });
});
