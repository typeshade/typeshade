import { describe, expect, it } from 'vitest';
import type { Layout } from '../core/host-entry.js';
import { Region } from './region.js';
import { Core, DIRTY_RANGE_LIMIT, readValue } from './resource-state.js';

function bytesOf(region: Region, core: Core, n: number): number[] {
  return [...new Uint8Array(region.buffer, core.range.offset, n)];
}

describe('Core.resize keeps the first bytes and zeroes the rest', () => {
  it('shrinks to the kept bytes and marks the whole new range dirty', () => {
    const region = new Region(256);
    const core = new Core(region, 16, 'Buffer<X>', 'zeros()', 4);
    new Uint8Array(region.buffer, core.range.offset, 16).set([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
    ]);
    core.clean();
    core.resize(8, 8);
    expect(bytesOf(region, core, 8)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(core.ranges()).toEqual([[0, core.range.size]]);
    expect(core.bytes).toBe(8);
  });

  it('grows with a zeroed tail, frees the old range and keeps the data across a compaction', () => {
    const region = new Region(64, false);
    const core = new Core(region, 32, 'Buffer<X>', 'zeros()', 4);
    const old = core.range;
    new Uint8Array(region.buffer, old.offset, 32).fill(7);
    const before = region.buffer;
    core.resize(200, 32);
    expect(region.buffer).not.toBe(before);
    expect(old.freed).toBe(true);
    expect(core.range.freed).toBe(false);
    const grown = bytesOf(region, core, 200);
    expect(grown.slice(0, 32).every((x) => x === 7)).toBe(true);
    expect(grown.slice(32).every((x) => x === 0)).toBe(true);
    expect(core.ranges()).toEqual([[0, core.range.size]]);
  });

  it('reads the old offset after a compaction that moved the old range', () => {
    const region = new Region(128, false);
    const lower = new Core(region, 64, 'Buffer<X>', 'zeros()', 4);
    const core = new Core(region, 32, 'Buffer<X>', 'zeros()', 4);
    new Uint8Array(region.buffer, core.range.offset, 32).fill(5);
    region.free(lower.range);
    const at = core.range.offset;
    core.resize(96, 32);
    expect(at).toBeGreaterThan(0);
    const grown = bytesOf(region, core, 96);
    expect(grown.slice(0, 32).every((x) => x === 5)).toBe(true);
    expect(grown.slice(32).every((x) => x === 0)).toBe(true);
  });

  it('drops every byte when nothing is kept', () => {
    const region = new Region(64);
    const core = new Core(region, 8, 'Buffer<X>', 'zeros()', 4);
    new Uint8Array(region.buffer, core.range.offset, 8).fill(9);
    core.resize(8, 0);
    expect(bytesOf(region, core, 8)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('Core dirty ranges', () => {
  it('starts with the whole range dirty as one range', () => {
    const core = new Core(new Region(64), 24, 'Uniform<X>', 'uniform()');
    expect(core.dirty).toBe(true);
    expect(core.ranges()).toEqual([[0, core.range.size]]);
  });

  it('widens the one range of a uniform to cover every write', () => {
    const core = new Core(new Region(64), 32, 'Uniform<X>', 'uniform()');
    core.clean();
    expect(core.dirty).toBe(false);
    expect(core.span()).toBeUndefined();
    core.mark(8, 12);
    core.mark(20, 24);
    expect(core.ranges()).toEqual([[8, 24]]);
    core.mark(0, 4);
    expect(core.ranges()).toEqual([[0, 24]]);
    expect(core.span()).toEqual({ from: 0, to: 24 });
  });

  it('rounds a write of a storage array to the elements it reaches', () => {
    const core = new Core(new Region(256), 64, 'Buffer<X>', 'zeros()', 8);
    core.clean();
    core.mark(9, 17);
    expect(core.ranges()).toEqual([[8, 24]]);
  });

  it('joins all ranges into one past the limit', () => {
    const n = 4 * DIRTY_RANGE_LIMIT;
    const core = new Core(new Region(1024), 8 * n, 'Buffer<X>', 'zeros()', 8);
    core.clean();
    for (let i = 0; i < DIRTY_RANGE_LIMIT; i++) core.mark(16 * i, 16 * i + 8);
    expect(core.ranges()).toHaveLength(DIRTY_RANGE_LIMIT);
    core.mark(16 * DIRTY_RANGE_LIMIT, 16 * DIRTY_RANGE_LIMIT + 8);
    expect(core.ranges()).toEqual([[0, 16 * DIRTY_RANGE_LIMIT + 8]]);
  });
});

describe('Core.current and Core.live', () => {
  it('refuses a read while a call has written the resource, and names it', () => {
    const core = new Core(new Region(64), 8, 'Buffer<X>', 'zeros()', 4);
    core.current('Buffer<X>.get()');
    core.ahead = {} as never;
    expect(() => core.current('Buffer<X>.get()')).toThrow(
      'Buffer<X>.get(): a call wrote Buffer<X>, and its values are on the device until `await Buffer<X>.read()` brings them back; await it first.',
    );
  });

  it('refuses a disposed resource and names the way to make a new one', () => {
    const region = new Region(64);
    const core = new Core(region, 8, 'Buffer<X>', 'zeros()', 4);
    core.live();
    region.free(core.range);
    expect(() => core.live()).toThrow(
      'Buffer<X> was disposed; its fields cannot be read or set. Make a new one with zeros().',
    );
  });

  it('gives the error of a device copy, else the kept error', () => {
    const core = new Core(new Region(64), 8, 'Buffer<X>', 'zeros()', 4);
    expect(core.error()).toBeUndefined();
    core.kept = 'kept';
    expect(core.error()).toBe('kept');
  });
});

describe('readValue', () => {
  const word = (n: number): DataView => {
    const dv = new DataView(new ArrayBuffer(16));
    dv.setUint32(0, n, true);
    return dv;
  };

  it('gives a bool word and a key id as the word a call takes, without decode', () => {
    const bool: Layout = { k: 's', t: 'u32', b: 1 } as Layout;
    expect(readValue(word(1), 0, bool)).toBe(1);
    expect(readValue(word(1), 0, bool, undefined, true)).toBe(true);
    expect(readValue(word(0), 0, bool, undefined, true)).toBe(false);
  });

  it('gives a key id as its member with decode', () => {
    const key: Layout = { k: 's', t: 'u32', m: ['a', 'b'] } as Layout;
    expect(readValue(word(1), 0, key)).toBe(1);
    expect(readValue(word(1), 0, key, undefined, true)).toBe('b');
  });

  it('adds the two f32 halves of an f64', () => {
    const dv = new DataView(new ArrayBuffer(16));
    dv.setFloat32(0, 1.5, true);
    dv.setFloat32(4, 0.25, true);
    expect(readValue(dv, 0, { k: 's', t: 'f64' } as Layout)).toBe(1.75);
  });

  it('gives an object with the prototype it is given', () => {
    class P {}
    const layout = { k: 'o', sz: 4, f: [['x', 0, { k: 's', t: 'u32' }]] } as unknown as Layout;
    const out = readValue(word(5), 0, layout, P.prototype) as { x: number };
    expect(out).toBeInstanceOf(P);
    expect(out.x).toBe(5);
  });
});
