import { afterEach, describe, expect, it } from 'vitest';
import { configure } from './resident.js';
import { array } from '../runtime.js';
import { pendingClears } from './host-entry.js';
import { residentState } from './resident.js';
import {
  fakeGpu,
  FakeImageData,
  loadEntries,
  type FakeOptions,
} from './testing/entry-program-harness.js';
import { hostFace } from '../compiler/ts/host-face.js';

const entries = (recordConsole?: boolean, source?: string) =>
  loadEntries(hostFace, recordConsole, source);

afterEach(() => {
  configure({ runtime: null });
  configure({});
});

const floats = (...xs: number[]) => Float32Array.of(...xs);
const fill5 = (storage: ArrayBuffer[]) => storage.forEach((b) => new Float32Array(b).fill(5));
const MAP_READ_COPY_DST = 9;
const INDIRECT = 256;

async function onGpu(options: FakeOptions = {}) {
  const gpu = fakeGpu(options);
  configure({ runtime: { device: gpu.device }, prefer: ['webgpu'] });
  return { gpu, m: await entries() };
}

describe('the WebGPU tier of an entry call', () => {
  it('reads back what a written binding holds into the caller value in place, and nothing else', async () => {
    const { gpu, m } = await onGpu({ onDispatch: fill5 });
    const [xs, out, total] = [floats(1, 2, 3), floats(0, 0, 0), new Float32Array(1)];
    await m.scale({ params: { k: 2 }, xs, out, total }, 1);
    expect(xs).toEqual(floats(1, 2, 3));
    expect(out).toEqual(floats(5, 5, 5));
    expect(total).toEqual(floats(5));
    expect(gpu.made.filter((b) => b.usage === MAP_READ_COPY_DST)).toHaveLength(2);
  });

  it('copies what the entry wrote to staging in the submission of the pass, inside one error scope', async () => {
    const { gpu, m } = await onGpu();
    await m.scale(
      { params: { k: 2 }, xs: floats(1), out: floats(0), total: new Float32Array(1) },
      1,
    );
    expect(gpu.commands.filter((c) => c === 'submit')).toHaveLength(1);
    expect(gpu.commands.filter((c) => c === 'copy')).toHaveLength(2);
    expect(gpu.commands.indexOf('dispatch 1')).toBeLessThan(gpu.commands.indexOf('copy'));
    expect(gpu.commands.lastIndexOf('copy')).toBeLessThan(gpu.commands.indexOf('submit'));
    expect(gpu.commands[0]).toBe('push');
    expect(gpu.commands.at(-1)).toBe('pop');
  });

  it('binds each packed buffer with the size it holds, not the size of the pooled buffer', async () => {
    const { gpu, m } = await onGpu();
    await m.scale(
      { params: { k: 2 }, xs: floats(1, 2, 3), out: floats(0, 0, 0), total: floats(0) },
      1,
    );
    const sizes = gpu.bound[0]!.map((e) => e.size);
    expect(sizes).toEqual([16, 12, 12, 4]);
    expect(gpu.bound[0]![1]!.buffer.size).toBeGreaterThan(12);
  });

  it('binds a Resident as its device buffer and stages only the read of the Resident itself', async () => {
    const { gpu, m } = await onGpu({ onDispatch: fill5 });
    const out = array(floats(1, 2, 3));
    await m.twin({ params: { k: 2 }, xs: floats(1, 2, 3), out }, 1);
    expect(await out.read()).toEqual(floats(5, 5, 5));
    expect(gpu.bound[0]!.some((e) => (e.buffer.usage & INDIRECT) !== 0)).toBe(true);
    expect(gpu.made.filter((b) => b.usage === MAP_READ_COPY_DST)).toHaveLength(1);
  });

  it('refuses a call that the device reports invalid with the name of the entry', async () => {
    const { m } = await onGpu({ validation: 'boom' });
    const call = m.scale({ params: { k: 2 }, xs: floats(1), out: floats(0), total: floats(0) }, 1);
    await expect(call).rejects.toThrow(new Error('scale(): WebGPU refused the call: boom'));
  });

  it('refuses a module whose WGSL did not compile before it uploads anything, and keeps the refusal', async () => {
    const { gpu, m } = await onGpu({
      compile: [
        { type: 'error', message: 'bad' },
        { type: 'warning', message: 'meh' },
        { type: 'error', message: 'worse' },
      ],
    });
    const call = () =>
      m.scale({ params: { k: 2 }, xs: floats(1), out: floats(0), total: floats(0) }, 1);
    const message = "scale: WebGPU refused the module's WGSL: line 3:4 bad; line 3:4 worse";
    await expect(call()).rejects.toThrow(new Error(message));
    await expect(call()).rejects.toThrow(new Error(message));
    expect(gpu.commands).toEqual([]);
    expect(gpu.made).toEqual([]);
    expect(gpu.shaders).toHaveLength(1);
    expect(gpu.pipelines).toEqual([]);
  });

  it('shares one shader module among the entries of a module and makes each pipeline once', async () => {
    const { gpu, m } = await onGpu();
    const args = () => ({ params: { k: 2 }, xs: floats(1), out: floats(0), total: floats(0) });
    await m.scale(args(), 1);
    await m.scale(args(), 1);
    await m.twin({ params: { k: 2 }, xs: floats(1), out: floats(0) }, 1);
    expect(gpu.shaders).toHaveLength(1);
    expect(gpu.pipelines).toHaveLength(2);
  });

  it('closes the error scope and gives the pool its buffers back when the call fails before the submit', async () => {
    const { gpu, m } = await onGpu({ bindGroupFailsOnce: 'no bind group' });
    const args = () => ({ params: { k: 2 }, xs: floats(1), out: floats(0), total: floats(0) });
    await expect(m.scale(args(), 1)).rejects.toThrow('no bind group');
    await new Promise((r) => setImmediate(r));
    expect(gpu.commands.filter((c) => c === 'push')).toHaveLength(1);
    expect(gpu.commands.filter((c) => c === 'pop')).toHaveLength(1);
    const taken = gpu.made.length;
    await m.scale(args(), 1);
    expect(gpu.made.length - taken).toBe(2);
  });

  it('dispatches from the buffer of an indirect count at four bytes for each offset', async () => {
    const { gpu, m } = await onGpu();
    const counts = array(Uint32Array.of(9, 9, 9, 2, 1, 1));
    const out = array(floats(0));
    await m.twin({ params: { k: 2 }, xs: floats(1), out }, { indirect: counts, offset: 3 });
    await out.read();
    expect(gpu.commands).toContain('dispatchIndirect at 12');
    expect(gpu.commands.some((c) => c.startsWith('dispatch '))).toBe(false);
  });

  describe('a Resident that waits to be cleared', () => {
    const make = async (options: FakeOptions) => {
      const { gpu, m } = await onGpu(options);
      const counts = array(Uint32Array.of(1, 1, 1));
      const out = array(floats(1, 2, 3));
      const call = () =>
        m.twin({ params: { k: 2 }, xs: floats(1, 2, 3), out }, { indirect: counts });
      await call();
      await out.read();
      gpu.commands.length = 0;
      const waiting = (r: object) => {
        const buffer = residentState(r)!.gpu!.buffer;
        const pending = { clearPending: true, gpu: { size: 12 } };
        pendingClears.set(buffer, pending as never);
        return { buffer, pending };
      };
      return { gpu, call, out, counts, waiting };
    };

    it('is cleared in the submission of the pass, before the pass, and no more than once', async () => {
      const { gpu, call, out, waiting } = await make({});
      const w = waiting(out);
      await call();
      await out.read();
      expect(gpu.commands.filter((c) => c === 'clear')).toHaveLength(1);
      expect(gpu.commands.indexOf('clear')).toBeLessThan(
        gpu.commands.findIndex((c) => c.startsWith('dispatch')),
      );
      expect(pendingClears.has(w.buffer)).toBe(false);
      expect(w.pending.clearPending).toBe(false);
    });

    it('is cleared with a write of zeros where the encoder cannot clear a buffer', async () => {
      const { gpu, call, out, waiting } = await make({ withoutClearBuffer: true });
      const w = waiting(out);
      const bytes = (w.buffer as unknown as { record: { bytes: ArrayBuffer } }).record.bytes;
      expect(new Float32Array(bytes, 0, 3)).toEqual(floats(1, 2, 3));
      await call();
      await out.read();
      expect(gpu.commands).not.toContain('clear');
      expect(new Float32Array(bytes, 0, 3)).toEqual(floats(0, 0, 0));
    });

    it('is cleared when it holds the indirect count of the call', async () => {
      const { gpu, call, out, counts, waiting } = await make({});
      const w = waiting(counts);
      await call();
      await out.read();
      expect(gpu.commands.filter((c) => c === 'clear')).toHaveLength(1);
      expect(pendingClears.has(w.buffer)).toBe(false);
    });
  });

  it('destroys the textures it made for the call when the call fails before the submit', async () => {
    const { gpu, m } = await onGpu({ bindGroupFailsOnce: 'no bind group' });
    const call = () => m.look({ photo: new FakeImageData(2, 1), smp: {}, out: floats(0) }, 1);
    globalThis.ImageData = FakeImageData as never;
    try {
      await expect(call()).rejects.toThrow('no bind group');
    } finally {
      delete (globalThis as Record<string, unknown>)['ImageData'];
    }
    expect(gpu.textures.map((t) => t.destroys)).toEqual([1]);
  });

  it('drops the console buffer a failed call recorded, so that the next call reads only its own', async () => {
    const gpu = fakeGpu({ bindGroupFailsOnce: 'no bind group' });
    configure({ runtime: { device: gpu.device }, prefer: ['webgpu'] });
    const m = await entries(true);
    await expect(m.shout({ out: floats(0) }, 1)).rejects.toThrow('no bind group');
    gpu.commands.length = 0;
    await m.shout({ out: floats(0) }, 1);
    expect(gpu.commands.filter((c) => c === 'copy')).toHaveLength(2);
  });
});
