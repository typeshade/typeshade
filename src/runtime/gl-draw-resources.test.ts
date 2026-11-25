import { describe, expect, it } from 'vitest';
import { kernelQueue } from '../core/resident.js';
import type { ResidentArrayState } from '../core/resident.js';
import { GlDrawing, GlSamplerImpl, GlTextureImpl } from './gl-draw.js';
import { recordingRhi } from '../rhi/recording-rhi.js';

const gated = (log: string[]): { release: () => void; done: Promise<void> } => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const done = kernelQueue.run(async () => {
    await gate;
    log.push('earlier work ends');
  });
  return { release, done };
};

const texture = (d: GlDrawing, extra: object = {}): GlTextureImpl =>
  new GlTextureImpl(d, { size: [2, 2], format: 'rgba8unorm', ...extra });

describe('a texture of the WebGL2 tier follows the order of the calls before it', () => {
  const ordered = async (
    act: (t: GlTextureImpl) => Promise<unknown> | void,
    check: (rec: ReturnType<typeof recordingRhi>) => void,
  ): Promise<void> => {
    const rec = recordingRhi();
    const t = texture(new GlDrawing(rec.rhi));
    const { release, done } = gated(rec.log);
    try {
      const result = act(t);
      check(rec);
      release();
      await Promise.all([done, result]);
      await kernelQueue.idle();
    } finally {
      release();
    }
    expect(rec.log.filter((e) => /^(earlier|readTexture|destroyTexture)/.test(e))).toEqual([
      'earlier work ends',
      ...(rec.log.includes('readTexture#0') ? ['readTexture#0'] : ['destroyTexture#0']),
    ]);
  };

  it('reads after the work queued before the read', () =>
    ordered(
      (t) => t.read(),
      (rec) => expect(rec.log).not.toContain('readTexture#0'),
    ));

  it.each([
    ['rgba8unorm', 4],
    ['rgba16float', 8],
    ['rgba32float', 16],
  ])(
    'reads a %s texture in texels of %i bytes, with read() and with readFloats()',
    async (format, bytes) => {
      const rec = recordingRhi();
      const t = texture(new GlDrawing(rec.rhi), { format });
      await t.read();
      await t.readFloats();
      expect(rec.reads.map((r) => r.bytesPerTexel)).toEqual([bytes, bytes]);
    },
  );

  it('destroys the texture a resize replaced after the work queued before the resize', () =>
    ordered(
      (t) => t.resize(4, 4),
      (rec) => {
        expect(rec.log).toContain('createTexture#1(4x4,rgba8unorm)');
        expect(rec.log).not.toContain('destroyTexture#0');
      },
    ));

  it('destroys a destroyed texture after the work queued before the call', () =>
    ordered(
      (t) => t.destroy(),
      (rec) => expect(rec.log).not.toContain('destroyTexture#0'),
    ));

  it('asks the device for a storage texture the usage storage and for a plain one without it', () => {
    const rec = recordingRhi();
    const d = new GlDrawing(rec.rhi);
    texture(d, { storage: true });
    texture(d);
    expect(rec.textureDescs[0]!.usage).toContain('storage');
    expect(rec.textureDescs[1]!.usage).not.toContain('storage');
  });
});

describe('a sampler of the WebGL2 tier', () => {
  it('refuses a compare that is not a comparison in WebGPU sentence', () => {
    const rec = recordingRhi();
    expect(() => new GlSamplerImpl(rec.rhi, { compare: 'sideways' } as never)).toThrow(
      new TypeError(
        '"sideways" is not a comparison; WebGPU\'s are less, less-equal, greater, greater-equal, equal, not-equal, always and never.',
      ),
    );
  });
});

describe('the drawing state of one runtime', () => {
  it('makes the _fp64 guard once, as a 1 x 1 texture that holds 1.0', () => {
    const rec = recordingRhi();
    const d = new GlDrawing(rec.rhi);
    expect(d.guard()).toBe(d.guard());
    expect(rec.textures).toHaveLength(1);
    expect(rec.textures[0]).toMatchObject({ width: 1, height: 1, format: 'rgba8unorm' });
    expect(Array.from(rec.textureWrites[0]!.bytes)).toEqual([255, 255, 255, 255]);
  });

  describe('keeps what a Resident uploaded last', () => {
    const bytes = (n: number): Uint8Array => new Uint8Array(n);
    const setup = () => {
      const rec = recordingRhi();
      const d = new GlDrawing(rec.rhi);
      const make = (size: number) => rec.rhi.createBuffer({ size, usage: ['vertex', 'copy-dst'] });
      return { rec, d, make, state: { version: 1 } as ResidentArrayState };
    };

    it('writes a buffer again only when the host copy has changed', () => {
      const { rec, d, make, state } = setup();
      const first = d.uploaded(state, 'vertices', bytes(8), make);
      expect(d.uploaded(state, 'vertices', bytes(8), make)).toBe(first);
      expect(rec.writes).toHaveLength(1);
      (state as { version: number }).version = 2;
      expect(d.uploaded(state, 'vertices', bytes(8), make)).toBe(first);
      expect(rec.writes).toHaveLength(2);
    });

    it('makes the buffer again, and destroys the old one, when the size has changed', () => {
      const { rec, d, make, state } = setup();
      const first = d.uploaded(state, 'indices', bytes(8), make);
      (state as { version: number }).version = 3;
      const second = d.uploaded(state, 'indices', bytes(16), make);
      expect(second).not.toBe(first);
      expect(rec.log).toContain('destroyBuffer#0');
      expect(second.size).toBe(16);
    });

    it('keeps one buffer for each of the kinds it became', () => {
      const { d, make, state } = setup();
      const vertices = d.uploaded(state, 'vertices', bytes(8), make);
      const indices = d.uploaded(state, 'indices', bytes(8), make);
      expect(indices).not.toBe(vertices);
    });
  });
});
