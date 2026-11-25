import { describe, expect, it } from 'vitest';
import { compile } from '../compiler/ts/compile.js';
import type { EmitPlugin } from './emit.js';
import type { ModuleDecl } from './ir/nodes.js';
import { buildManifest } from './manifest.js';

const DRAW_AND_STORING_KERNEL = `"use typeshade";
class Frame { t: f32; }
declare const frame: uniform<Frame>;
declare const data: storage<array<f32>, "read_write">;
@compute([1]) export function store(gid: builtin<"global_invocation_id">) { data[gid.x] = 1.; }
interface VsOut { pos: builtin<"position">; }
@vertex export function vs(v: builtin<"vertex_index">): VsOut {
  return { pos: vec4(f32(v), 0., 0., 1.) };
}
@fragment export function fs(): vec4 { return vec4(frame.t, 0., 0., 1.); }
`;

const moduleOf = (source: string): ModuleDecl => {
  const r = compile(source, { fileName: 'fallback.shade.ts' });
  expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return r.module!;
};

const lowerings = (m: ModuleDecl) => {
  const seen: string[][] = [];
  const spy: EmitPlugin = {
    name: 'spy',
    transformIR: (lowered) => {
      seen.push(lowered.funcs.map((f) => f.name));
      return lowered;
    },
  };
  const manifest = buildManifest(m, { emit: { plugins: [spy] } });
  return { seen, manifest };
};

describe('the WebGL2 programs of a module whose writer refuses it whole', () => {
  it('are emitted from one module pruned to what the entries reach together, before each alone', () => {
    const { seen, manifest } = lowerings(moduleOf(DRAW_AND_STORING_KERNEL));
    expect(manifest.glsl).toBeUndefined();
    expect(seen.some((names) => names.includes('store'))).toBe(true);
    expect(
      seen.some((names) => names.length === 2 && names.includes('vs') && names.includes('fs')),
    ).toBe(true);
    expect(manifest.gl?.vertices?.['vs']).not.toHaveProperty('none');
    expect(manifest.gl?.draws?.['fs']).not.toHaveProperty('none');
  });
});
