// ═══ The lattice hash the four noise twins share is exact (#184) ═══
//
// `domain-warp`, `ocean`, `kaleidoscope` and `starfield` hash a lattice point for their noise.
// They used `fract(sin(dot(p, k)) * 43758.5453)`, which WGSL does not pin down: `sin` is bound
// to 2^-11 on [-π, π] and not at all outside it, and the multiply lifts that error above the
// fraction, so the GPU need not reproduce the oracle's value (255 of 256 seeds differed). A
// twin whose value the GPU need not reproduce proves nothing.
//
// The integer hash that replaced it has no operation that may differ by driver, and its
// result is fixed to the bit: this suite pins both, against a reference written in plain
// JavaScript, on the CPU oracle and on the generated CPU code.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compile } from '../src/index.js';
import { compileModule } from '../src/core/oracle.js';
import { compileModuleJs } from '../src/core/cpu-codegen.js';

const TWINS = ['domain-warp', 'ocean', 'kaleidoscope', 'starfield'] as const;

/** lowbias32 with xxHash's primes, in 32-bit JavaScript arithmetic. */
function hash32(x: number): number {
  let h = x >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca77) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae3d) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** The lattice hash: `i32()` truncates toward zero, and `u32()` of an `i32` keeps its bits. */
function hash(x: number, y: number): number {
  const u = (v: number): number => Math.trunc(v) >>> 0;
  return (hash32(u(x) ^ hash32(u(y))) >>> 8) * 2 ** -24;
}

const POINTS: [number, number][] = [];
for (let y = -8; y <= 8; y += 1) for (let x = -8; x <= 8; x += 1) POINTS.push([x, y]);
POINTS.push([123456, -98765], [0.5, -0.5], [91.3, 45.6]);

describe.each(TWINS)('%s-twin: the lattice hash', (name) => {
  const r = compile(readFileSync(new URL(`./${name}-twin.shade.ts`, import.meta.url), 'utf8'));

  it('compiles', () => {
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  });

  it('has no operation whose result may differ by driver', () => {
    const inHash = r.determinism.filter((e) => e.where.some((s) => s === 'hash' || s === 'hash32'));
    expect(inHash).toEqual([]);
  });

  it('is bit-exact on the oracle and the generated CPU code', () => {
    const oracle = compileModule(r.module).fns['hash']!;
    const js = compileModuleJs(r.module).fns['hash']!;
    for (const [x, y] of POINTS) {
      const want = hash(x, y);
      expect(oracle([x, y] as never), `oracle (${x}, ${y})`).toBe(want);
      expect(js([x, y] as never), `codegen (${x}, ${y})`).toBe(want);
    }
  });
});
