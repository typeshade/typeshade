"use typeshade"

// The WGSL-only textures (§36). A colour ramp is a 1D texture, one number in and a texel out; N
// environment maps in one binding are a cube ARRAY, looked up by a direction and a layer; and
// `textureGather` reads the four texels a linear filter would blend, one channel each, in any
// stage, which is what a hand-written percentage-closer filter is made of.
//
// GLSL ES 3.00 has none of the three, measured on a WebGL2 driver: `sampler1D` is a reserved
// word, `samplerCubeArray` needs an extension the driver refuses, and `textureGather` arrived in
// ES 3.10. Each is therefore a capability the module derives from its own shape (`texture1d`,
// `textureCubeArray`, `textureGather`), with a WGSL row and no GLSL row: this example runs on the
// Tint half of the gate alone, and `reflect()` tells the host which of the three it needs.
//
// The argument order is the spec's (§17.7.2, §17.7.3): the component comes FIRST on a colour
// texture and is absent on a depth one, the layer follows the coordinate on an array, and the
// reference follows the layer on the compare form. The component must be a whole number from 0
// to 3 written in the call, as WGSL requires a constant there.

declare const ramp: texture_1d<f32>
declare const envs: texture_cube_array<f32>
declare const albedo: texture_2d<f32>
declare const smp: sampler
declare const shadow: texture_depth_2d
declare const pointShadows: texture_depth_cube_array
declare const shadowSmp: sampler_comparison

@vertex
export function vs(@builtin("vertex_index") vi: u32): vec4 {
  const xs: array<f32, 3> = [-1., 3., -1.]
  const ys: array<f32, 3> = [-1., -1., 3.]
  const i = i32(vi)
  return vec4(xs[i], ys[i], 0., 1.)
}

@fragment
export function fs(@builtin("position") p: vec4): vec4 {
  const uv: vec2 = fract(p.xy * 0.004)
  const dir: vec3 = normalize(vec3(uv * 2. - 1., 1.))

  // The ramp: a transfer function indexed by one number. Its size is one wide, a u32.
  const heat = textureSample(ramp, smp, uv.x)
  const steps = f32(textureDimensions(ramp))

  // Two environment maps in one binding; the layer picks which, the direction where.
  const layer = i32(floor(uv.y * f32(textureNumLayers(envs))))
  const sky = textureSample(envs, smp, dir, layer)
  const dull = textureSampleLevel(envs, smp, dir, layer, 3.)

  // A gather: the red channel of the four texels a bilinear tap would blend, so the shader can
  // weight them itself. `x` is (umin, vmax), `w` is (umin, vmin).
  const reds = textureGather(0, albedo, smp, uv)
  const edge = abs(reds.x - reds.z) + abs(reds.y - reds.w)

  // Percentage-closer filtering by hand: four comparisons at once, then a weighted mean.
  const passes = textureGatherCompare(shadow, shadowSmp, uv, 0.5)
  const lit = dot(passes, vec4(0.25))

  // The point light's shadow cube, one per light, compared by direction with the distance as
  // the reference.
  const toLight: vec3 = vec3(uv - 0.5, 0.5)
  const litPoint = textureSampleCompare(pointShadows, shadowSmp, normalize(toLight), layer, length(toLight))

  // Annotated, as every vector local built from arithmetic is in this corpus: the editor's
  // type of `a * b` is a number, and the annotation is what keeps the next line's call typed.
  const shade: vec3 = mix(sky.rgb, dull.rgb, 0.5) * (0.4 + 0.6 * lit * litPoint) + heat.rgb * edge
  return vec4(shade * clamp(steps / 256., 0.5, 1.), 1.)
}
