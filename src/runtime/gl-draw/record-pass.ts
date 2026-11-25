import { describe } from '../../core/host-entry.js';
import { depthStencilAttachmentOf, passOf } from '../program.js';
import type { PassTargets, RenderPass } from '../runtime.js';
import type { RhiColorAttachment, RhiTexture } from '../../rhi/rhi.js';
import type { GlDrawing } from './drawing.js';
import { GlTextureImpl } from './texture.js';
import { GlPass } from './pass.js';

export function recordPass(
  d: GlDrawing,
  targets: PassTargets,
  record: (pass: RenderPass) => void,
): () => Promise<void> {
  const rhi = d.rhi;
  const plan = passOf(targets, {
    isTexture: (t) => t instanceof GlTextureImpl,
    isCanvas: (t) => rhi.fromNative('canvas', t) !== undefined,
    formatOf: (t) => (t instanceof GlTextureImpl ? t.format : undefined),
  });
  const colour: { attachment: RhiColorAttachment; w: number; h: number }[] = plan.color.map(
    (c, i) => {
      const t = c.target;
      const common = { clearValue: c.clear, loadOp: c.load, storeOp: c.store } as const;
      if (t instanceof GlTextureImpl) {
        if (t.kind === 'depth')
          throw new TypeError(
            `pass(): colour target ${i} is a ${t.format} texture, which holds depth.`,
          );
        return {
          attachment: { view: rhi.createView(t.handle), ...common },
          w: t.width,
          h: t.height,
        };
      }
      const canvas = rhi.fromNative('canvas', t);
      if (canvas !== undefined) {
        const screen = rhi.currentTexture(canvas);
        return {
          attachment: { view: rhi.createView(screen), ...common },
          w: screen.width,
          h: screen.height,
        };
      }
      throw new TypeError(
        `pass(): a colour target on WebGL2 is a Texture of the runtime, or its context for the canvas; got ${describe(t)}.`,
      );
    },
  );
  const pd = plan.depth;
  let depth: { tex: RhiTexture; target: object; w: number; h: number } | undefined;
  if (pd !== undefined) {
    const t = pd.target;
    if (!(t instanceof GlTextureImpl) || t.kind !== 'depth')
      throw new TypeError(
        `pass(): the depth target on WebGL2 is a depth Texture of the runtime; got ${describe(t)}.`,
      );
    depth = { tex: t.handle, target: t, w: t.width, h: t.height };
  }
  const sizes = [...colour, ...(depth === undefined ? [] : [depth])];
  const w = sizes[0]?.w ?? 0;
  const h = sizes[0]?.h ?? 0;
  if (sizes.some((a) => a.w !== w || a.h !== h))
    throw new TypeError('pass(): every attachment of a pass has one size.');
  const pass = new GlPass({
    rhi,
    width: w,
    height: h,
    depthFormat: pd?.format,
    depthReadOnly: pd?.depth.readOnly ?? false,
    stencilReadOnly: pd?.stencil?.readOnly ?? false,
    depthTarget: depth?.target,
    depthTexture: depth?.tex,
  });
  record(pass);
  const steps = pass.steps;
  const colorAttachments = colour.map((c) => c.attachment);
  const depthStencilAttachment =
    pd === undefined || depth === undefined
      ? undefined
      : depthStencilAttachmentOf(rhi.createView(depth.tex), pd);
  return async () => {
    for (const step of steps)
      for (const state of step.residents)
        if (state.fresh === 'device' || state.host === undefined) await state.sync();
    const encoder = rhi.createCommandEncoder();
    const p = encoder.beginRenderPass({
      colorAttachments,
      ...(depthStencilAttachment !== undefined ? { depthStencilAttachment } : {}),
    });
    for (const step of steps) step.run(p);
    p.end();
    await rhi.submit([encoder]);
  };
}
