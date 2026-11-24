import { describe, expect, it } from 'vitest';
import type { RhiColorAttachment } from './rhi.js';
import { FULL, at, colour, depth, recorded, setup } from './webgl2-pass-fixtures.js';

describe('the end of a render pass on WebGL2', () => {
  it('makes the masks full and the scissor off, then gives the host state back', () => {
    const fake = setup({
      parameters: {
        VIEWPORT: new Int32Array([1, 2, 30, 40]),
        DEPTH_RANGE: new Float32Array([0.25, 0.5]),
        BLEND_COLOR: new Float32Array([0.25, 0.5, 0.75, 1]),
      },
    });
    const r = recorded(
      fake,
      (d) => ({ colorAttachments: [colour(d)] }),
      (p) => {
        p.setViewport(0, 0, 3, 3, 0.1, 0.9);
        p.setScissorRect(0, 0, 1, 1);
        p.setBlendConstant([1, 1, 1, 1]);
      },
    );
    expect(r.end).toEqual([
      'useProgram(null)',
      'disable(SCISSOR_TEST)',
      'colorMask(true,true,true,true)',
      'depthMask(true)',
      `stencilMask(${FULL})`,
      'viewport(1,2,30,40)',
      'depthRange(0.25,0.5)',
      'blendColor(0.25,0.5,0.75,1)',
      'bindFramebuffer(FRAMEBUFFER,null)',
    ]);
  });

  it('sets the viewport, the depth range, the scissor and the blend constant when it is told', () => {
    const fake = setup();
    const r = recorded(
      fake,
      (d) => ({ colorAttachments: [colour(d)] }),
      (p) => {
        p.setViewport(1, 2, 3, 4, 0.25, 0.75);
        p.setScissorRect(5, 6, 7, 8);
        p.setBlendConstant([0.25, 0.5, 0.75, 1]);
      },
    );
    expect(r.all).toEqual(
      expect.arrayContaining([
        'viewport(1,2,3,4)',
        'depthRange(0.25,0.75)',
        'enable(SCISSOR_TEST)',
        'scissor(5,6,7,8)',
        'blendColor(0.25,0.5,0.75,1)',
      ]),
    );
  });

  it('clears a discarded attachment to 0 by the clear of its kind: colour by index, depth, stencil', () => {
    const fake = setup();
    const r = recorded(fake, (d) => ({
      colorAttachments: [
        colour(d, 'rgba8unorm', { storeOp: 'discard' }),
        colour(d, 'r32uint', { storeOp: 'discard' }),
        colour(d, 'r32sint', { storeOp: 'discard' }),
        colour(d, 'rgba8unorm', { storeOp: 'store' }),
      ],
      depthStencilAttachment: depth(d, {
        depthLoadOp: 'load',
        depthStoreOp: 'discard',
        stencilLoadOp: 'load',
        stencilStoreOp: 'discard',
      }),
    }));
    expect(r.end.filter((c) => c.startsWith('clearBuffer'))).toEqual([
      'clearBufferfv(COLOR,0,[0,0,0,0])',
      'clearBufferuiv(COLOR,1,[0,0,0,0])',
      'clearBufferiv(COLOR,2,[0,0,0,0])',
      'clearBufferfv(DEPTH,0,[0])',
      'clearBufferiv(STENCIL,0,[0])',
    ]);
    expect(at(r.end, 'colorMask(')).toBeLessThan(at(r.end, 'clearBuffer'));
    expect(at(r.end, 'stencilMask(')).toBeLessThan(at(r.end, 'clearBuffer'));
  });

  it('makes no invalidation call and clears nothing for a stored attachment', () => {
    const fake = setup();
    const r = recorded(fake, (d) => ({
      colorAttachments: [colour(d, 'rgba8unorm', { storeOp: 'discard' })],
      depthStencilAttachment: depth(d, { depthStoreOp: 'discard', depthLoadOp: 'load' }),
    }));
    expect(fake.calls.some((c) => /invalidate/i.test(c))).toBe(false);
    const stored = recorded(fake, (d) => ({
      colorAttachments: [colour(d)],
      depthStencilAttachment: depth(d, { depthStoreOp: 'store', depthLoadOp: 'load' }),
    }));
    expect(stored.end.filter((c) => c.startsWith('clearBuffer'))).toEqual([]);
    expect(r.end.filter((c) => c.startsWith('clearBuffer'))).toHaveLength(2);
  });

  it('does not clear the stencil of a depth-only discard', () => {
    const fake = setup();
    const r = recorded(fake, (d) => ({
      colorAttachments: [colour(d)],
      depthStencilAttachment: depth(
        d,
        { depthStoreOp: 'discard', depthLoadOp: 'load' },
        'depth32float',
      ),
    }));
    expect(r.end.filter((c) => c.startsWith('clearBuffer'))).toEqual([
      'clearBufferfv(DEPTH,0,[0])',
    ]);
  });
});

describe('a pass into the canvas on WebGL2', () => {
  const canvasPass = (fake: ReturnType<typeof setup>, over: Partial<RhiColorAttachment>) => {
    const canvas = fake.device.fromNative('canvas', fake.gl)!;
    return recorded(fake, (d) => ({
      colorAttachments: [
        colour(d),
        {
          view: d.createView(d.currentTexture(canvas)),
          loadOp: 'load',
          storeOp: 'store',
          clearValue: [0, 0, 0, 0],
          ...over,
        },
      ],
    }));
  };

  it('draws into a texture of the drawing buffer size, and copies it to the screen turned over', () => {
    const fake = setup({ size: [10, 7] });
    const r = canvasPass(fake, { loadOp: 'clear' });
    expect(fake.calls).toContain('texStorage2D(TEXTURE_2D,1,RGBA8,10,7)');
    expect(r.begin).toContain('viewport(0,0,6,4)');
    const blit = 'blitFramebuffer(0,0,10,7,0,7,10,0,COLOR_BUFFER_BIT,NEAREST)';
    expect(r.end.filter((c) => c.startsWith('blitFramebuffer('))).toEqual([blit]);
    expect(r.end).toEqual(
      expect.arrayContaining([
        'bindFramebuffer(DRAW_FRAMEBUFFER,null)',
        'readBuffer(COLOR_ATTACHMENT1)',
      ]),
    );
    expect(at(r.end, 'blitFramebuffer(')).toBeGreaterThan(at(r.end, 'clearBuffer'));
    expect(at(r.end, 'blitFramebuffer(')).toBeLessThan(at(r.end, 'viewport('));
  });

  it('starts from what the screen shows, turned over, when it loads the canvas', () => {
    const fake = setup({ size: [10, 7] });
    const r = canvasPass(fake, { loadOp: 'load' });
    const blit = 'blitFramebuffer(0,0,10,7,0,7,10,0,COLOR_BUFFER_BIT,NEAREST)';
    expect(r.begin.filter((c) => c.startsWith('blitFramebuffer('))).toEqual([blit]);
    expect(r.begin).toEqual(
      expect.arrayContaining([
        'bindFramebuffer(READ_FRAMEBUFFER,null)',
        'readBuffer(BACK)',
        'drawBuffers([NONE,COLOR_ATTACHMENT1])',
      ]),
    );
    expect(at(r.begin, 'disable(SCISSOR_TEST)')).toBeLessThan(at(r.begin, 'blitFramebuffer('));
  });

  it('copies nothing in when it clears the canvas, and nothing out for a pass off the canvas', () => {
    const fake = setup();
    const r = canvasPass(fake, { loadOp: 'clear' });
    expect(r.begin.filter((c) => c.startsWith('blitFramebuffer('))).toEqual([]);
    const plain = recorded(fake, (d) => ({ colorAttachments: [colour(d)] }));
    expect(plain.all.filter((c) => c.startsWith('blitFramebuffer('))).toEqual([]);
  });

  it('keeps the texture of the canvas while the size stays, and makes another when it changes', () => {
    const fake = setup({ size: [10, 7] });
    canvasPass(fake, { loadOp: 'clear' });
    canvasPass(fake, { loadOp: 'clear' });
    const made = (): string[] =>
      fake.calls.filter((c) => c.startsWith('texStorage2D(TEXTURE_2D,1,RGBA8,'));
    const before = made().filter((c) => c.endsWith(',10,7)'));
    expect(before).toHaveLength(1);
    fake.resize(12, 9);
    const deletes = fake.of('deleteTexture').length;
    canvasPass(fake, { loadOp: 'clear' });
    expect(made().filter((c) => c.endsWith(',12,9)'))).toHaveLength(1);
    expect(fake.of('deleteTexture').length).toBe(deletes + 1);
    expect(fake.calls).toContain('blitFramebuffer(0,0,12,9,0,9,12,0,COLOR_BUFFER_BIT,NEAREST)');
  });

  it('gives a canvas texture the size of the drawing buffer at the time', () => {
    const fake = setup({ size: [10, 7] });
    const canvas = fake.device.fromNative('canvas', fake.gl)!;
    const t = fake.device.currentTexture(canvas) as unknown as { width: number; height: number };
    expect([t.width, t.height]).toEqual([10, 7]);
    fake.resize(3, 2);
    const u = fake.device.currentTexture(canvas) as unknown as { width: number; height: number };
    expect([u.width, u.height]).toEqual([3, 2]);
  });
});
