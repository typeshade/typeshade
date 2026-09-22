struct Frame {
  m: mat4x4<f32>,
}

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@group(0) @binding(0) var<uniform> frame: Frame;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  let xs = array<f32, 3>(-1.0, 3.0, -1.0);
  let ys = array<f32, 3>(-1.0, -1.0, 3.0);
  let i = i32(vi);
  let p = vec2<f32>(xs[i], ys[i]);
  return VsOut(vec4<f32>(p, 0.0, 1.0), ((p * 0.5) + vec2<f32>(0.5, 0.5)));
}

@fragment
fn fs(v: VsOut) -> @location(0) vec4<f32> {
  let c = (v.uv - vec2<f32>(0.5, 0.5));
  let n = normalize(vec3<f32>(c.x, c.y, 0.6));
  let toLight = normalize(vec3<f32>(-0.4, 0.5, 0.75));
  let fromLight = normalize(vec3<f32>(0.4, -0.5, -0.75));
  let toEye = vec3<f32>(0.0, 0.0, 1.0);
  let fromEye = vec3<f32>(0.0, 0.0, -1.0);
  let nf = faceForward(n, fromEye, n);
  let highlight = pow(max(dot(reflect(fromLight, nf), toEye), 0.0), 16.0);
  let bent = refract(fromEye, nf, 0.75);
  let diffuse = ldexp(max(dot(nf, toLight), 0.0), -1);
  let gain = determinant(transpose(frame.m));
  let col = (u32((v.uv.x * 255.0)) + 1u);
  let lead = firstLeadingBit(col);
  let nibble = extractBits(reverseBits(col), 28u, 4u);
  let word = insertBits(col, countOneBits(col), 8u, 4u);
  let _gv0 = f32(lead);
  let bands = vec3<f32>((_gv0 * 0.125), (f32(nibble) * 0.0625), (f32(extractBits(word, 8u, 4u)) * 0.125));
  let shift = i32(lead);
  let rolled = ((col << u32(shift)) & 255u);
  let inverted = (~rolled & 255u);
  var stepGain: f32 = 0.0;
  switch (i32(nibble) & 3) {
    case 0, 1: {
      stepGain = 0.25;
    }
    case 2: {
      stepGain = 0.5;
    }
    default: {
      stepGain = 1.0;
    }
  }
  let edge = min(fwidthCoarse(_gv0), 1.0);
  let lit = (((bands * diffuse) * stepGain) + vec3<f32>((f32(inverted) * 0.001953125), 0.0, 0.0));
  let tint = (bent * 0.1);
  let base = (lit + tint);
  let _lc0 = (highlight * gain);
  let shine = vec3<f32>(_lc0, _lc0, _lc0);
  let color = mix(base, vec3<f32>(1.0, 1.0, 1.0), edge);
  let out = (color + shine);
  return vec4<f32>(out, 1.0);
}
