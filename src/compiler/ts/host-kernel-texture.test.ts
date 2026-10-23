// Verifies: Rule 8.22 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 8.23 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 11.7 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 11.8 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 11.13 (docs/language-design.md; traced in reqs/).
//
// A kernel function that takes a texture (change 0077, part 2): its face, its host view and the
// checks its call makes before anything runs, and the call on the CPU tier's texture memory.
// Node has no WebGPU; the WebGPU dispatch, and the CPU tier's run of the same call, are held in a
// browser by the import journey (`scripts/user-journey.ts`).

import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hostFace } from './host-face.js';
import type { KernelFace } from '../../core/host-kernel.js';
// A device's fuse() runs through the planner `typeshade/fuse` loads (change 0071).
import '../../fuse.js';

const RUNTIME = resolve(__dirname, '../../core/host-runtime.ts');
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function face(source: string, fuse = false) {
  const f = hostFace(source, {
    fileName: '/app/m.shade.ts',
    runtime: RUNTIME,
    ...(fuse ? { fuse: true } : {}),
  });
  expect(f.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return f as Required<typeof f>;
}

async function load(source: string): Promise<Record<string, unknown>> {
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-kernel-texture-'));
  dirs.push(dir);
  const file = join(dir, 'm.shade.mjs');
  writeFileSync(file, face(source).code);
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, unknown>;
}

const INVERT = `"use typeshade";
export function invert(
  src: texture_2d<f32>,
  dst: texture_storage_2d<"rgba8unorm", "write">,
  w: u32,
  h: u32,
) {
  for (let i: u32 = 0; i < w * h; i++) {
    const c = textureLoad(src, vec2u(i % w, i / w), 0);
    textureStore(dst, vec2u(i % w, i / w), vec4(1.0 - c.rgb, c.a));
  }
}
`;

const kernelOf = (f: ReturnType<typeof face>, name: string): KernelFace => {
  const e = f.exports.find((x) => x.name === name);
  expect(e?.kind).toBe('kernel');
  return (e as { face: KernelFace }).face;
};

/** A device's texture as the call layer reads it: its size, its format, its usage and the view
 *  it binds, under the key a program runtime's texture hands its view by. */
function fakeTexture(width: number, height: number, format: string, usage = 0x1f): object {
  return {
    width,
    height,
    format,
    texture: { usage },
    [Symbol.for('typeshade.deviceView')]: () => ({}),
  };
}

describe('the face of a kernel function that takes a texture (change 0077)', () => {
  it('binds each texture as a handle, and names the width each texel store is checked by', () => {
    const k = kernelOf(face(INVERT), 'invert');
    expect(k.params.map((p) => [p.name, p.k])).toEqual([
      ['src', 'texture'],
      ['dst', 'texture'],
      ['w', 'value'],
      ['h', 'value'],
    ]);
    expect(k.noGpu).toBeUndefined();
    expect(k.gpu!.arrays).toEqual([]);
    expect(k.gpu!.textures!.map((b) => [b.name, b.space, b.storage])).toEqual([
      ['src', 'texture', undefined],
      ['dst', 'storage-texture', { format: 'rgba8unorm', access: 'write-only' }],
    ]);
    expect(k.gpu!.wgsl).toContain('var dst: texture_storage_2d<rgba8unorm, write>;');
    expect(k.gpu!.loops[0]!.texels).toEqual([{ param: 'dst', width: 'invert__texel0_0' }]);
    expect(k.noWebgl2).toBe(
      'it takes a texture, which the WebGL2 tier does not bind yet (change 0077)',
    );
  });

  it('carries no fuse record, so a fuse plan runs the call in a group of its own', () => {
    expect(kernelOf(face(INVERT, true), 'invert').fuse).toBeUndefined();
  });

  it('types a storage texture as a Texture and a sampled one as any image, in the host view', () => {
    const view = face(INVERT).view;
    expect(view).toContain('import type { Texture }');
    expect(view).toContain(
      'export declare function invert(src: ImageBitmap | ImageData | HTMLImageElement | HTMLCanvasElement | HTMLVideoElement | OffscreenCanvas | Texture, dst: Texture, w: number, h: number): Promise<void>;',
    );
  });

  it('runs on the CPU when what it computes before a loop reads a texture', () => {
    const k = kernelOf(
      face(`"use typeshade";
export function fill(dst: texture_storage_2d<"r32float", "write">) {
  const d = textureDimensions(dst);
  for (let i: u32 = 0; i < d.x * d.y; i++) {
    textureStore(dst, vec2u(i % d.x, i / d.x), vec4(1.0));
  }
}
`),
      'fill',
    );
    expect(k.noGpu).toBe(
      'the statements before loop 1 read the texture "dst", which the call runs before it dispatches',
    );
  });
});

describe('the call of a kernel function that takes a texture', () => {
  it('checks each texture before anything runs', async () => {
    const m = await load(INVERT);
    const invert = m.invert as (...a: unknown[]) => Promise<void>;
    const src = fakeTexture(4, 4, 'rgba8unorm');
    await expect(invert(src, {}, 4, 4)).rejects.toThrow(
      'invert(): parameter "dst" (texture_storage_2d<"rgba8unorm", "write">): got an object, not an image source.',
    );
    await expect(invert(src, fakeTexture(4, 4, 'r32float'), 4, 4)).rejects.toThrow(
      'invert(): parameter "dst" (texture_storage_2d<"rgba8unorm", "write">): got a r32float texture; it stores rgba8unorm.',
    );
    await expect(invert(src, fakeTexture(4, 4, 'rgba8unorm', 0x17), 4, 4)).rejects.toThrow(
      'invert(): parameter "dst" (texture_storage_2d<"rgba8unorm", "write">): the texture was made without storage: true.',
    );
    // 5 texels to a row reach past a 4-wide texture; 4 rows of 4 past a 4x3 one.
    await expect(invert(src, fakeTexture(4, 4, 'rgba8unorm'), 5, 3)).rejects.toThrow(
      'invert(): parameter "dst" is a 4x4 texture, and loop 1 stores it 5 texels to a row at iterations 0 to 14, which reach row 2.',
    );
    await expect(invert(src, fakeTexture(4, 3, 'rgba8unorm'), 4, 4)).rejects.toThrow(
      'invert(): parameter "dst" is a 4x3 texture, and loop 1 stores it 4 texels to a row at iterations 0 to 15, which reach row 3.',
    );
  });

  it('says why the CPU tier cannot read a WebGPU texture when no other tier can run it', async () => {
    const m = await load(INVERT);
    const invert = m.invert as (...a: unknown[]) => Promise<void>;
    await expect(
      invert(fakeTexture(4, 4, 'rgba8unorm'), fakeTexture(4, 4, 'rgba8unorm'), 4, 4),
    ).rejects.toThrow(
      'cpu: parameter "src" is a texture the CPU tier cannot read; it reads an ImageData and a texture a device on the CPU tier made',
    );
  });
});

describe('a texture call on the CPU tier (change 0077, Rule 11.7)', () => {
  // Verifies: Rule 11.7. The CPU tier holds a texture's texels and runs the call over them.
  const SEED = `"use typeshade";
export function seed(dst: texture_storage_2d<"rgba8unorm", "write">, w: u32, h: u32) {
  for (let i: u32 = 0; i < w * h; i++) {
    const v = f32((i * 37 + 11) % 256) / 255.0;
    textureStore(dst, vec2u(i % w, i / w), vec4(v, 1.0 - v, 0.25, 1.0));
  }
}
`;

  it('stores into a device texture and reads it back, each byte as the format rounds it', async () => {
    const { createDevice } = await import('../../runtime/device.js');
    const dev = await createDevice({ prefer: ['cpu'] });
    const m = await load(SEED + INVERT.replace('"use typeshade";', ''));
    const seed = m.seed as (...a: unknown[]) => Promise<void>;
    const invert = m.invert as (...a: unknown[]) => Promise<void>;
    const src = dev.texture({ size: [4, 3], format: 'rgba8unorm', storage: true });
    const dst = dev.texture({ size: [4, 3], format: 'rgba8unorm', storage: true });
    const report = await dev.fuse(() => {
      void seed(src, 4, 3);
      void invert(src, dst, 4, 3);
    });
    // Verifies: Rule 11.13. Each texture call is a group of its own; a group on the CPU tier
    // carries no reason (surface §71).
    expect(report.groups.length).toBe(2);
    const round = (v: number): number => Math.round(Math.min(Math.max(v, 0), 1) * 255);
    const seeded = Array.from({ length: 12 }, (_, i) => {
      const v = Math.fround(((i * 37 + 11) % 256) / 255);
      return [round(v), round(Math.fround(1 - v)), round(0.25), 255];
    }).flat();
    expect([...(await src.read())]).toEqual(seeded);
    // invert reads each byte as v / 255 and stores 1 - v, which rounds back to 255 - byte.
    expect([...(await dst.read())]).toEqual(seeded.map((b, j) => (j % 4 === 3 ? b : 255 - b)));
    await dev.dispose();
  });

  it('infers a CPU texture’s owner outside a scope (0085)', async () => {
    const { createDevice } = await import('../../runtime/device.js');
    const dev = await createDevice({ prefer: ['cpu'] });
    const m = await load(SEED);
    const t = dev.texture({ size: [2, 2], format: 'rgba8unorm', storage: true });
    await (m.seed as (...a: unknown[]) => Promise<void>)(t, 2, 2);
    expect([...(await t.read())].slice(0, 4)).toEqual([11, 244, 64, 255]);
    await dev.dispose();
  });

  it('refuses mixed texture owners before writing the destination', async () => {
    const { createDevice } = await import('../../runtime/device.js');
    const a = await createDevice({ prefer: ['cpu'] }),
      b = await createDevice({ prefer: ['cpu'] });
    try {
      const m = await load(SEED + INVERT.replace('"use typeshade";', ''));
      const src = a.texture({ size: [2, 2], format: 'rgba8unorm', storage: true });
      const dst = b.texture({ size: [2, 2], format: 'rgba8unorm', storage: true });
      await (m.seed as (...a: unknown[]) => Promise<void>)(src, 2, 2);
      await expect(
        (m.invert as (...a: unknown[]) => Promise<void>)(src, dst, 2, 2),
      ).rejects.toThrow('A call takes resources from one owner');
      expect([...(await dst.read())]).toEqual(new Array(16).fill(0));
    } finally {
      await a.dispose();
      await b.dispose();
    }
  });
});
