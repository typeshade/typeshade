import { describe, it, expect } from 'vitest';
import { i32T, u32T } from '../ir/index.js';
import { glStub, runnerOn, kernelOf } from './runner-webgl2-contract-fixtures.js';

describe('createComputeRunner webgl2 tier: grid and upload', () => {
  it('wraps both textures at 2048 texels and trims the grid padding from the result', async () => {
    const s = glStub();
    const r = await runnerOn(s);
    const got = await r.run(new Float32Array(3000));
    const sizes = s.named('texImage2D').map((c) => [c.args[3], c.args[4]]);
    expect(sizes).toEqual([
      [2048, 2],
      [2048, 2],
    ]);
    expect(s.named('readPixels')[0]!.args.slice(2, 4)).toEqual([2048, 2]);
    expect(got.length).toBe(3000);
    expect(got[0]).toBe(1);
    expect(got[2999]).toBe(3000);
  });

  it('keeps a short grid one row wide', async () => {
    const s = glStub();
    const r = await runnerOn(s);
    const got = await r.run(new Float32Array(10), 7);
    expect(s.named('texImage2D').map((c) => [c.args[3], c.args[4]])).toEqual([
      [10, 1],
      [7, 1],
    ]);
    expect(got.length).toBe(7);
  });

  it('zero-pads a partial last row so the upload covers the whole texture', async () => {
    const s = glStub();
    const r = await runnerOn(s);
    const data = Float32Array.from({ length: 2049 }, (_, i) => i + 1);
    await r.run(data);
    const upload = s.named('texSubImage2D')[0]!;
    const lanes = upload.args[8] as Float32Array;
    expect(upload.args.slice(4, 6)).toEqual([2048, 2]);
    expect(lanes.length).toBe(4096);
    expect(Array.from(lanes.subarray(0, 2049))).toEqual(Array.from(data));
    expect(lanes.subarray(2049).every((v) => v === 0)).toBe(true);
  });

  it('uploads the window of a subarray, not the start of its backing buffer', async () => {
    const s = glStub();
    const r = await runnerOn(s);
    const backing = Float32Array.from({ length: 12 }, (_, i) => i + 100);
    await r.run(backing.subarray(4, 9));
    const lanes = s.named('texSubImage2D')[0]!.args[8] as Float32Array;
    expect(Array.from(lanes)).toEqual([104, 105, 106, 107, 108]);
  });

  it('reads an integer input through a view of the caller window, unconverted', async () => {
    for (const elem of [u32T, i32T]) {
      const s = glStub();
      const r = await runnerOn(s, kernelOf({ elem }));
      const backing = new Float32Array(12);
      const bits = new Uint32Array(backing.buffer);
      bits.set([0, 0, 0, 0, 0xdeadbeef, 7, 0x80000001, 3, 9, 0, 0, 0]);
      await r.run(backing.subarray(4, 9));
      const lanes = s.named('texSubImage2D')[0]!.args[8] as Uint32Array | Int32Array;
      expect(lanes.constructor).toBe(elem === u32T ? Uint32Array : Int32Array);
      expect(Array.from(new Uint32Array(lanes.buffer, lanes.byteOffset, lanes.length))).toEqual([
        0xdeadbeef, 7, 0x80000001, 3, 9,
      ]);
    }
  });
});
