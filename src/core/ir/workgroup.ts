// The workgroup-shape helpers the front end and fn() share. Kept out of the `./nodes.js` barrel
// on purpose: the shape itself (`WorkgroupShape`, `workgroupShapeOf`) is public, and these two
// are how the compiler spells and normalizes it.

import type { WorkgroupShape } from './nodes.js'

/** The `@workgroup_size(...)` attribute for a workgroup shape, spelling only the extents WGSL
 *  needs: `[64, 1, 1]` is `@workgroup_size(64)`, `[8, 8, 1]` is `@workgroup_size(8, 8)`, and
 *  `[4, 1, 2]` keeps its `1`. A one-dimensional shape emits the bytes it always did. */
export const workgroupSizeAttr = (shape: WorkgroupShape): string => {
  const [x, y, z] = shape
  const extents = z !== 1 ? [x, y, z] : y !== 1 ? [x, y] : [x]
  return `@workgroup_size(${extents.join(', ')})`
}

/** Normalize one to three workgroup extents to a {@link WorkgroupShape}, a missing `y` or `z`
 *  being 1. */
export const toWorkgroupShape = (
  size: number | readonly [number, number?, number?],
): WorkgroupShape =>
  typeof size === 'number' ? [size, 1, 1] : [size[0], size[1] ?? 1, size[2] ?? 1]
