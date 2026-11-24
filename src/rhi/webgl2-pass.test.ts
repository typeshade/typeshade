import { describe, expect, it } from 'vitest';
import { FULL, at, colour, depth, recorded, setup } from './webgl2-pass-fixtures.js';

describe('the start of a render pass on WebGL2', () => {
  it('attaches each colour target to its index and detaches the indices up to the limit', () => {
    const fake = setup({ parameters: { MAX_COLOR_ATTACHMENTS: 4 } });
    const r = recorded(fake, (d) => ({ colorAttachments: [colour(d), colour(d)] }));
    const attach = r.begin.filter((c) => c.startsWith('framebufferTexture2D('));
    expect(attach.map((c) => c.replace(/texture\d+/, 'T'))).toEqual([
      'framebufferTexture2D(FRAMEBUFFER,COLOR_ATTACHMENT0,TEXTURE_2D,T,0)',
      'framebufferTexture2D(FRAMEBUFFER,COLOR_ATTACHMENT1,TEXTURE_2D,T,0)',
      'framebufferTexture2D(FRAMEBUFFER,COLOR_ATTACHMENT2,TEXTURE_2D,null,0)',
      'framebufferTexture2D(FRAMEBUFFER,COLOR_ATTACHMENT3,TEXTURE_2D,null,0)',
      'framebufferTexture2D(FRAMEBUFFER,DEPTH_STENCIL_ATTACHMENT,TEXTURE_2D,null,0)',
    ]);
    expect(r.begin).toContain('drawBuffers([COLOR_ATTACHMENT0,COLOR_ATTACHMENT1])');
  });

  it('names no attachment at or above the limit of the context', () => {
    const fake = setup({ parameters: { MAX_COLOR_ATTACHMENTS: 2 } });
    const r = recorded(fake, (d) => ({ colorAttachments: [colour(d)] }));
    const names = r.begin.filter((c) => c.includes('COLOR_ATTACHMENT'));
    expect(names.some((c) => c.includes('COLOR_ATTACHMENT2'))).toBe(false);
    expect(names.some((c) => c.includes('COLOR_ATTACHMENT1,TEXTURE_2D,null'))).toBe(true);
  });

  it('reads the limit once for the device', () => {
    const fake = setup();
    recorded(fake, (d) => ({ colorAttachments: [colour(d)] }));
    recorded(fake, (d) => ({ colorAttachments: [colour(d)] }));
    expect(fake.of('getParameter').filter((c) => c.includes('MAX_COLOR_ATTACHMENTS'))).toHaveLength(
      1,
    );
  });

  it('attaches depth alone to the depth point, and depth with stencil to the joint one', () => {
    const fake = setup();
    const alone = recorded(fake, (d) => ({
      colorAttachments: [colour(d)],
      depthStencilAttachment: depth(
        d,
        { depthLoadOp: 'load', depthStoreOp: 'store' },
        'depth32float',
      ),
    }));
    expect(
      alone.begin.some((c) =>
        c.startsWith('framebufferTexture2D(FRAMEBUFFER,DEPTH_ATTACHMENT,TEXTURE_2D,texture'),
      ),
    ).toBe(true);
    const both = recorded(fake, (d) => ({
      colorAttachments: [colour(d)],
      depthStencilAttachment: depth(d, { stencilLoadOp: 'load', stencilStoreOp: 'store' }),
    }));
    expect(
      both.begin.some((c) =>
        c.startsWith(
          'framebufferTexture2D(FRAMEBUFFER,DEPTH_STENCIL_ATTACHMENT,TEXTURE_2D,texture',
        ),
      ),
    ).toBe(true);
    const readOnly = recorded(fake, (d) => ({
      colorAttachments: [colour(d)],
      depthStencilAttachment: depth(d, { stencilReadOnly: true, depthReadOnly: true }),
    }));
    expect(
      readOnly.begin.some((c) =>
        c.startsWith(
          'framebufferTexture2D(FRAMEBUFFER,DEPTH_STENCIL_ATTACHMENT,TEXTURE_2D,texture',
        ),
      ),
    ).toBe(true);
  });

  it('draws into no colour buffer for a pass with depth alone, sized as the depth texture', () => {
    const fake = setup();
    const r = recorded(fake, (d) => ({
      colorAttachments: [],
      depthStencilAttachment: depth(
        d,
        { depthLoadOp: 'clear', depthStoreOp: 'store' },
        'depth32float',
      ),
    }));
    expect(r.begin).toContain('drawBuffers([NONE])');
    expect(r.begin).toContain('viewport(0,0,6,4)');
  });

  it('turns the scissor off before the clears, and a scissor of an earlier pass does not stay', () => {
    const fake = setup();
    recorded(
      fake,
      (d) => ({ colorAttachments: [colour(d)] }),
      (p) => p.setScissorRect(1, 1, 2, 2),
    );
    const r = recorded(fake, (d) => ({
      colorAttachments: [colour(d, 'rgba8unorm', { loadOp: 'clear', clearValue: [1, 0, 0, 1] })],
    }));
    expect(at(r.begin, 'disable(SCISSOR_TEST)')).toBeGreaterThan(-1);
    expect(at(r.begin, 'disable(SCISSOR_TEST)')).toBeLessThan(at(r.begin, 'clearBuffer'));
    const earlier = fake.calls.filter((c) => c.startsWith('enable(SCISSOR_TEST)'));
    expect(earlier).toHaveLength(1);
    const set = fake.calls.indexOf('scissor(1,1,2,2)');
    expect(fake.calls.indexOf('disable(SCISSOR_TEST)', set)).toBeGreaterThan(set);
  });

  it('sets the pass state of its start: the whole target, depth range 0 to 1, blend constant 0', () => {
    const fake = setup();
    const r = recorded(fake, (d) => ({ colorAttachments: [colour(d)] }));
    expect(r.begin).toEqual(
      expect.arrayContaining([
        'viewport(0,0,6,4)',
        'depthRange(0,1)',
        'blendColor(0,0,0,0)',
        'colorMask(true,true,true,true)',
        'depthMask(true)',
        `stencilMask(${FULL})`,
      ]),
    );
  });

  it('reads the host viewport, depth range and blend constant before it sets its own', () => {
    const fake = setup();
    const r = recorded(fake, (d) => ({ colorAttachments: [colour(d)] }));
    for (const name of ['VIEWPORT', 'DEPTH_RANGE', 'BLEND_COLOR']) {
      expect(at(r.begin, `getParameter(${name})`)).toBeGreaterThan(-1);
    }
    expect(at(r.begin, 'getParameter(BLEND_COLOR)')).toBeLessThan(at(r.begin, 'viewport('));
    expect(at(r.begin, 'getParameter(BLEND_COLOR)')).toBeLessThan(at(r.begin, 'blendColor('));
  });

  it('clears each colour target with the call of its kind, padding the value to four', () => {
    const fake = setup();
    const r = recorded(fake, (d) => ({
      colorAttachments: [
        colour(d, 'rgba8unorm', { loadOp: 'clear', clearValue: [0.5, 1] }),
        colour(d, 'r32uint', { loadOp: 'clear', clearValue: [7] }),
        colour(d, 'rg32sint', { loadOp: 'clear', clearValue: [-3, 2, 1, 0] }),
        colour(d, 'rgba8unorm', { loadOp: 'load', clearValue: [1, 1, 1, 1] }),
      ],
    }));
    const clears = r.begin.filter((c) => c.startsWith('clearBuffer'));
    expect(clears).toEqual([
      'clearBufferfv(COLOR,0,[0.5,1,0,0])',
      'clearBufferuiv(COLOR,1,[7,0,0,0])',
      'clearBufferiv(COLOR,2,[-3,2,1,0])',
    ]);
  });

  it('clears the depth, then the stencil, to the values it is given or to 1 and 0', () => {
    const fake = setup();
    const given = recorded(fake, (d) => ({
      colorAttachments: [colour(d)],
      depthStencilAttachment: depth(d, {
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
        depthClearValue: 0.5,
        stencilLoadOp: 'clear',
        stencilStoreOp: 'store',
        stencilClearValue: 9,
      }),
    }));
    expect(given.begin.filter((c) => c.startsWith('clearBuffer'))).toEqual([
      'clearBufferfv(DEPTH,0,[0.5])',
      'clearBufferiv(STENCIL,0,[9])',
    ]);
    const bare = recorded(fake, (d) => ({
      colorAttachments: [colour(d)],
      depthStencilAttachment: depth(d, {
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
        stencilLoadOp: 'clear',
        stencilStoreOp: 'store',
      }),
    }));
    expect(bare.begin.filter((c) => c.startsWith('clearBuffer'))).toEqual([
      'clearBufferfv(DEPTH,0,[1])',
      'clearBufferiv(STENCIL,0,[0])',
    ]);
  });

  it('never clears a read-only aspect, and clears the stencil apart from the depth', () => {
    const fake = setup();
    const readOnly = recorded(fake, (d) => ({
      colorAttachments: [colour(d)],
      depthStencilAttachment: depth(d, { depthReadOnly: true, stencilReadOnly: true }),
    }));
    expect(readOnly.begin.filter((c) => c.startsWith('clearBuffer'))).toEqual([]);
    const stencilOnly = recorded(fake, (d) => ({
      colorAttachments: [colour(d)],
      depthStencilAttachment: depth(d, {
        depthReadOnly: true,
        stencilLoadOp: 'clear',
        stencilStoreOp: 'store',
        stencilClearValue: 4,
      }),
    }));
    expect(stencilOnly.begin.filter((c) => c.startsWith('clearBuffer'))).toEqual([
      'clearBufferiv(STENCIL,0,[4])',
    ]);
    const depthOnly = recorded(fake, (d) => ({
      colorAttachments: [colour(d)],
      depthStencilAttachment: depth(d, {
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
        stencilReadOnly: true,
      }),
    }));
    expect(depthOnly.begin.filter((c) => c.startsWith('clearBuffer'))).toEqual([
      'clearBufferfv(DEPTH,0,[1])',
    ]);
  });

  it('clears no stencil of a depth format that has none', () => {
    const fake = setup();
    const r = recorded(fake, (d) => ({
      colorAttachments: [colour(d)],
      depthStencilAttachment: depth(
        d,
        { depthLoadOp: 'clear', depthStoreOp: 'store' },
        'depth32float',
      ),
    }));
    expect(r.begin.filter((c) => c.startsWith('clearBuffer'))).toEqual([
      'clearBufferfv(DEPTH,0,[1])',
    ]);
  });
});
