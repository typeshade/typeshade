import { describe, expect, it, vi } from 'vitest';
import { compile } from '../compiler/ts/compile.js';
import { hostFace } from '../compiler/ts/host-face.js';
import { wgslBackend } from './backends/wgsl.js';
import { buildManifest, type Pack, type PackOptions } from './manifest.js';

const source = `"use typeshade";
declare const data: storage<array<f32>, "read_write">;
@compute([1])
export function main(@builtin(global_invocation_id) id: vec3u): void {
  const x = f64(data[id.x]) * 1.000000001;
  console.log("x", f32(x));
  data[id.x] = f32(x);
}
`;

describe('reuse the validated default WGSL within a host compilation', () => {
  it('preserves the complete manifest, including fp64, console and portable IR', () => {
    const r = compile(source, { fileName: 'reuse.shade.ts' });
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(r.wgsl).toBeDefined();
    const options = { console: true, ir: true };
    const expected = buildManifest(r.module, options);
    expect(expected.console).toBeDefined();
    expect(expected.bindings.some((b) => b.injected && b.name === '_fp64')).toBe(true);
    expect(buildManifest(r.module, options, r.wgsl)).toEqual(expected);
  });

  it('keeps the default host manifest separate from recorded and integer fp64 text', () => {
    const fileName = 'reuse.shade.ts';
    const hostSource = `"use typeshade";
declare const data: storage<array<f32>, "read_write">;
@compute([1])
export function main(): void {
  const x = f64(data[0]) * 1.000000001;
  console.log("x", f32(x));
  data[0] = f32(x);
}
`;
    const face = hostFace(hostSource, { fileName, console: 'gpu', ir: true });
    expect(face.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const r = compile(hostSource, { fileName });
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const expected = buildManifest(r.module, { console: true, ir: true });
    expect(expected.console).toBeDefined();
    expect(expected.console!.wgsl).not.toBe(expected.wgsl);
    expect(expected.bindings.some((b) => b.injected && b.name === '_fp64')).toBe(true);
    expect(expected.ir).toBeDefined();
    expect(face.code).toContain('const __ts_wgsl_integer = ');

    // Read the generated manifest as the Vite integration tests do, without evaluating helpers.
    const exported = /^export default (\{.*\});$/m.exec(face.code ?? '');
    expect(exported).not.toBeNull();
    const actual = JSON.parse(exported![1]!) as Pack;
    expect(actual).toEqual(expected);
  });

  it('never reuses default text for explicit emit options or plugins', () => {
    const r = compile(source);
    const options: PackOptions[] = [
      { emit: {} },
      { emit: { level: 'O0', parens: 'minimal', fp64Flavor: 'integer' } },
      {
        emit: { plugins: [{ name: 'banner', transformText: (text) => `// plugin ran\n${text}` }] },
      },
    ];
    for (const option of options) {
      const expected = buildManifest(r.module, option);
      expect(buildManifest(r.module, option, 'default text must not be used')).toEqual(expected);
    }
  });

  it('runs the WGSL optimizer once for a plain Vite host module', () => {
    const optimize = vi.spyOn(wgslBackend, 'optimize');
    try {
      const result = hostFace(
        '"use typeshade"; export function square(x: f32): f32 { return x * x; }',
        { fileName: 'square.shade.ts' },
      );
      expect(result.diagnostics).toEqual([]);
      expect(result.code).toBeDefined();
      expect(optimize).toHaveBeenCalledTimes(1);
    } finally {
      optimize.mockRestore();
    }
  });
});
