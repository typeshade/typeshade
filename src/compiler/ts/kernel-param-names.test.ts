// Verifies: Rule 3.3 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 3.4 (docs/language-design.md; traced in reqs/).
//
// A kernel function's array parameter is a storage binding in WGSL and a sampler in WebGL2
// (#602). The emitted binding takes a fresh spelling when the target reserves the authored name;
// the host face, the reflection and the CPU tier keep the authored name. Each test reads both
// halves of the language (CLAUDE.md, "A test reads both halves"): the compiler's face and emit,
// and the editor's diagnostics on the same source.

import { describe, expect, it, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hostFace } from './host-face.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';
import { WGSL_RESERVED } from '../../core/reserved-words.js';
import { isGlslReserved } from '../../core/backends/glsl-sanitize.js';

const RUNTIME = resolve(__dirname, '../../core/host-runtime.ts');
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** A kernel whose array parameter `p` is read and whose array `out` is written at `i`. */
const kernel = (p: string): string => `"use typeshade";
export function k(out: array<f32>, ${p}: array<f32>) {
  for (let i: u32 = 0; i < arrayLength(out); i++) {
    out[i] = ${p}[i] * 2.0;
  }
}`;

/** The spelling a target gives an authored name: the name itself, or a fresh one when reserved. */
const spelled = (name: string, reserved: (name: string) => boolean): string =>
  reserved(name) ? `${name}_` : name;

/** The words the sample covers: the four the issue names, the WGSL keywords and reserved words
 *  it lists, and the GLSL ES 3.00 words of Rule 3.4 a WebGPU host also refuses. Each is a valid
 *  TypeScript identifier. */
const WORDS = [
  'filter',
  'std',
  'mean',
  'target',
  'as',
  'asm',
  'alignas',
  'self',
  'cast',
  'discard',
  'fn',
  'loop',
  'struct',
  'texture',
  'sampler',
  'buffer',
  'shared',
  'packed',
  'half',
  'sample',
  'input',
  'image2D',
  'resource',
  'layout',
  'union',
  'namespace',
];

const download = (src: string): ReturnType<typeof hostFace> => {
  const f = hostFace(src, { fileName: '/app/m.shade.ts', runtime: RUNTIME });
  expect(f.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return f;
};

type KernelExport = Extract<ReturnType<typeof download>['exports'][number], { kind: 'kernel' }>;

function kernelOf(src: string) {
  const f = download(src);
  const exp = f.exports.find((e): e is KernelExport => e.name === 'k' && e.kind === 'kernel');
  expect(exp).toBeDefined();
  return {
    f,
    face: exp!.face as KernelExport['face'] & {
      gpu: { wgsl: string; arrays: { name: string }[] };
      gl: { loops: { glsl: string; reads: { param: string; name: string }[] }[] };
      noWebgl2?: string;
      noGpu?: string;
      params: { name: string }[];
    },
  };
}

describe('Rule 3.3: a kernel array parameter named by a WGSL reserved word', () => {
  it.each(WORDS)('the emitted WGSL declares no reserved binding for "%s"', (word) => {
    const { face } = kernelOf(kernel(word));
    const wgsl: string = face.gpu.wgsl;
    const name = spelled(word, (n) => WGSL_RESERVED.has(n));
    // The binding and its references carry the spelling the WGSL allows.
    expect(wgsl).toContain(`var<storage, read> ${name}: array<f32>;`);
    expect(wgsl).toContain(`${name}[i]`);
    if (name !== word) expect(wgsl).not.toMatch(new RegExp(`(^|[^\\w.])${word}\\s*[:\\[]`, 'm'));
  });

  it.each(WORDS)('the host face keeps the authored name "%s"', (word) => {
    const { face } = kernelOf(kernel(word));
    expect(face.params.map((p: { name: string }) => p.name)).toEqual(['out', word]);
    expect(face.gpu.arrays.map((a: { name: string }) => a.name)).toEqual(['out', word]);
    expect(face.noGpu).toBeUndefined();
  });

  it.each(WORDS)('the WebGL2 tier names its sampler "%s" fresh when GLSL reserves it', (word) => {
    const { face } = kernelOf(kernel(word));
    const name = spelled(word, isGlslReserved);
    expect(face.noWebgl2).toBeUndefined();
    const glsl: string = face.gl.loops[0].glsl;
    expect(glsl).toContain(`uniform sampler2D ${name};`);
    expect(face.gl.loops[0].reads.map((r: { param: string }) => r.param)).toEqual([word]);
    expect(face.gl.loops[0].reads.map((r: { name: string }) => r.name)).toEqual([name]);
  });

  it('the CPU tier and the WGSL emit read the same array', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'typeshade-param-'));
    dirs.push(dir);
    const { f, face } = kernelOf(kernel('filter'));
    const file = join(dir, 'm.shade.mjs');
    writeFileSync(file, f.code);
    const mod = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as {
      k: (out: Float32Array, filter: Float32Array) => Promise<void>;
    };
    const filter = Float32Array.from([1, 2, 3, 4]);
    const out = new Float32Array(4);
    await mod.k(out, filter);
    expect(Array.from(out)).toEqual([2, 4, 6, 8]);
    const wgsl = face.gpu.wgsl;
    expect(wgsl).toContain('out[i] = (filter_[i] * 2.0);');
  });

  it('the editor reports nothing for a kernel with a reserved parameter name', () => {
    for (const word of ['filter', 'std', 'mean', 'target']) {
      const service = createTypeshadeLanguageService();
      service.openDocument('a.ts', kernel(word));
      expect(service.getDiagnostics('a.ts')).toEqual([]);
    }
  });
});
