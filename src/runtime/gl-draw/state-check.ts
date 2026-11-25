import type { PackEntry } from '../../core/manifest-types.js';
import type { RenderPlan } from '../program.js';
import { GL_BLEND_FACTOR, GL_BLEND_OPERATION, GL_TOPOLOGY } from '../../rhi/webgl2.js';

interface BlendComponent {
  readonly srcFactor?: string;
  readonly dstFactor?: string;
  readonly operation?: string;
}

export function checkState(plan: RenderPlan, vs: PackEntry, fs: PackEntry | undefined): void {
  const where = `The render pipeline of "${(fs ?? vs).name}"`;
  if (GL_TOPOLOGY[plan.primitive.topology] === undefined)
    throw new TypeError(
      `${where}: "${String(plan.primitive.topology)}" is not a topology; WebGPU's are ${Object.keys(GL_TOPOLOGY).join(', ')}.`,
    );
  const targets = plan.targets;
  const first = targets[0];
  for (const t of targets.slice(1))
    if (
      JSON.stringify(t.blend) !== JSON.stringify(first?.blend) ||
      (t.writeMask ?? 15) !== (first?.writeMask ?? 15)
    )
      throw new TypeError(
        `${where}: targets that blend or mask apart are not supported yet on the WebGL2 tier (Rule 11.11); give its targets one blend and one writeMask.`,
      );
  const blend = first?.blend as { color?: BlendComponent; alpha?: BlendComponent } | undefined;
  if (blend === undefined) return;
  for (const [f, d] of [
    [blend.color?.srcFactor, 'one'],
    [blend.alpha?.srcFactor, 'one'],
    [blend.color?.dstFactor, 'zero'],
    [blend.alpha?.dstFactor, 'zero'],
  ] as const)
    if (GL_BLEND_FACTOR[f ?? d] === undefined)
      throw new TypeError(`${where}: "${String(f)}" is not a blend factor.`);
  for (const o of [blend.color?.operation, blend.alpha?.operation])
    if (GL_BLEND_OPERATION[o ?? 'add'] === undefined)
      throw new TypeError(`${where}: "${String(o)}" is not a blend operation.`);
}
