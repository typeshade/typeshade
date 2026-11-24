import { describe, expect, it } from 'vitest';
import { webgl2Device } from './webgl2.js';
import { fakeGl } from './webgl2-fake-gl.js';

const bytesOf = (view: ArrayBufferView): Uint8Array =>
  new Uint8Array(view.buffer, view.byteOffset, view.byteLength);

function setup(format: string, size: [number, number], gpu: ArrayBufferView) {
  const fake = fakeGl({
    returns: {
      getBufferSubData: (_target, _offset, into) => {
        const target = into as Uint8Array;
        target.set(bytesOf(gpu).subarray(0, target.length));
      },
    },
  });
  const device = webgl2Device(fake.gl);
  const texture = device.createTexture({ size: [size[0], size[1], 1], format, usage: [] });
  return { ...fake, device, texture };
}

async function read(
  format: string,
  size: [number, number],
  bytesPerTexel: number,
  gpu: ArrayBufferView,
) {
  const s = setup(format, size, gpu);
  const out = await s.device.readTexture(s.texture, bytesPerTexel);
  return { ...s, out };
}

const half = async (values: number[]): Promise<number[]> => {
  const gpu = new Float32Array(values.length * 4);
  values.forEach((v, i) => (gpu[i * 4] = v));
  const { out } = await read('r16float', [values.length, 1], 2, gpu);
  const view = new DataView(out.buffer);
  return values.map((_, i) => view.getUint16(i * 2, true));
};

const words = async (format: string, r: number[], g: number[], b: number[]): Promise<number[]> => {
  const gpu = new Float32Array(r.length * 4);
  r.forEach((_, i) => gpu.set([r[i]!, g[i]!, b[i]!, 1], i * 4));
  const { out } = await read(format, [r.length, 1], 4, gpu);
  return Array.from(new Uint32Array(out.buffer));
};

describe('reading texels back on WebGL2', () => {
  it('reads RGBA bytes as they are for a red-first texel', async () => {
    const { out, calls } = await read(
      'rgba8unorm',
      [2, 1],
      4,
      new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
    );
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(calls).toContain('readPixels(0,0,2,1,RGBA,UNSIGNED_BYTE,0)');
  });

  it('swaps red and blue of a blue-first texel on a read', async () => {
    const { out } = await read('bgra8unorm', [2, 1], 4, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    expect(Array.from(out)).toEqual([3, 2, 1, 4, 7, 6, 5, 8]);
  });

  it('keeps the channels of the format and drops the rest of the RGBA read', async () => {
    const gpu = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(Array.from((await read('r8unorm', [2, 1], 1, gpu)).out)).toEqual([1, 5]);
    expect(Array.from((await read('rg8unorm', [2, 1], 2, gpu)).out)).toEqual([1, 2, 5, 6]);
  });

  it('reads a 32-bit float colour with a float read, and a 16-bit one as half floats', async () => {
    const gpu = new Float32Array([1.5, -2, 0, 4]);
    const wide = await read('rgba32float', [1, 1], 16, gpu);
    expect(Array.from(new Float32Array(wide.out.buffer))).toEqual([1.5, -2, 0, 4]);
    expect(wide.calls).toContain('readPixels(0,0,1,1,RGBA,FLOAT,0)');
    const narrow = await read('rgba16float', [1, 1], 8, gpu);
    expect(Array.from(new Uint16Array(narrow.out.buffer))).toEqual([0x3e00, 0xc000, 0, 0x4400]);
  });

  it('rounds a number to a half float to the nearest, with the sign of zero', async () => {
    expect(await half([1, -2, 0, -0, 65504])).toEqual([0x3c00, 0xc000, 0, 0x8000, 0x7bff]);
    expect(await half([1 + 2 ** -10, 1 + 2 ** -11, 1 + 2 ** -12])).toEqual([
      0x3c01, 0x3c01, 0x3c00,
    ]);
    expect(await half([1.99999])).toEqual([0x4000]);
  });

  it('rounds a small number to a half float as a subnormal', async () => {
    expect(await half([2 ** -15, 2 ** -24, 2 ** -26])).toEqual([0x200, 1, 0]);
  });

  it('gives a half float for infinity and not-a-number', async () => {
    expect(await half([Infinity, -Infinity, NaN])).toEqual([0x7c00, 0xfc00, 0x7c01]);
  });

  it('packs rg11b10ufloat from the three floats, rounding to the nearest', async () => {
    const one = 960 | (960 << 11) | (480 << 22);
    expect(await words('rg11b10ufloat', [1], [1], [1])).toEqual([one >>> 0]);
    expect(await words('rg11b10ufloat', [1 + 2 ** -7], [0], [-3])).toEqual([961]);
    expect(await words('rg11b10ufloat', [0.5], [2], [4])).toEqual([
      (896 | (1024 << 11) | (544 << 22)) >>> 0,
    ]);
  });

  it('packs the infinity and the not-a-number of rg11b10ufloat', async () => {
    const [word] = await words('rg11b10ufloat', [Infinity], [NaN], [Infinity]);
    expect(word).toBe((1984 | (1985 << 11) | (992 << 22)) >>> 0);
  });

  it('reads integers with an integer read, cut to the bytes of the format', async () => {
    const wide = await read(
      'r32uint',
      [2, 1],
      4,
      new Uint32Array([7, 0, 0, 0, 4294967295, 0, 0, 0]),
    );
    expect(Array.from(new Uint32Array(wide.out.buffer))).toEqual([7, 4294967295]);
    expect(wide.calls).toContain('readPixels(0,0,2,1,RGBA_INTEGER,UNSIGNED_INT,0)');
    const signed = await read('r32sint', [1, 1], 4, new Int32Array([-5, 0, 0, 0]));
    expect(Array.from(new Int32Array(signed.out.buffer))).toEqual([-5]);
    expect(signed.calls).toContain('readPixels(0,0,1,1,RGBA_INTEGER,INT,0)');
    const short = await read('rg16uint', [1, 1], 4, new Uint32Array([70000, 3, 0, 0]));
    expect(Array.from(new Uint16Array(short.out.buffer))).toEqual([70000 & 0xffff, 3]);
    const byte = await read('r8sint', [1, 1], 1, new Int32Array([-1, 0, 0, 0]));
    expect(Array.from(byte.out)).toEqual([255]);
  });

  it('joins the four fields of rgb10a2uint into one word', async () => {
    const { out } = await read('rgb10a2uint', [1, 1], 4, new Uint32Array([1, 2, 3, 3]));
    expect(new Uint32Array(out.buffer)[0]).toBe((1 | (2 << 10) | (3 << 20) | (3 << 30)) >>> 0);
  });

  it('reads rgb10a2unorm as the packed word the context gives', async () => {
    const { out, calls } = await read('rgb10a2unorm', [2, 1], 4, new Uint32Array([0xdeadbeef, 5]));
    expect(Array.from(new Uint32Array(out.buffer))).toEqual([0xdeadbeef, 5]);
    expect(calls).toContain('readPixels(0,0,2,1,RGBA,UNSIGNED_INT_2_10_10_10_REV,0)');
  });

  it('copies a depth texture into an r32float texture, and reads that', async () => {
    const { out, calls, texture } = await read(
      'depth32float',
      [2, 1],
      4,
      new Float32Array([0.25, 0, 0, 1, 0.75, 0, 0, 1]),
    );
    expect(Array.from(new Float32Array(out.buffer))).toEqual([0.25, 0.75]);
    expect(calls).toContain('drawArrays(TRIANGLES,0,3)');
    expect(calls).toContain('readPixels(0,0,2,1,RGBA,FLOAT,0)');
    const scratch = calls.find((c) => c.startsWith('texStorage2D(TEXTURE_2D,1,R32F'));
    expect(scratch).toBe('texStorage2D(TEXTURE_2D,1,R32F,2,1)');
    expect(calls.filter((c) => c.startsWith('deleteTexture('))).toHaveLength(1);
    expect(texture.format).toBe('depth32float');
    const reads = calls.filter((c) => c.startsWith('framebufferTexture2D(READ_FRAMEBUFFER'));
    expect(reads[0]).not.toContain(
      (texture as unknown as { native: { __name: string } }).native.__name,
    );
  });

  it('reads no colour texture through a copy', async () => {
    const { calls } = await read('rgba8unorm', [1, 1], 4, new Uint8Array(4));
    expect(calls).not.toContain('drawArrays(TRIANGLES,0,3)');
    expect(calls.filter((c) => c.startsWith('deleteTexture('))).toEqual([]);
    expect(calls.filter((c) => c.startsWith('blitFramebuffer('))).toEqual([]);
  });

  it('waits for a fence before it reads the bytes, and frees the buffer', async () => {
    const { calls } = await read('rgba8unorm', [1, 1], 4, new Uint8Array(4));
    const at = (prefix: string): number => calls.findIndex((c) => c.startsWith(prefix));
    expect(at('readPixels(')).toBeGreaterThan(-1);
    expect(at('fenceSync(')).toBeGreaterThan(at('readPixels('));
    expect(at('getBufferSubData(')).toBeGreaterThan(at('fenceSync('));
    expect(at('deleteBuffer(')).toBeGreaterThan(at('getBufferSubData('));
    expect(calls).toContain('pixelStorei(PACK_ALIGNMENT,1)');
  });

  it('rejects a read of a texture the host made, as a rejected promise', async () => {
    class WebGLTexture {}
    const holder = globalThis as unknown as Record<string, unknown>;
    const before = holder.WebGLTexture;
    holder.WebGLTexture = WebGLTexture;
    try {
      const { device } = setup('rgba8unorm', [1, 1], new Uint8Array(4));
      const own = device.fromNative('texture', new WebGLTexture());
      expect(own).toBeDefined();
      const result = device.readTexture(own!, 4);
      await expect(result).rejects.toThrow(
        'readTexture on WebGL2 reads a texture the device made.',
      );
    } finally {
      holder.WebGLTexture = before;
    }
  });
});
