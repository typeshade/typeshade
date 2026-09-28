"use typeshade";

/* @example
{
  "title": "Console from the GPU",
  "blurb": "`console.log(\"i =\", gid.x, p)` inside a compute kernel: a string literal is a label, and a value of any fixed size is an argument; `console.table(m)` shows a matrix by column. On the CPU the call reaches the host's sink; compiled with `console: 'gpu'`, the WGSL records it in a buffer that `decodeConsole` reads back as the same events. WGSL-only: GLSL ES 3.00 has no compute stage.",
  "renderable": false,
  "reason": "missing capabilities: storageBuffer, compute"
}
*/

// Roadmap 0.2 item 6, surface §66 (changes/0014). The kernel logs twice, once from the entry and
// once from a helper under a condition, with labels, a struct, a bool and a matrix among the
// arguments, which is every kind of word the console buffer writes, and once as a table, which
// the host prints by column (changes/0019).
//
// Compiled as it is, the WGSL records nothing and the compile gate reads that text. Compiled with
// `compile(src, { console: 'gpu' })`, the WGSL gains the `_console` storage buffer at group 0
// past `xs` and `out`, and the gate hands that text to Tint as a second program. The
// `console-log` journey runs it on WebGPU and holds the decoded events equal to the CPU's.

class Sample {
  value: f32;
  scaled: vec2;
}

declare const xs: storage<array<f32>>;
declare const out: storage<array<f32>, "read_write">;

function doubled(v: f32): f32 {
  const s = v * 2.;
  if (s > 10.) {
    console.warn("large value", s);
  }
  return s;
}

@compute([64])
export function main(@builtin("global_invocation_id") gid: vec3u): void {
  if (gid.x >= arrayLength(xs)) {
    return;
  }
  const x = xs[gid.x];
  const sample: Sample = { value: x, scaled: vec2(x, x * 0.5) };
  console.log("i =", gid.x, sample, x > 1., mat2x2(1., 0., 0., x));
  console.table(mat2x2(1., 0., 0., x));
  out[gid.x] = doubled(x);
}
