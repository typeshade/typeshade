// The WebGL2 pass program of change 0054 (`buildGlCompute`), as data. The program itself is run
// on WebGL2 by the GPU differential's compute arm (`scripts/gl-compute-arm.ts`), which holds what
// it leaves to the CPU model of the executor; here, what the executor reads from the program.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compile } from '../../compiler/ts/compile.js';
import { buildGlCompute } from './gl-compute.js';
import { PROGRAMS } from '../testing/compute-programs.js';
import { stageOf } from '../ir/index.js';

describe('buildGlCompute (change 0054)', () => {
  it('lays a record out with what the host reads first, and captures it in one draw', () => {
    const p = PROGRAMS['atomicAdd with its value, in one workgroup']!;
    const g = buildGlCompute(compile(p.src).module, p.entry);
    expect([g.pcWord, g.countWord, g.requestAt, g.keysAt]).toEqual([0, 1, 2, 5]);
    expect(g.valuesAt).toBeGreaterThanOrEqual(g.keysAt + 16);
    expect(g.recordTexels).toBe(Math.ceil((g.valuesAt + 16) / 4));
    expect([g.slices, g.sliceTexels]).toEqual([1, g.recordTexels]);
    expect(g.varyings).toHaveLength(g.recordTexels);
    expect(Object.values(g.cuts)).toEqual(['atomic', 'atomic']);
    expect(Object.values(g.requests).map((r) => [r.fn, r.elem, r.result !== undefined])).toEqual([
      ['atomicAdd', 'u32', true],
      ['atomicAdd', 'u32', true],
    ]);
    expect(g.vertex).toContain('flat out uvec4 _phx_o0;');
    expect(g.vertex).toContain('void main()');
    expect(g.vertex).toContain('gl_VertexID');
  });

  it('reads memory, records and controls from 2D array textures, in the layout it is given', () => {
    const p = PROGRAMS['a write at gid.x']!;
    const m = compile(p.src).module;
    const g = buildGlCompute(m, p.entry);
    expect(g.layout).toEqual({ width: 2048, layerRows: 2048 });
    for (const t of ['_phx_mem0', '_phx_rec', '_phx_inv'])
      expect(g.vertex).toContain(`uniform usampler2DArray ${t};`);
    expect(g.vertex).toContain('% 2048u');
    const small = buildGlCompute(m, p.entry, { width: 16, layerRows: 2 });
    expect(small.layout).toEqual({ width: 16, layerRows: 2 });
    expect(small.vertex).toContain('% 2u');
  });

  it("keeps an author local apart from the pass program's own names", () => {
    // `const w` in this example was hoisted to the name of the pass loop's counter, and the
    // pass program assigned a struct to an int.
    const src = readFileSync(
      fileURLToPath(new URL('../../../examples/array-length.shade.ts', import.meta.url)),
      'utf8',
    );
    const g = buildGlCompute(compile(src).module, 'scale_all');
    expect(g.vertex).toMatch(/_phv\d+_w = Weights\(/);
    expect(g.vertex).not.toMatch(/__/);
  });

  it('wraps a uniform that is not a struct in a block, and names it', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../../../examples/particle-step.shade.ts', import.meta.url)),
      'utf8',
    );
    const g = buildGlCompute(compile(src).module, 'k');
    expect(g.uniforms.map((u) => [u.name, u.block])).toEqual([['delta', '_PhU_delta']]);
    expect(g.vertex).toContain('uniform _PhU_delta');
  });

  it('builds every compute entry of the examples that binds no texture', () => {
    const dir = fileURLToPath(new URL('../../../examples/', import.meta.url));
    const built: string[] = [];
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.shade.ts'))) {
      const src = readFileSync(join(dir, f), 'utf8');
      if (!src.includes('@compute')) continue;
      const r = compile(src);
      if (r.diagnostics.some((d) => d.category === 'error')) continue;
      if (
        r.module.bindings.some((b) =>
          ['texture', 'storage-texture', 'sampler'].includes(b.type.kind),
        )
      )
        continue;
      for (const e of r.module.funcs.filter((x) => stageOf(x) === 'compute')) {
        buildGlCompute(r.module, e.name);
        built.push(`${f}:${e.name}`);
      }
    }
    expect(built.length).toBeGreaterThanOrEqual(9);
  });
});
