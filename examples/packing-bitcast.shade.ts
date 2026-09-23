"use typeshade";

/* @example
{
  "title": "Packing, bitcast and the constructors",
  "blurb": "The portable builtins WGSL has that this surface lacked (§44): the pack/unpack family round-tripped per channel, `bitcast` reading the exponent bits of a coordinate, `quantizeToF16` on a vector, the zero-value `vec2()` and the type-argument `vec3<u32>(...)`, an `array(...)` that infers its own element and count, and `all`/`any` on a plain bool. GLSL ES 3.00 has six of the pack ids natively under other names, neither 4x8 form and no `quantizeToF16`; the gate runs both.",
  "renderable": true
}
*/
// The portable builtins WGSL has that this surface lacked (§44, #150): the pack/unpack family,
// `bitcast`, `quantizeToF16`, the zero-value and type-argument vector constructors, an
// `array(...)` that infers its own type, and `all`/`any` on a plain bool.
//
// Every one of them is PORTABLE: the IR and both backends have spelled the eight pack/unpack
// ids and the two bitcast ids since the registry was written, and nothing on this surface could
// name them. GLSL ES 3.00 spells six of the pack ids natively under other names
// (`packHalf2x16`, `packUnorm2x16`, `packSnorm2x16` and their inverses) and has neither the 4x8
// pair (ES 3.10) nor `quantizeToF16` at all, so those three are hand-inlined; the compile gate
// runs both targets, so the two spellings have to agree about the picture.
//
// The colour is built by round-tripping through each packing, which is the only honest way to
// exercise them in a renderable example: a packed `u32` is not a colour, but unpacking it back
// is, and a wrong spelling on either target shows up as a wrong pixel rather than as nothing.

class VsOut {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}

@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  // `array(...)` with no type arguments: the element type and the count come from the
  // elements, as WGSL infers them.
  const xs = array(-1., 3., -1.);
  const ys = array(-1., -1., 3.);
  const i = i32(vi);
  const p: vec2 = vec2(xs[i], ys[i]);
  return { pos: vec4(p, 0., 1.), uv: p * 0.5 + vec2(0.5, 0.5) };
}

@fragment
export function fs(v: VsOut): vec4 {
  // The zero value, and a vector whose element the TYPE ARGUMENT names. `vec3<u32>(...)` used
  // to build a `vec3<f32>` with no diagnostic at all.
  const origin = vec2();
  const steps = vec3<u32>(1, 2, 3);

  // Two channels through the 8-bit round trip: unorm keeps [0, 1], snorm keeps [-1, 1], and
  // both put component 0 in the LOW byte. Each packed word is BOUND before it is unpacked,
  // rather than nested: GLSL ES 3.00 has neither 4x8 form, so the backend inlines the
  // arithmetic, and an inline that re-reads its argument four times re-reads a nested call
  // four times too. One `const` is the difference between a line and sixteen copies of one.
  //
  // Not named `unorm`/`snorm`: both are WGSL reserved words, and an author-written local is not
  // renamed on the WGSL side the way `half` below is on the GLSL side, so Tint would refuse the
  // module. Measured through the gate.
  const rgba8Bits: u32 = pack4x8unorm(vec4(v.uv, 0.25, 1.));
  const rgba8: vec4 = unpack4x8unorm(rgba8Bits);
  const signed8Bits: u32 = pack4x8snorm(vec4(v.uv * 2. - vec2(1., 1.), -0.5, 1.));
  const signed8: vec4 = unpack4x8snorm(signed8Bits);

  // …and through the 16-bit ones, where GLSL has the builtin under another name and the
  // nesting costs nothing.
  const half: vec2 = unpack2x16float(pack2x16float(v.uv));
  const u16: vec2 = unpack2x16unorm(pack2x16unorm(v.uv));
  const s16: vec2 = unpack2x16snorm(pack2x16snorm(v.uv - origin));

  // `bitcast` reinterprets the 32 bits rather than converting them: exponent bits of the
  // coordinate, masked down to something that reads as a gradient.
  const bits: u32 = bitcast<u32>(v.uv.x + 1.);
  const exponent: f32 = f32(extractBits(bits, 23, 8)) / 255.;
  const back: f32 = bitcast<f32>(bits);

  // `quantizeToF16` on a vector: the precision an f16 pipeline would give this colour. Bound
  // for the same reason — GLSL spells it as a half round trip, two components at a time.
  const grade: vec3 = vec3(half.x, u16.y, exponent);
  const coarse: vec3 = quantizeToF16(grade);

  // `all` and `any` on a plain bool, which WGSL defines to return the bool itself.
  const lit: bool = back > 1.5;
  const edge: f32 = select(0., 0.15, all(lit)) + select(0., 0.1, any(v.uv.x > 0.98));

  const banded: f32 = f32(steps.y) / 8.;
  const rgb: vec3 =
    coarse * 0.5 + vec3(rgba8.x, signed8.y * 0.5 + 0.5, s16.x * 0.5 + 0.5) * 0.4 + vec3(banded * 0.1);
  return vec4(clamp(rgb + vec3(edge), vec3(0.), vec3(1.)), rgba8.w);
}
