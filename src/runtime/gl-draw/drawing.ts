import type { ResidentArrayState } from '../../core/resident.js';
import type { RhiBuffer, RhiDevice, RhiTextureView } from '../../rhi/rhi.js';

export class GlDrawing {
  #guard: RhiTextureView | undefined;
  readonly uploads = new WeakMap<
    ResidentArrayState,
    Map<string, { buffer: RhiBuffer; version: number }>
  >();

  constructor(readonly rhi: RhiDevice) {}

  guard(): RhiTextureView {
    if (this.#guard === undefined) {
      const t = this.rhi.createTexture({
        size: [1, 1, 1],
        format: 'rgba8unorm',
        usage: ['sampled', 'copy-dst'],
      });
      this.rhi.writeTexture(t, new Uint8Array([255, 255, 255, 255]), 4, 1, 1);
      this.#guard = this.rhi.createView(t);
    }
    return this.#guard;
  }

  uploaded(
    state: ResidentArrayState,
    as: string,
    bytes: ArrayBufferView,
    make: (size: number) => RhiBuffer,
  ): RhiBuffer {
    let byKind = this.uploads.get(state);
    if (byKind === undefined) this.uploads.set(state, (byKind = new Map()));
    const hit = byKind.get(as);
    if (hit !== undefined && hit.version === state.version) return hit.buffer;
    let buffer = hit?.buffer;
    if (buffer === undefined || buffer.size !== bytes.byteLength) {
      if (buffer !== undefined) this.rhi.destroyBuffer(buffer);
      buffer = make(bytes.byteLength);
    }
    this.rhi.writeBuffer(buffer, 0, bytes);
    byKind.set(as, { buffer, version: state.version });
    return buffer;
  }
}
