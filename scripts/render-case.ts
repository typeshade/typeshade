// ═══ The compile gate's render case, the program tier's other half (issue #392, Rule 11.11) ═══
//
// The program tier dispatches every compute entry of the examples from its manifest
// (`scripts/entry-calls-page.ts`). This file is what makes it draw: the frames a host writes on
// `typeshade/runtime`, the ones surface §69 shows (a sky drawn behind everything and an indexed
// mesh with depth, in one pass), each held to a picture computed here in plain JavaScript.
//
// Both halves of the gate import it: Node compiles `SOURCES` into manifests
// (`scripts/entry-calls.ts`) and holds the readbacks to `reference()`
// (`scripts/compile-gate.ts`); the page draws the scene. It uses no Node API.
//
// The target is 16 x 16 and every shape lies on its pixel grid, so coverage is exact: no pixel
// centre is on an edge (the slanted edges were chosen so none is), and a frame is compared
// pixel for pixel, not within a tolerance of coverage.
//
// `src/render-case.test.ts` holds what needs no device: the pictures, the comparison, and both
// halves' reading of the three programs.

import type { Pack } from '../src/runtime.js';

export const SIZE = 16;

/** The three programs of the case, as an author writes them. */
export const SOURCES = {
  // A full-screen triangle at a depth the uniform gives, so a pipeline that did not honour
  // `write: false` would leave it in the depth buffer and hide the scene.
  sky: `"use typeshade";

class Sky {
  color: vec4;
  z: f32;
}

declare const sky: uniform<Sky>;

@vertex
export function vs(@builtin("vertex_index") vi: u32): vec4 {
  const xs: array<f32, 3> = [-1., 3., -1.];
  const ys: array<f32, 3> = [-1., -1., 3.];
  const i = i32(vi);
  return vec4(xs[i], ys[i], sky.z, 1.);
}

@fragment
export function fs(@builtin("position") p: vec4): vec4 {
  return sky.color;
}
`,
  // Positions in a vertex buffer (clip space, z included); the colour is a per-draw uniform.
  mesh: `"use typeshade";

class Tint {
  color: vec4;
}

declare const tint: uniform<Tint>;

class VsIn {
  @location(0) position: vec3;
}

@vertex
export function vs(v: VsIn): vec4 {
  return vec4(v.position, 1.);
}

@fragment
export function fs(@builtin("position") p: vec4): vec4 {
  return tint.color;
}
`,
  // Vertex pulling: no vertex input; each position is read from a storage buffer by
  // vertex_index, which in an indexed draw is the index value.
  pulled: `"use typeshade";

class Tint {
  color: vec4;
}

declare const verts: storage<array<vec4>>;
declare const tint: uniform<Tint>;

@vertex
export function vs(@builtin("vertex_index") vi: u32): vec4 {
  return verts[vi];
}

@fragment
export function fs(@builtin("position") p: vec4): vec4 {
  return tint.color;
}
`,
} as const;

/** The case's programs as the runtime loads them: each source's manifest. */
export type Programs = Record<keyof typeof SOURCES, Pack>;

/** A rectangle `[x0, y0, x1, y1]` or a triangle of pixel corners, at clip depth `z`, drawn in
 *  `tint`. */
export type Shape =
  | { readonly rect: readonly [number, number, number, number] }
  | { readonly tri: readonly [readonly number[], readonly number[], readonly number[]] };
export interface Item {
  readonly shape: Shape;
  readonly z: number;
  readonly tint: readonly [number, number, number, number];
}

/** Pixel coordinates (x right, y down) to clip space. */
const ndc = (px: number, py: number): [number, number] => [px / 8 - 1, 1 - py / 8];

export const SKY = { color: [0.2, 0.4, 0.8, 1] as const, z: 0.9 };
// The `passes` frame: a reversed projection, depth cleared to 0 and compared `greater`, the sky
// behind it.
export const NEAR: Item = { shape: { rect: [7, 3, 14, 10] }, z: 0.8, tint: [0, 1, 0, 1] };
export const FAR: Item = { shape: { rect: [2, 5, 10, 13] }, z: 0.4, tint: [1, 0, 0, 1] };
export const MID: Item = {
  shape: {
    tri: [
      [4, 2],
      [10, 2],
      [4, 7],
    ],
  },
  z: 0.6,
  tint: [0, 0, 1, 1],
};
// The `pulled` frame: vertex pulling.
export const Q: Item = { shape: { rect: [3, 4, 12, 12] }, z: 0.5, tint: [1, 1, 0, 1] };
export const T: Item = {
  shape: {
    tri: [
      [6, 2],
      [13, 2],
      [13, 8],
    ],
  },
  z: 0.7,
  tint: [0, 1, 1, 1],
};

const corners = ({ shape }: Item): [number, number][] =>
  'rect' in shape
    ? [
        [shape.rect[0], shape.rect[1]],
        [shape.rect[2], shape.rect[1]],
        [shape.rect[2], shape.rect[3]],
        [shape.rect[0], shape.rect[3]],
      ]
    : shape.tri.map((c) => [c[0]!, c[1]!]);

// The two functions below name no return type: from TypeScript 5.7 a bare `Float32Array` is
// `Float32Array<ArrayBufferLike>`, which `GPUQueue.writeBuffer` does not take, and the type the
// constructor gives it does.

/** An item's vertices as `x, y, z` triples: a vertex buffer. */
export const vertices = (item: Item) =>
  new Float32Array(corners(item).flatMap(([x, y]) => [...ndc(x, y), item.z]));
/** The same, as `vec4`s with w = 1: a storage buffer. */
export const positions = (item: Item) =>
  new Float32Array(corners(item).flatMap(([x, y]) => [...ndc(x, y), item.z, 1]));

/** Whether the pixel centre (cx, cy), in pixel units, is inside the shape. */
function covers(shape: Shape, cx: number, cy: number): boolean {
  if ('rect' in shape) {
    const [x0, y0, x1, y1] = shape.rect;
    return cx >= x0 && cx < x1 && cy >= y0 && cy < y1;
  }
  const [a, b, c] = shape.tri as readonly [number[], number[], number[]];
  const edge = (p: number[], q: number[]): number =>
    (q[0]! - p[0]!) * (cy - p[1]!) - (q[1]! - p[1]!) * (cx - p[0]!);
  const s = [edge(a, b), edge(b, c), edge(c, a)];
  return s.every((v) => v > 0) || s.every((v) => v < 0);
}

/** What a target holds after `draws`, in order, over a colour cleared to `clear` and a depth
 *  cleared to `depthClear`: a depth test of `greater`, or `always` for a draw that says so, and
 *  the depth written unless the draw says not. */
export function reference(
  clear: readonly number[],
  depthClear: number,
  draws: readonly (Item & { readonly compare?: 'always'; readonly write?: false })[],
): { color: number[]; depth: number[] } {
  const color = Array.from({ length: SIZE * SIZE * 4 }, (_, i) => Math.round(clear[i % 4]! * 255));
  const depth = new Array<number>(SIZE * SIZE).fill(depthClear);
  for (const d of draws) {
    const z = Math.fround(d.z);
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        if (!covers(d.shape, x + 0.5, y + 0.5)) continue;
        const i = y * SIZE + x;
        if (d.compare !== 'always' && !(z > depth[i]!)) continue;
        d.tint.forEach((v, k) => (color[i * 4 + k] = Math.round(v * 255)));
        if (d.write !== false) depth[i] = z;
      }
  }
  return { color, depth };
}

const SKY_ITEM = {
  shape: { rect: [0, 0, SIZE, SIZE] },
  z: SKY.z,
  tint: SKY.color,
  compare: 'always',
  write: false,
} as const;

/** The two frames and what each must hold: the colour it clears to, its draws in order, the fewest
 *  distinct colours it shows (a floor, so a blank frame cannot pass) and a line saying what it
 *  is. `passes`: pass 1 draws the sky, the near and the far rectangle; pass 2 loads its colour
 *  and depth and draws the middle triangle. `pulled`: the triangle, then the rectangle, both
 *  pulled from one storage buffer. */
export const FRAMES = {
  passes: {
    clear: [1, 0, 1, 1],
    draws: [SKY_ITEM, NEAR, FAR, MID],
    colours: 4,
    what: 'a sky pass and two indexed draws in one pass, reversed depth, then a pass that loads colour and depth',
  },
  pulled: {
    clear: [0, 0, 0, 1],
    draws: [T, Q],
    colours: 3,
    what: 'vertex pulling from a storage buffer, two indexed draws',
  },
} as const;

export type FrameName = keyof typeof FRAMES;

/** The picture a frame must hold: its colour texels as bytes, RGBA, and its depth. */
export const expectedFrame = (name: FrameName): { color: number[]; depth: number[] } =>
  reference(FRAMES[name].clear, 0, FRAMES[name].draws);

/** What a page returns for one frame: its colour texels, RGBA, and its depth, or why it failed. */
export type Readback =
  | { readonly color: readonly number[]; readonly depth: readonly number[] }
  | { readonly error: string };

/** How a readback differs from a picture: the pixels whose colour differs by more than one 8-bit
 *  step, and the ones whose depth differs by more than 1e-6. A value that is not a number differs
 *  in its pixel, and a readback of another size in every pixel. */
export function differences(
  got: { color: readonly number[]; depth: readonly number[] },
  want: { color: readonly number[]; depth: readonly number[] },
): { color: number; depth: number } {
  if (got.color.length !== want.color.length || got.depth.length !== want.depth.length)
    return { color: SIZE * SIZE, depth: SIZE * SIZE };
  let color = 0;
  let depth = 0;
  for (let i = 0; i < SIZE * SIZE; i++) {
    if ([0, 1, 2, 3].some((k) => !(Math.abs(got.color[i * 4 + k]! - want.color[i * 4 + k]!) <= 1)))
      color++;
    if (!(Math.abs(got.depth[i]! - want.depth[i]!) <= 1e-6)) depth++;
  }
  return { color, depth };
}

/** How many distinct colours a colour readback holds. */
export function colours(color: readonly number[]): number {
  const seen = new Set<string>();
  for (let i = 0; i < SIZE * SIZE; i++) seen.add(color.slice(i * 4, i * 4 + 4).join(','));
  return seen.size;
}
