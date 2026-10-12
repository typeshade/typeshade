// A pass on WebGL2 leaves no error on its context.
//
// A pass detaches the colour attachments it does not use. It once did so up to
// `COLOR_ATTACHMENT7` whatever the context allowed, and on a context whose
// `MAX_COLOR_ATTACHMENTS` is lower (SwiftShader's) each detach past the limit was `INVALID_ENUM`.
// The error stayed on the context, which the call layer shares with the program runtime where
// there is no WebGPU, and the next kernel call's `getError()` reported it as its own failure
// (`WebGL2 error 0x500`). This suite holds the pass to a context that refuses an attachment at or
// above 4; `bun run gate:journeys` holds the same order of calls on a real WebGL2 context.

import { describe, expect, it } from 'vitest';
import { GlDrawing, recordPass } from './gl-draw.js';

const COLOR_ATTACHMENT0 = 0x8ce0;
const MAX_COLOR_ATTACHMENTS = 0x8cdf;
const INVALID_ENUM = 0x500;

/** A WebGL2 context that does nothing, allows `max` colour attachments, and keeps the first error
 *  a call raises until `getError()` reads it, as WebGL2 does. */
function fakeGl(max: number): { gl: WebGL2RenderingContext; attached: number[] } {
  let error = 0;
  const attached: number[] = [];
  const constants: Record<string, number> = {
    NO_ERROR: 0,
    INVALID_ENUM,
    MAX_COLOR_ATTACHMENTS,
    COLOR_ATTACHMENT0,
    FRAMEBUFFER: 0x8d40,
    TEXTURE_2D: 0x0de1,
    DEPTH_STENCIL_ATTACHMENT: 0x821a,
    NONE: 0,
  };
  const methods: Record<string, (...a: unknown[]) => unknown> = {
    getParameter: (p) => (p === MAX_COLOR_ATTACHMENTS ? max : 0),
    getError: () => {
      const e = error;
      error = 0;
      return e;
    },
    framebufferTexture2D: (_target, attachment) => {
      const at = attachment as number;
      if (at >= COLOR_ATTACHMENT0 && at < COLOR_ATTACHMENT0 + 16) {
        if (at - COLOR_ATTACHMENT0 >= max) {
          if (error === 0) error = INVALID_ENUM;
          return;
        }
        attached.push(at - COLOR_ATTACHMENT0);
      }
    },
    createFramebuffer: () => ({}),
    createSampler: () => ({}),
    getExtension: () => null,
  };
  const gl = new Proxy(
    {},
    {
      get: (_t, key) => {
        if (typeof key !== 'string') return undefined;
        if (key in constants) return constants[key];
        if (key in methods) return methods[key];
        // Every other constant is a number nothing here reads, and every other call does nothing.
        return /^[A-Z0-9_]+$/.test(key) ? 0x1000 + key.length : () => undefined;
      },
    },
  ) as WebGL2RenderingContext;
  return { gl, attached };
}

describe('a WebGL2 pass and MAX_COLOR_ATTACHMENTS', () => {
  it('detaches only the attachments the context has, and leaves getError() clean', async () => {
    const { gl, attached } = fakeGl(4);
    const d = new GlDrawing(gl);
    expect(d.maxColorAttachments).toBe(4);
    await recordPass(d, {}, () => undefined)();
    expect(gl.getError()).toBe(0);
    expect(attached).toEqual([0, 1, 2, 3]);
  });

  it('the fake refuses an attachment past its limit (the instrument is not blind)', () => {
    const { gl } = fakeGl(4);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, COLOR_ATTACHMENT0 + 6, gl.TEXTURE_2D, null, 0);
    expect(gl.getError()).toBe(INVALID_ENUM);
    expect(gl.getError()).toBe(0);
  });
});
