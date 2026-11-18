import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';

const render = (decls: string, body = 'return vec4(1., 0., 0., 1.)') => `"use typeshade"
${decls}
@fragment export function fs(): vec4 { ${body} }
`;

describe('a module the target never reaches is not held to its list (#103)', () => {
  it('keeps a field named half in a compute-only module, which emits no GLSL', () => {
    const r = compile(`"use typeshade";
declare const sink: storage<array<f32>, "read_write">;
class P { half: f32; }
@compute([64, 1, 1]) export function k(gid: builtin<"global_invocation_id">): void {
  const p: P = { half: 2. };
  sink[gid.x] = p.half;
}
`);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(r.wgsl).toContain('half');
    expect(r.glsl).toBeUndefined();
  });

  it('keeps the names the GLSL writer renames for itself', () => {
    const r = compile(render('', 'let out: f32 = 1.; return vec4(out, 0., 0., 1.)'));
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(r.glsl?.fragment).toContain('out_');
    expect(r.wgsl).toContain('out');
  });
});
