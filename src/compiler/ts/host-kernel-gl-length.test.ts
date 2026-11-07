// Verifies: Rule 8.23, Rule 11.8, Rule 12.7, Rule 13.3.
// #689: accepted 0072 records these array-length reads as a compiler gap, not a tier limit.
// Native measurement: scripts/kernel-length-cases.ts, Chromium 156.0.8078.4 with
// ANGLE/SwiftShader, 2026-11-07. Baseline f826ece5 refused all 10 WebGL2 calls with
// "arrayLength has no GLSL ES 3.00 spelling"; 20 WebGPU/CPU controls passed.
// The fix passes all 30 readbacks, including changed input lengths on all three tiers.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { compile } from './compile.js';
import { hostFace } from './host-face.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';
import { checkCall } from '../../core/host-kernel.js';
import { resident } from '../../core/resident.js';

function face(body: string) {
  const source = `"use typeshade";\n${body}`;
  const fileName = '/app/lengths.shade.ts';
  const compiled = compile(source, { fileName });
  const service = createTypeshadeLanguageService();
  service.openDocument(fileName, source);
  expect(compiled.diagnostics).toEqual([]);
  expect(service.getDiagnostics(fileName)).toEqual([]);
  service.closeDocument(fileName);
  const host = hostFace(source, { fileName });
  expect(host.diagnostics).toEqual([]);
  const entry = host.exports?.find((entry) => entry.kind === 'kernel');
  if (entry?.kind !== 'kernel') throw new Error('missing kernel');
  return entry.face;
}

describe('WebGL2 array-length uniforms (#689)', () => {
  it.each(['f32', 'i32', 'u32', 'vec4', 'P'])(
    'counts elements of a length-only array<%s> without an element texture',
    (element) => {
      const kernel = face(`interface P { value: vec4; flag: u32; }
export function k(out: array<f32>, x: array<${element}>): void {
  for (let i: u32 = 0; i < out.length; i++) out[i] = f32(x.length);
}`);
      expect(kernel.noWebgl2).toBeUndefined();
      expect(kernel.gpu).toBeDefined();
      const loop = kernel.gl!.loops[0]!;
      expect(loop.reads).toEqual([]);
      expect(loop.uniforms.filter((uniform) => uniform.lengthOf !== undefined)).toEqual([
        expect.objectContaining({ lengthOf: 'x', scalar: 'u32', n: 1 }),
      ]);
      expect(loop.glsl).not.toContain('arrayLength');
      expect(loop.glsl).not.toContain('sampler2D');
    },
  );

  it('reads the output length in the body independently of the dispatch range', () => {
    const kernel = face(`export function k(out: array<u32>): void {
  for (let i: u32 = 1; i < out.length; i++) out[i] = out.length;
}`);
    expect(kernel.noWebgl2).toBeUndefined();
    expect(kernel.gl!.loops[0]!.uniforms).toContainEqual(
      expect.objectContaining({ lengthOf: 'out', scalar: 'u32', n: 1 }),
    );
  });

  it('keeps a hoisted length and an element read on separate host bindings', () => {
    const kernel = face(`export function k(out: array<f32>, x: array<f32>): void {
  const n = x.length;
  for (let i: u32 = 0; i < out.length; i++) out[i] = f32(n) + x[i];
}`);
    expect(kernel.noWebgl2).toBeUndefined();
    expect(kernel.gl!.loops[0]!.reads.map((read) => read.param)).toEqual(['x']);
    expect(kernel.gl!.loops[0]!.uniforms).toContainEqual(
      expect.objectContaining({ lengthOf: 'x' }),
    );
  });

  it('keeps authored scalar and reserved array names separate from generated length uniforms', () => {
    const kernel =
      face(`export function k(out: array<u32>, filter: array<u32>, _length0: u32): void {
  for (let i: u32 = 0; i < out.length; i++) out[i] = filter.length + _length0;
}`);
    expect(kernel.noWebgl2).toBeUndefined();
    const uniforms = kernel.gl!.loops[0]!.uniforms;
    expect(new Set(uniforms.map((uniform) => uniform.name)).size).toBe(uniforms.length);
    expect(uniforms.find((uniform) => uniform.lengthOf === 'filter')?.name).not.toBe('_length0');
    expect(uniforms).toContainEqual(expect.objectContaining({ name: '_length0', scalar: 'u32' }));
  });

  it('uses one length uniform per parameter even when its body reads the length repeatedly', () => {
    const kernel = face(`export function k(out: array<u32>, x: array<u32>): void {
  for (let i: u32 = 0; i < out.length; i++) out[i] = x.length + x.length;
}`);
    expect(kernel.noWebgl2).toBeUndefined();
    expect(
      kernel.gl!.loops[0]!.uniforms.filter((uniform) => uniform.lengthOf === 'x'),
    ).toHaveLength(1);
  });

  it('leaves an authored arrayLength helper intact beside the length intrinsic', () => {
    const kernel = face(`function arrayLength(i: u32): u32 { return i + 1; }
export function k(out: array<u32>, x: array<u32>): void {
  for (let i: u32 = 0; i < out.length; i++) out[i] = arrayLength(i) + x.length;
}`);
    expect(kernel.noWebgl2).toBeUndefined();
    const loop = kernel.gl!.loops[0]!;
    expect(loop.glsl).toContain('arrayLength_(');
    expect(loop.uniforms.filter((uniform) => uniform.lengthOf !== undefined)).toEqual([
      expect.objectContaining({ lengthOf: 'x' }),
    ]);
  });

  it('uses the checked element count of typed subarrays, vector arrays and resident views', () => {
    const cpu = { F: {}, $: { bindings: {}, vars: {} } };
    for (const element of ['f32', 'vec4']) {
      const kernel = face(`export function k(out: array<u32>, x: array<${element}>): void {
  for (let i: u32 = 0; i < out.length; i++) out[i] = x.length;
}`);
      const view = new Float32Array(32).subarray(4, element === 'f32' ? 7 : 16);
      const held = resident(view);
      try {
        for (const argument of [view, held]) {
          const checked = checkCall(cpu, { ...kernel, gpu: undefined }, 2, [
            new Uint32Array(2),
            argument,
          ]);
          expect(checked.values).toEqual([2, 3]);
        }
      } finally {
        held.destroy();
      }
    }
  });

  it('keeps empty-array and held-count validation before tier selection', () => {
    const kernel = face(`export function k(out: array<u32>, x: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) out[i] = x.length;
}`);
    const cpu = { F: {}, $: { bindings: {}, vars: {} } };
    const checked = { ...kernel, gpu: undefined };
    expect(() => checkCall(cpu, checked, 2, [new Uint32Array(1), new Float32Array(0)])).toThrow(
      'k(): parameter "x" (array<f32>): got an empty array, which WebGPU cannot bind.',
    );
    expect(() => checkCall(cpu, checked, 2, [new Uint32Array(0), new Float32Array(1)])).toThrow(
      'k(): parameter "out" (array<u32>): got an empty array, which WebGPU cannot bind.',
    );
    const count = resident(new Uint32Array([1]));
    try {
      expect(() =>
        checkCall(cpu, checked, 2, [
          new Uint32Array(1),
          { array: new Float32Array(3), length: count },
        ]),
      ).toThrow(
        'k(): parameter "x" is an array no loop pushes onto, so it takes no { array, length, offset? }. Pass the array itself.',
      );
    } finally {
      count.destroy();
    }
  });

  it('keeps a device-derived range separate from a host-known array length', () => {
    const kernel =
      face(`export function k(out: array<u32>, count: array<u32>, x: array<f32>): void {
  for (let i: u32 = 0; i < count[0]; i++) out[i] = x.length;
}`);
    expect(kernel.noWebgl2).toBeUndefined();
    expect(kernel.gpu!.loops[0]!.device).toBeDefined();
    expect(kernel.gl!.loops[0]!.uniforms).toContainEqual(
      expect.objectContaining({ lengthOf: 'x' }),
    );
    expect(kernel.gl!.loops[0]!.reads.map((read) => read.param)).not.toContain('x');
  });

  it('keeps multiple-output and struct-parameter refusals unchanged (#809)', () => {
    expect(
      face(`export function k(a: array<f32>, b: array<f32>): void {
  for (let i: u32 = 0; i < a.length; i++) { a[i] = 1.; b[i] = 2.; }
}`).noWebgl2,
    ).toBe('loop 1 writes more than one array, and WebGL2 draws one');
    expect(
      face(`interface Range { value: f32; }
export function k(out: array<f32>, range: Range): void {
  for (let i: u32 = 0; i < out.length; i++) out[i] = range.value;
}`).noWebgl2,
    ).toBe('parameter "range" is not a number or a vector, which a uniform holds');
  });

  it('keeps pushes and captured helper bindings on their existing tiers', () => {
    expect(
      face(`export function k(out: array<f32>, x: array<f32>): void {
  for (let i: u32 = 0; i < x.length; i++) out.push(x[i]);
}`).noWebgl2,
    ).toBe('loop 1 pushes onto an array, which the WebGL2 tier does not run (change 0078)');
    expect(
      face(`declare const x: storage<array<f32>>;
function n(): u32 { return x.length; }
export function k(out: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) out[i] = f32(n());
}`).noGpu,
    ).toBe('it reaches "x", which the call does not pass');
  });

  it('gives the accepted scans and compaction their WebGL2 programs', () => {
    const source = readFileSync(new URL('../../algorithms/scan.shade.ts', import.meta.url), 'utf8');
    const fileName = '/app/scan.shade.ts';
    const compiled = compile(source, { fileName });
    const service = createTypeshadeLanguageService();
    service.openDocument(fileName, source);
    expect(compiled.diagnostics).toEqual([]);
    expect(service.getDiagnostics(fileName)).toEqual([]);
    service.closeDocument(fileName);
    const host = hostFace(source, { fileName });
    expect(host.diagnostics).toEqual([]);
    for (const name of ['exclusiveScan', 'inclusiveScan', 'compact']) {
      const entry = host.exports!.find((entry) => entry.name === name);
      if (entry?.kind !== 'kernel') throw new Error(`missing ${name}`);
      expect(entry.face.noWebgl2).toBeUndefined();
      expect(entry.face.gl!.loops.length).toBe(name === 'compact' ? 1 : 2);
    }
  });
});
