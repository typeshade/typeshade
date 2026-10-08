import { describe, expect, it } from 'vitest';
import { packModule, packJson } from './pack.js';
import { compile } from './compile.js';
import { repack } from '../../emit.js';
import { vec4fT, vec3fT, vec2fT, f32T, structT } from '../../core/ir/types.js';
import type { ModuleDecl } from '../../core/ir/nodes.js';

const hello: ModuleDecl = {
  consts: [],
  structs: [
    {
      name: 'VsIn',
      fields: [
        { name: 'position', type: vec3fT, attr: '@location(0)', location: 0 },
        { name: 'uv', type: vec2fT, attr: '@location(1)', location: 1 },
      ],
    },
    {
      name: 'Clip',
      fields: [{ name: 'pos', type: vec4fT, attr: '@builtin(position)', builtin: 'position' }],
    },
    {
      name: 'Color',
      fields: [{ name: 'color', type: vec4fT, attr: '@location(0)', location: 0 }],
    },
    {
      name: 'Camera',
      fields: [{ name: 'pos', type: vec3fT }],
    },
  ],
  bindings: [{ group: 0, binding: 0, name: 'camera', space: 'uniform', type: structT('Camera') }],
  funcs: [
    {
      name: 'vs',
      params: [{ name: 'vin', type: structT('VsIn') }],
      ret: structT('Clip'),
      body: [
        {
          s: 'return',
          expr: {
            op: 'construct',
            type: structT('Clip'),
            args: [
              {
                op: 'construct',
                type: vec4fT,
                args: [
                  {
                    op: 'member',
                    type: vec3fT,
                    base: { op: 'param', type: structT('VsIn'), name: 'vin' },
                    field: 'position',
                  },
                  { op: 'lit', type: f32T, value: 1 },
                ],
              },
            ],
          },
        },
      ],
      stage: 'vertex',
      attrs: ['@vertex'],
    },
    {
      name: 'fs',
      params: [],
      ret: structT('Color'),
      body: [
        {
          s: 'return',
          expr: {
            op: 'construct',
            type: structT('Color'),
            args: [
              {
                op: 'construct',
                type: vec4fT,
                args: [
                  { op: 'lit', type: f32T, value: 1 },
                  { op: 'lit', type: f32T, value: 0 },
                  { op: 'lit', type: f32T, value: 0 },
                  { op: 'lit', type: f32T, value: 1 },
                ],
              },
            ],
          },
        },
      ],
      stage: 'fragment',
      attrs: ['@fragment'],
    },
  ],
};

describe('pack', () => {
  it('emits json-serializable wgsl + bindings + vertexLayout', () => {
    const p = packModule(hello);
    expect(p.wgsl).toMatch(/@vertex/);
    expect(p.wgsl).toMatch(/var<uniform> camera/);
    expect(p.glsl?.vertex).toMatch(/#version 300 es/);
    expect(p.schema).toBe(1);
    // The fields packModule() has always given, and schema 1's resource and layout.
    expect(p.bindings).toMatchObject([
      {
        name: 'camera',
        space: 'uniform',
        group: 0,
        binding: 0,
        type: 'struct:Camera',
        resource: { resourceKind: 'uniform-buffer' },
        stages: [],
        rule: 'std140',
        layout: { kind: 'struct' },
      },
    ]);
    expect(p.vertexLayout?.arrayStride).toBe(20);
    expect(p.entries.map((e) => e.stage).sort()).toEqual(['fragment', 'vertex']);
    expect(() => JSON.parse(packJson(hello))).not.toThrow();
  });
});

describe("a function the module declares under a builtin's name, in the manifest (Rule 9.5)", () => {
  // Every program the manifest carries is written by a writer that renames the declaration: the
  // WGSL, the WebGL2 draw of a fragment entry and the pass program of a compute entry. `repack`
  // writes them again from the portable IR and gives the same text.
  const SRC = `"use typeshade";
declare const out: storage<array<f32>, "read_write">;
function fract(x: f32): f32 { return x - floor(x) + 0.5; }
@compute([1])
export function main() { out[0] = fract(out[1]); out[2] = fract(1.25) + random(out[1]); }
class Color { @location(0) color: vec4; }
@fragment
export function fs(@builtin("position") p: vec4): Color { return { color: vec4(fract(p.x), 0., 0., 1.) }; }
`;

  it('spells the declaration fract_ in every program, and keeps the builtin random calls', () => {
    const c = compile(SRC);
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const p = packModule(c.module, { ir: true });
    const programs = [
      p.wgsl,
      JSON.stringify(p.gl?.draws?.fs ?? null),
      JSON.stringify(p.gl?.computes?.main ?? null),
    ];
    for (const text of programs) {
      expect(text).toMatch(/(fn|float) fract_\(/);
      expect(text).not.toMatch(/(fn|float) fract\(/);
    }
    expect(p.wgsl).toContain('fract((sin(');
    expect(programs[2]).toContain('fract((sin(');
    expect(JSON.stringify(repack(p))).toBe(JSON.stringify(p));
  });
});
