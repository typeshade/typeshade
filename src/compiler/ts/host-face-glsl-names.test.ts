import { describe, expect, it } from 'vitest';
import { hostFace } from './host-face.js';

const SOURCE = `"use typeshade";
declare const input: uniform<vec4>;
declare const tint: uniform<vec4>;
@fragment export function fs(p: builtin<"position">): vec4 { return input + tint * p.x; }
`;

describe('the bindings of a full-screen draw, where the GLSL writer respells one (Proposal 0070, C8)', () => {
  it('carries the GLSL spelling of the binding it respells, and of no other', () => {
    const host = hostFace(SOURCE, { fileName: '/app/m.shade.ts' });
    expect(host.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const fs = host.exports?.find((e) => e.name === 'fs');
    if (fs?.kind !== 'fragment') throw new Error(`fs is ${fs?.kind}`);
    const glsl = Object.fromEntries(
      fs.entry.bindings.map((b) => [b.name, 'glsl' in b ? b.glsl : undefined]),
    );
    expect(glsl).toEqual({ input: 'input_', tint: undefined });
    expect('glsl' in fs.entry.bindings[1]!).toBe(false);
  });
});
