import type { RenderPlan } from '../program.js';

const BIASED_FORMATS: readonly string[] = ['depth24plus', 'depth32float', 'depth24plus-stencil8'];

export function refuseBias(
  prefix: string,
  depth: NonNullable<RenderPlan['depth']>,
  clampExtension: boolean,
): void {
  const b = depth.bias;
  const biased = BIASED_FORMATS.includes(depth.format);
  if (b.constant !== 0 && !biased)
    throw new TypeError(
      `${prefix} sets depth.bias.constant on ${depth.format}; the WebGL2 tier takes a bias on depth24plus, depth32float and depth24plus-stencil8 only.`,
    );
  if (b.slopeScale !== 0 && !biased)
    throw new TypeError(
      `${prefix} sets depth.bias.slopeScale to ${b.slopeScale} on ${depth.format}; the WebGL2 tier takes a bias on depth24plus, depth32float and depth24plus-stencil8 only.`,
    );
  if (b.clamp !== 0 && !clampExtension)
    throw new TypeError(
      `${prefix} sets depth.bias.clamp to ${b.clamp}; a non-zero clamp is not supported yet on the WebGL2 tier without EXT_polygon_offset_clamp (Rule 11.11), and this context lacks it.`,
    );
}
