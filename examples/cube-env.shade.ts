"use typeshade";

/* @example
{
  "title": "Cube and 3D textures, bias and gradients",
  "blurb": "An environment map as a `texture_cube<f32>` looked up by direction, a colour-grading table as a `texture_3d<f32>` the shaded colour indexes, `textureSampleBias` and `textureSampleGrad`, and a point light’s shadow as a `texture_depth_cube` compared by the direction from the light (§35). All core in both targets, so both halves of the gate run it; the compiler checks each coordinate’s width against the texture’s dim and says so before either target refuses the generated code. Measured on Tint and on a WebGL2 driver: a bias is fragment-only on both, gradients are legal in any stage, and level 0 on a depth cube is `textureGrad` with zero gradients.",
  "renderable": true
}
*/

// Cube and 3D textures, bias and gradient sampling (§35). An environment map is a CUBE
// texture, six faces looked up by a direction rather than a coordinate; a colour-grading table
// is a 3D texture, a volume the shaded colour itself indexes. Both are core in both targets, so
// this example runs on both halves of the gate, and the read ids are the ones a 2D texture
// already has: the coordinate's width rides on the type, and the compiler checks it against
// the texture's dim before either target would refuse the generated code.
//
// Two sampling forms join them. `textureSampleBias` shifts the implicit level of detail by a
// bias and, like `textureSample`, is fragment-only on both targets (measured on Tint and on a
// WebGL2 driver, which each refuse it elsewhere). `textureSampleGrad` takes the gradients
// explicitly, of the coordinate's width, and is legal in any stage.
//
// A point light's shadow map is a DEPTH cube, compared by the direction from the light with
// the distance along it as the reference. On GLSL the reference folds into a `vec4` after the
// direction, and level 0 is `textureGrad` with zero gradients, since GLSL ES 3.00 has no
// `textureLod` for a `samplerCubeShadow` — the same gap the 2D array shadow has (§34).

declare const env: texture_cube<f32>;
declare const lut: texture_3d<f32>;
declare const albedo: texture_2d<f32>;
declare const smp: sampler;
declare const pointShadow: texture_depth_cube;
declare const shadowSmp: sampler_comparison;

@vertex
export function vs(@builtin("vertex_index") vi: u32): vec4 {
  const xs: array<f32, 3> = [-1., 3., -1.];
  const ys: array<f32, 3> = [-1., -1., 3.];
  const i = i32(vi);
  return vec4(xs[i], ys[i], 0., 1.);
}

@fragment
export function fs(@builtin("position") p: vec4): vec4 {
  const uv: vec2 = fract(p.xy * 0.004);
  // A view direction from the pixel: the environment is looked up by DIRECTION, not by uv.
  const dir: vec3 = normalize(vec3(uv * 2. - 1., 1.));
  const sky = textureSample(env, smp, dir);
  // The same direction, blurrier: a positive bias pushes the level of detail coarser.
  const glossy = textureSampleBias(env, smp, dir, 2.);
  // Colour grading: the shaded colour IS the coordinate into the 3D lookup table.
  const graded = textureSampleLevel(lut, smp, sky.rgb, 0.);
  // Explicit gradients: what a fragment stage could take itself, written out so a vertex or a
  // compute stage could make the same read.
  const detail = textureSampleGrad(albedo, smp, uv, vec2(0.004, 0.), vec2(0., 0.004));
  // A point light's shadow: the cube is looked up by the direction from the light, and the
  // reference is the distance along it.
  const toLight: vec3 = vec3(uv - 0.5, 0.5);
  const lit = textureSampleCompare(pointShadow, shadowSmp, normalize(toLight), length(toLight));
  // A 3D texture's size is three wide; its depth is the number of slices in the table.
  const size = textureDimensions(lut);
  const fade = clamp(f32(size.z) / 64., 0., 1.);
  // One texel of the table, fetched by integer coordinate; a cube has no such read.
  const voxel = textureLoad(lut, vec3i(0, 0, 0), 0);
  const shade = mix(graded.rgb, glossy.rgb, 0.25) * (lit * detail.r) * fade;
  return vec4(shade + voxel.rgb * 0.05, 1.);
}
