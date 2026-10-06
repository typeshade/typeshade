// `compileModuleJs(m).dispatch` runs a barrier-free entry through its compiled function (#467).
// Measured on radiance's path tracer at e923a34: the interpreter's lockstep took 6657 us a
// path and a per-invocation `fns` loop 147 us, with the same bindings. What is pinned here: a
// barrier-free entry leaves the same bindings and report on both CPU modules and in a `fns`
// loop, and goes through the compiled function; an entry that reaches a barrier, directly or
// through a helper, still runs in lockstep and still refuses a divergent barrier.

import { describe, expect, it } from 'vitest';
import { compile } from '../compiler/ts/compile.js';
import { compileModule, type CpuModule } from './oracle.js';
import { compileModuleJs } from './cpu-codegen.js';
import type { CpuValue } from './cpu-runtime.js';
import type { ConsoleEvent } from './console.js';

// A bounded loop, storage reads, a `+=` into a read_write array, workgroup memory written and read by
// the same invocation, a private variable, a helper, and a scalar binding written back.
const TRACE = `"use typeshade";
declare const seeds: storage<array<u32>>;
declare const accum: storage<array<f32>, "read_write">;
declare const last: storage<u32, "read_write">;
let scratch: workgroup<array<f32, 8>>;
let bounces: u32 = 0;
function lcg(x: u32): u32 {
  return (x * 1664525 + 1013904223) & 1023;
}
@compute([8, 1, 1])
export function trace(
  @builtin("global_invocation_id") gid: vec3u,
  @builtin("local_invocation_id") lid: vec3u,
  @builtin("workgroup_id") wid: vec3u,
): void {
  let s: u32 = seeds[gid.x];
  let e: f32 = 0.;
  for (let n: u32 = 0; n < 16; n++) {
    if (s <= 40) {
      break;
    }
    s = lcg(s) % 997;
    e += f32(s) / 997.;
    bounces += 1;
  }
  scratch[lid.x] = e;
  accum[gid.x] += scratch[lid.x] + f32(bounces) + f32(wid.x);
  last = gid.x;
}
`;

function run(cm: CpuModule, how: 'dispatch' | 'fns') {
  const seeds = Array.from({ length: 24 }, (_, i) => (i * 37 + 11) % 1000);
  const accum = Array.from({ length: 24 }, (_, i) => i * 0.5);
  cm.setBinding('seeds', seeds);
  cm.setBinding('accum', accum);
  cm.setBinding('last', 0);
  let report;
  if (how === 'dispatch') report = cm.dispatch('trace', 3);
  else
    for (let i = 0; i < 24; i++)
      cm.fns['trace']!([i, 0, 0], [i % 8, 0, 0], [Math.floor(i / 8), 0, 0]);
  return { accum, report };
}

describe('dispatch on the codegen runs a barrier-free entry compiled (#467)', () => {
  it('leaves the same bindings and report as the oracle and as a fns loop, in both precisions', () => {
    for (const precision of ['f64', 'f32'] as const) {
      const r = compile(TRACE);
      expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
      const oracle = run(compileModule(r.module, { precision }), 'dispatch');
      const codegen = run(compileModuleJs(r.module, { precision }), 'dispatch');
      const loop = run(compileModuleJs(r.module, { precision }), 'fns');
      expect(codegen.accum, precision).toEqual(oracle.accum);
      expect(loop.accum, precision).toEqual(oracle.accum);
      expect(codegen.report).toEqual({ workgroups: 3, invocations: 24, barrierPhases: 0 });
      expect(codegen.report).toEqual(oracle.report);
    }
  });

  it('hands a scalar binding back and calls the compiled function once per invocation', () => {
    const cm = compileModuleJs(compile(TRACE).module);
    const compiled = cm.fns['trace']!;
    let calls = 0;
    cm.fns['trace'] = (...a: CpuValue[]) => {
      calls++;
      return compiled(...a);
    };
    const accum = Array.from({ length: 16 }, () => 0);
    cm.setBinding(
      'seeds',
      Array.from({ length: 16 }, () => 500),
    );
    cm.setBinding('accum', accum);
    cm.setBinding('last', 0);
    cm.dispatch('trace', [2, 1, 1]);
    expect(calls).toBe(16);
    expect(accum[0]).toBeGreaterThan(0);
    // Every invocation starts from the same seed and its private \`bounces\` at 0; the second
    // workgroup's \`wid.x\` is 1.
    expect(accum.slice(8)).toEqual(accum.slice(0, 8).map((v) => v + 1));
  });

  it('tags each console event with its invocation, as the oracle does', () => {
    const src = `"use typeshade";
declare const out: storage<array<u32>, "read_write">;
@compute([2, 1, 1])
export function k(@builtin("global_invocation_id") gid: vec3u): void {
  console.log(gid.x);
  out[gid.x] = gid.x;
}
`;
    const r = compile(src);
    const seen: ConsoleEvent[][] = [];
    for (const make of [compileModule, compileModuleJs]) {
      const events: ConsoleEvent[] = [];
      const cm = make(r.module, { consoleSink: (e) => events.push(e) });
      cm.setBinding('out', [0, 0, 0, 0]);
      cm.dispatch('k', 2);
      seen.push(events);
    }
    expect(seen[1]!.map((e) => e.invocation)).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
      [3, 0, 0],
    ]);
    expect(seen[1]).toEqual(seen[0]);
  });
});

describe('dispatch on the codegen keeps lockstep where a barrier is reachable (#467)', () => {
  const HELPER = `"use typeshade";
declare const src: storage<array<f32>>;
declare const out: storage<array<f32>, "read_write">;
let tile: workgroup<array<f32, 4>>;
function sync(): void {
  workgroupBarrier();
}
@compute([4, 1, 1])
export function k(@builtin("global_invocation_id") gid: vec3u, @builtin("local_invocation_id") lid: vec3u): void {
  tile[lid.x] = src[gid.x];
  sync();
  out[gid.x] = tile[3 - lid.x];
}
`;

  it('runs a barrier in a helper in lockstep, without the compiled entry', () => {
    const r = compile(HELPER);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const cm = compileModuleJs(r.module);
    const compiled = cm.fns['k']!;
    let calls = 0;
    cm.fns['k'] = (...a: CpuValue[]) => {
      calls++;
      return compiled(...a);
    };
    const out = [0, 0, 0, 0, 0, 0, 0, 0];
    cm.setBinding('src', [1, 2, 3, 4, 5, 6, 7, 8]);
    cm.setBinding('out', out);
    expect(cm.dispatch('k', 2)).toEqual({ workgroups: 2, invocations: 8, barrierPhases: 2 });
    expect(out).toEqual([4, 3, 2, 1, 8, 7, 6, 5]);
    expect(calls).toBe(0);
  });

  it('still refuses invocations that do not all reach the barrier', () => {
    const src = `"use typeshade";
declare const out: storage<array<u32>, "read_write">;
@compute([4, 1, 1])
export function k(@builtin("local_invocation_id") lid: vec3u): void {
  if (lid.x == 0) { return; }
  workgroupBarrier();
  out[lid.x] = 1;
}
`;
    const r = compile(src);
    const cm = compileModuleJs(r.module);
    cm.setBinding('out', [0, 0, 0, 0]);
    expect(() => cm.dispatch('k', 1)).toThrow(/reached by 3 of 4 invocations/);
  });
});
