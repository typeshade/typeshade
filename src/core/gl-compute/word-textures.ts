import type { GlComputeLayout } from '../passes/gl-compute.js';

export const BATCH_LAYERS = 64;

export const MAX_ROOT_WORDS = 1 << 28;

export function shape(
  count: number,
  { width, layerRows }: GlComputeLayout,
): { h: number; layers: number } {
  const rows = Math.max(1, Math.ceil(count / width));
  const layers = Math.ceil(rows / layerRows);
  return { h: layers > 1 ? layerRows : rows, layers };
}

export interface Layered {
  readonly tex: WebGLTexture;
  readonly h: number;
  readonly layers: number;
}

export function wordTexture(
  gl: WebGL2RenderingContext,
  words: Uint32Array,
  layout: GlComputeLayout,
  what: string,
  createTexture: () => WebGLTexture,
): Layered {
  const { h, layers } = shape(words.length, layout);
  const most = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number;
  if (layers > most)
    throw new Error(
      `typeshade/webgl2: ${what} needs ${String(layers)} layers, more than this context's ${String(most)}`,
    );
  const data = new Uint32Array(layout.width * h * layers);
  data.set(words);
  const tex = createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
  gl.texImage3D(
    gl.TEXTURE_2D_ARRAY,
    0,
    gl.R32UI,
    layout.width,
    h,
    layers,
    0,
    gl.RED_INTEGER,
    gl.UNSIGNED_INT,
    data,
  );
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  return { tex, h, layers };
}
