// The triangle rasterizer of the CPU backend (change 0120, item 5 and milestone M3).
//
// It takes the clip-space positions and the interstage values a vertex entry wrote for one
// triangle, and calls back once for each pixel the triangle covers, with the values the fragment
// entry reads there. It follows WebGPU where WebGPU specifies the result:
//
// - Clipping. A triangle is clipped against `0 <= z <= w` and `w > 0`. `x` and `y` are not clipped:
//   a pixel is covered only inside the viewport, the scissor rectangle and the target, which gives
//   the coverage clipping to `-w <= x, y <= w` gives.
// - The viewport. Normalized device coordinates map to framebuffer coordinates as WebGPU's
//   viewport does: row 0 at the top, `y` down, depth from `minDepth` to `maxDepth`.
// - Coverage. A pixel is covered when its centre is inside the triangle. A centre on an edge is
//   covered only when the edge is a top edge (horizontal, the triangle below it) or a left edge,
//   so two triangles that share an edge cover each centre on it once.
// - Facing. A triangle is front-facing when its winding in normalized device coordinates (`y` up)
//   is the pipeline's `frontFace`; WebGPU's default is counter-clockwise.
// - Interpolation, as WGSL's `@interpolate` says: `perspective` (the default) perspective-correct,
//   `linear` in screen space, and `flat` from the first vertex of the triangle, WebGPU's provoking
//   vertex. With no multisampling, `center`, `centroid` and `sample` all sample at the pixel's
//   centre. A vertex that clipping makes takes each value at the point of the edge it lies on:
//   `perspective` values in clip space, `linear` values in screen space.
// - The fragment's `position`: `x` and `y` the pixel's centre in framebuffer coordinates, `z` the
//   depth interpolated in screen space, and `w` the interpolated `1 / w` of the clip position.
//
// The rasterizer reads no shader and writes no pixel. `cpu.ts` runs the entries around it.

/** How a varying interpolates. */
export type Interpolation = 'perspective' | 'linear' | 'flat';

/** One interstage value: where its numbers sit in a vertex's `values`, and how it interpolates. */
export interface Varying {
  readonly offset: number;
  readonly width: number;
  readonly interpolation: Interpolation;
}

/** A vertex as the vertex entry wrote it: its clip-space position and its interstage numbers,
 *  each varying at its `offset`. */
export interface RasterVertex {
  readonly position: readonly [number, number, number, number];
  readonly values: readonly number[];
}

/** A rectangle in framebuffer pixels. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** What a draw's pass and pipeline set for the rasterizer. */
export interface RasterState {
  /** The target's size in pixels. */
  readonly width: number;
  readonly height: number;
  readonly viewport: Rect & { readonly minDepth: number; readonly maxDepth: number };
  readonly scissor: Rect;
  readonly cullMode: 'none' | 'front' | 'back';
  readonly frontFace: 'ccw' | 'cw';
}

/** A covered pixel, as the fragment entry reads it. */
export interface Fragment {
  /** The pixel's column and row, row 0 at the top. */
  readonly x: number;
  readonly y: number;
  /** WGSL's fragment `position`. */
  readonly position: [number, number, number, number];
  readonly frontFacing: boolean;
  /** The interpolated interstage numbers, each varying at its `offset`. */
  readonly values: number[];
}

/** A vertex during clipping: its clip position and its numbers. */
interface ClipVertex {
  readonly p: readonly [number, number, number, number];
  readonly v: readonly number[];
}

/** A clipping plane: the distance of a clip position from it, positive inside. `w > 0` is kept a
 *  hair away from 0, so no vertex clipping makes divides by zero. */
const PLANES: readonly ((p: readonly number[]) => number)[] = [
  (p) => p[2]!,
  (p) => p[3]! - p[2]!,
  (p) => p[3]! - 1e-7,
];

/** The point of the edge from `a` to `b` at clip parameter `t`. A `perspective` or `flat` number
 *  is taken at `t` in clip space, and a `linear` number at the screen-space parameter of the same
 *  point. */
function split(a: ClipVertex, b: ClipVertex, t: number, varyings: readonly Varying[]): ClipVertex {
  const p = a.p.map((x, i) => x + t * (b.p[i]! - x)) as [number, number, number, number];
  // The screen-space parameter of the point: where its x / w and y / w sit between a's and b's.
  const s = (t * b.p[3]) / p[3];
  const v = a.v.slice();
  for (const y of varyings) {
    const u = y.interpolation === 'linear' ? s : t;
    for (let i = y.offset; i < y.offset + y.width; i++) v[i] = a.v[i]! + u * (b.v[i]! - a.v[i]!);
  }
  return { p, v };
}

/** The polygon `poly` clipped against WebGPU's clip volume in depth and `w`, by
 *  Sutherland-Hodgman. */
function clip(poly: ClipVertex[], varyings: readonly Varying[]): ClipVertex[] {
  let out = poly;
  for (const plane of PLANES) {
    if (out.length === 0) break;
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const a = input[i]!;
      const b = input[(i + 1) % input.length]!;
      const da = plane(a.p);
      const db = plane(b.p);
      if (da >= 0) out.push(a);
      if (da >= 0 !== db >= 0) out.push(split(a, b, da / (da - db), varyings));
    }
  }
  return out;
}

/** A vertex mapped to framebuffer coordinates, with `1 / w`. */
interface ScreenVertex {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly rw: number;
  readonly v: readonly number[];
}

function toScreen(c: ClipVertex, state: RasterState): ScreenVertex {
  const [x, y, z, w] = c.p;
  const vp = state.viewport;
  return {
    x: vp.x + ((x / w + 1) / 2) * vp.width,
    y: vp.y + ((1 - y / w) / 2) * vp.height,
    z: vp.minDepth + (z / w) * (vp.maxDepth - vp.minDepth),
    rw: 1 / w,
    v: c.v,
  };
}

/** Twice the signed area of `a`, `b`, `c` in framebuffer coordinates (`y` down): negative for a
 *  triangle that is counter-clockwise in normalized device coordinates (`y` up). */
const area2 = (a: ScreenVertex, b: ScreenVertex, c: ScreenVertex): number =>
  (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);

/** The edge function of `a` to `b` at the point `(px, py)`. */
const edge = (a: ScreenVertex, b: ScreenVertex, px: number, py: number): number =>
  (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x);

/** Whether the edge from `a` to `b`, with `c` the triangle's third vertex, is a top edge (horizontal,
 *  the triangle below it) or a left edge (the triangle to its right), in framebuffer coordinates. */
function topLeft(a: ScreenVertex, b: ScreenVertex, c: ScreenVertex): boolean {
  if (a.y === b.y) return c.y > a.y;
  const [top, bottom] = a.y < b.y ? [a, b] : [b, a];
  // The cross product of the edge, pointing down, and the way to `c`: negative when `c` is to the
  // right of the edge.
  return (bottom.x - top.x) * (c.y - top.y) - (bottom.y - top.y) * (c.x - top.x) < 0;
}

/** The pixels a draw may cover: the viewport, the scissor and the target, intersected, as whole
 *  pixels whose centres lie inside. */
function coverable(state: RasterState): { x0: number; y0: number; x1: number; y1: number } {
  const vp = state.viewport;
  const sc = state.scissor;
  // A centre `c + 0.5` lies in `[lo, hi)` for the columns from `ceil(lo - 0.5)` to `ceil(hi - 0.5)`.
  const x0 = Math.max(0, sc.x, Math.ceil(vp.x - 0.5));
  const y0 = Math.max(0, sc.y, Math.ceil(vp.y - 0.5));
  const x1 = Math.min(state.width, sc.x + sc.width, Math.ceil(vp.x + vp.width - 0.5));
  const y1 = Math.min(state.height, sc.y + sc.height, Math.ceil(vp.y + vp.height - 0.5));
  return { x0, y0, x1, y1 };
}

/** One triangle, already clipped: each covered pixel, in rows from the top, to `shade`. `flat` is
 *  the provoking vertex's numbers. */
function fill(
  a: ScreenVertex,
  b: ScreenVertex,
  c: ScreenVertex,
  flat: readonly number[],
  frontFacing: boolean,
  varyings: readonly Varying[],
  state: RasterState,
  shade: (f: Fragment) => void,
): void {
  const area = area2(a, b, c);
  if (area === 0 || !Number.isFinite(area)) return;
  const sign = area > 0 ? 1 : -1;
  const tl = [topLeft(b, c, a), topLeft(c, a, b), topLeft(a, b, c)];
  const box = coverable(state);
  const x0 = Math.max(box.x0, Math.floor(Math.min(a.x, b.x, c.x) - 0.5));
  const x1 = Math.min(box.x1, Math.ceil(Math.max(a.x, b.x, c.x) + 0.5));
  const y0 = Math.max(box.y0, Math.floor(Math.min(a.y, b.y, c.y) - 0.5));
  const y1 = Math.min(box.y1, Math.ceil(Math.max(a.y, b.y, c.y) + 0.5));
  const n = a.v.length;
  for (let y = y0; y < y1; y++) {
    const py = y + 0.5;
    for (let x = x0; x < x1; x++) {
      const px = x + 0.5;
      const e0 = sign * edge(b, c, px, py);
      const e1 = sign * edge(c, a, px, py);
      const e2 = sign * edge(a, b, px, py);
      if (e0 < 0 || e1 < 0 || e2 < 0) continue;
      if ((e0 === 0 && !tl[0]) || (e1 === 0 && !tl[1]) || (e2 === 0 && !tl[2])) continue;
      const l0 = (sign * e0) / area;
      const l1 = (sign * e1) / area;
      const l2 = 1 - l0 - l1;
      const rw = l0 * a.rw + l1 * b.rw + l2 * c.rw;
      const p0 = (l0 * a.rw) / rw;
      const p1 = (l1 * b.rw) / rw;
      const p2 = 1 - p0 - p1;
      const values = new Array<number>(n);
      for (const v of varyings) {
        for (let i = v.offset; i < v.offset + v.width; i++) {
          values[i] =
            v.interpolation === 'flat'
              ? flat[i]!
              : v.interpolation === 'linear'
                ? l0 * a.v[i]! + l1 * b.v[i]! + l2 * c.v[i]!
                : p0 * a.v[i]! + p1 * b.v[i]! + p2 * c.v[i]!;
        }
      }
      shade({
        x,
        y,
        position: [px, py, l0 * a.z + l1 * b.z + l2 * c.z, rw],
        frontFacing,
        values,
      });
    }
  }
}

/**
 * Rasterize one triangle of a `triangle-list`: clip it, cull it by its facing, and call `shade`
 * for each pixel it covers, in rows from the top and columns from the left. A pixel the clipped
 * polygon's fan covers twice cannot occur: the fan's triangles share their edges, which the
 * top-left rule gives to one of them.
 */
export function rasterizeTriangle(
  v0: RasterVertex,
  v1: RasterVertex,
  v2: RasterVertex,
  varyings: readonly Varying[],
  state: RasterState,
  shade: (f: Fragment) => void,
): void {
  const poly = clip(
    [v0, v1, v2].map((v) => ({ p: v.position, v: v.values })),
    varyings,
  );
  if (poly.length < 3) return;
  const screen = poly.map((c) => toScreen(c, state));
  // The facing of the whole polygon: clipping keeps the winding, and its first triangle with an
  // area gives it.
  let area = 0;
  for (let i = 1; i + 1 < screen.length && area === 0; i++)
    area = area2(screen[0]!, screen[i]!, screen[i + 1]!);
  if (area === 0 || !Number.isFinite(area)) return;
  const ccw = area < 0;
  const frontFacing = ccw === (state.frontFace === 'ccw');
  if (state.cullMode === 'back' && !frontFacing) return;
  if (state.cullMode === 'front' && frontFacing) return;
  for (let i = 1; i + 1 < screen.length; i++)
    fill(screen[0]!, screen[i]!, screen[i + 1]!, v0.values, frontFacing, varyings, state, shade);
}
