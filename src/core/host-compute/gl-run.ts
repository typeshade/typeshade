import {
  boxed,
  isBuffer,
  packed,
  readInto,
  type Checked,
  type ComputeEntry,
} from '../host-entry.js';
import { runGlCompute, type GlComputeReport } from '../gl-compute.js';
import type { GlComputeProgram } from '../passes/gl-compute.js';
import { uploadImage } from '../gl-image.js';

export async function onGl(
  gl: WebGL2RenderingContext,
  e: ComputeEntry,
  program: GlComputeProgram,
  checked: Checked,
  wg: readonly [number, number, number],
): Promise<number> {
  const values = checked.values;
  const memory: Record<string, Uint32Array> = {};
  const uniforms: Record<string, unknown> = {};
  for (const b of e.bindings) {
    if (!isBuffer(b)) continue;
    if (b.space === 'uniform') uniforms[b.name] = values[b.name];
    else memory[b.name] = new Uint32Array(packed(b, values[b.name]));
  }
  const textures: Record<string, { texture: WebGLTexture }> = {};
  let report: GlComputeReport | undefined;
  try {
    for (const t of program.textures ?? []) {
      const img = checked.images.get(t.name)!;
      if (img.view !== undefined)
        throw new TypeError(
          `${e.name}(): binding "${t.name}" is a Texture on the WebGPU device, which the WebGL2 tier does not read yet (Rule 8.24); pass an image source for a call that may fall back.`,
        );
      const s = (t.sampler !== null ? checked.samplers.get(t.sampler) : undefined) ?? {
        filter: 'nearest',
        address: 'clamp',
      };
      const tex = gl.createTexture()!;
      textures[t.name] = { texture: tex };
      gl.bindTexture(gl.TEXTURE_2D, tex);
      uploadImage(gl, img.source, s);
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
    report = await runGlCompute(gl, program, { workgroups: wg, memory, uniforms, textures });
  } finally {
    for (const { texture } of Object.values(textures)) gl.deleteTexture(texture);
  }
  for (const b of e.bindings) {
    if (!isBuffer(b) || b.space !== 'storage' || !b.writes) continue;
    const dv = new DataView(memory[b.name]!.buffer);
    if (boxed(b))
      (values[b.name] as { [i: number]: number })[0] = readInto(
        dv,
        0,
        b.layout,
        undefined,
      ) as number;
    else readInto(dv, 0, b.layout, values[b.name]);
  }
  return report!.passes;
}
