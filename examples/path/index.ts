// ═══ typeshade examples — the learning path (change 0145) ═══
//
// GENERATED — DO NOT EDIT. Regenerate with: bun examples/path/_registry.ts
//
// Each step is a `"use typeshade"` module and the host file that runs it, in
// `examples/path/<id>/`. This file carries their text, so `typeshade/examples` stays
// browser-safe and reads no file. The order, the part and the tiers are `_order.ts`'s; the title
// and the blurb are the module's `@example` block.

import type { PathExample } from '../_shared.js';

/** Every step of the learning path built so far, in the order a reader meets them. */
export const pathExamples: readonly PathExample[] = [
  {
    id: 'first-color',
    step: 1,
    part: 'First pixels',
    title: 'First colour',
    blurb:
      'Step 1 of the learning path. The smallest program that draws: the `"use typeshade"` directive and one `@fragment` entry that returns one colour for every pixel. The host imports `fs` and calls `fs(canvas)`. The same call gives the same pixels on WebGPU, WebGL2 and the CPU tier.',
    shadeFile: 'path/first-color/first-color.shade.ts',
    shadeSource:
      '"use typeshade";\n\n/* @example\n{\n  "title": "First colour",\n  "blurb": "Step 1 of the learning path. The smallest program that draws: the `\\"use typeshade\\"` directive and one `@fragment` entry that returns one colour for every pixel. The host imports `fs` and calls `fs(canvas)`. The same call gives the same pixels on WebGPU, WebGL2 and the CPU tier.",\n  "renderable": false,\n  "reason": "no entry point"\n}\n*/\n\n// Step 1. A fragment entry returns one colour for every pixel.\n@fragment\nexport function fs(): vec4 {\n  return vec4(0.2, 0.6, 1.0, 1.0);\n}\n',
    hostFile: 'path/first-color/host.ts',
    hostSource:
      "// Step 1. Draw the module's entry into a canvas. The same call runs on WebGPU, WebGL2 and the CPU tier.\nimport { fs } from './first-color.shade.ts';\n\nexport async function run(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<void> {\n  await fs(canvas);\n}\n",
    tiers: ['webgpu', 'webgl2', 'cpu'],
  },
  {
    id: 'uv-gradient',
    step: 2,
    part: 'First pixels',
    title: 'UV gradient',
    blurb:
      "Step 2 of the learning path. The `position` builtin gives the pixel's place, a uniform carries the canvas size, and a vector divide turns the place into a coordinate from 0 to 1. The swizzle `.xy` takes two components of a `vec4`. The host sets the size once, with `fs(canvas, { frame })`.",
    shadeFile: 'path/uv-gradient/uv-gradient.shade.ts',
    shadeSource:
      '"use typeshade";\n\n/* @example\n{\n  "title": "UV gradient",\n  "blurb": "Step 2 of the learning path. The `position` builtin gives the pixel\'s place, a uniform carries the canvas size, and a vector divide turns the place into a coordinate from 0 to 1. The swizzle `.xy` takes two components of a `vec4`. The host sets the size once, with `fs(canvas, { frame })`.",\n  "renderable": false,\n  "reason": "no entry point"\n}\n*/\n\n// Step 2. The position builtin and the canvas size give each pixel a coordinate from 0 to 1.\ninterface Frame {\n  size: vec2;\n}\n\ndeclare const frame: uniform<Frame>;\n\n@fragment\nexport function fs(p: builtin<"position">): vec4 {\n  const uv = p.xy / frame.size;\n  return vec4(uv.x, uv.y, 0.5, 1.0);\n}\n',
    hostFile: 'path/uv-gradient/host.ts',
    hostSource:
      "// Step 2. A uniform carries the canvas size: the host passes its value as the second argument of the call.\nimport { fs } from './uv-gradient.shade.ts';\n\nexport async function run(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<void> {\n  await fs(canvas, { frame: { size: [canvas.width, canvas.height] } });\n}\n",
    tiers: ['webgpu', 'webgl2', 'cpu'],
  },
  {
    id: 'moving-wave',
    step: 3,
    part: 'First pixels',
    title: 'Moving wave',
    blurb:
      'Step 3 of the learning path. The uniform of step 2 gains one field, `time`, and the colour depends on it. `run(canvas, time)` draws one frame. `animate(canvas)` calls `run` once a frame, so the Playground shows the wave move.',
    shadeFile: 'path/moving-wave/moving-wave.shade.ts',
    shadeSource:
      '"use typeshade";\n\n/* @example\n{\n  "title": "Moving wave",\n  "blurb": "Step 3 of the learning path. The uniform of step 2 gains one field, `time`, and the colour depends on it. `run(canvas, time)` draws one frame. `animate(canvas)` calls `run` once a frame, so the Playground shows the wave move.",\n  "renderable": false,\n  "reason": "no entry point"\n}\n*/\n\n// Step 3. The same uniform as step 2, with one more field: the time in seconds.\ninterface Frame {\n  size: vec2;\n  time: f32;\n}\n\ndeclare const frame: uniform<Frame>;\n\n@fragment\nexport function fs(p: builtin<"position">): vec4 {\n  const uv = p.xy / frame.size;\n  const wave = 0.5 + 0.5 * sin(12.0 * uv.x + 3.0 * frame.time);\n  return vec4(uv.y, 0.5 * wave, wave, 1.0);\n}\n',
    hostFile: 'path/moving-wave/host.ts',
    hostSource:
      "// Step 3. Time is one more uniform field. `run` draws one frame, and `animate` draws a frame each tick.\nimport { fs } from './moving-wave.shade.ts';\n\nexport async function run(canvas: HTMLCanvasElement | OffscreenCanvas, time = 0): Promise<void> {\n  await fs(canvas, { frame: { size: [canvas.width, canvas.height], time } });\n}\n\nexport function animate(canvas: HTMLCanvasElement): void {\n  const tick = (ms: number): void => {\n    void run(canvas, ms / 1000);\n    requestAnimationFrame(tick);\n  };\n  requestAnimationFrame(tick);\n}\n",
    tiers: ['webgpu', 'webgl2', 'cpu'],
  },
  {
    id: 'sdf-shapes',
    step: 4,
    part: 'First pixels',
    title: 'SDF shapes',
    blurb:
      'Step 4 of the learning path. A function gives the distance from a point to a shape. `length` measures the circle, and `smoothstep` turns a distance into a soft edge. Two small functions, `circle` and `box`, are called from the entry.',
    shadeFile: 'path/sdf-shapes/sdf-shapes.shade.ts',
    shadeSource:
      '"use typeshade";\n\n/* @example\n{\n  "title": "SDF shapes",\n  "blurb": "Step 4 of the learning path. A function gives the distance from a point to a shape. `length` measures the circle, and `smoothstep` turns a distance into a soft edge. Two small functions, `circle` and `box`, are called from the entry.",\n  "renderable": false,\n  "reason": "no entry point"\n}\n*/\n\n// Step 4. A function returns the distance from a point to a shape: negative inside, positive outside.\ninterface Frame {\n  size: vec2;\n}\n\ndeclare const frame: uniform<Frame>;\n\nfunction circle(p: vec2, radius: f32): f32 {\n  return length(p) - radius;\n}\n\nfunction box(p: vec2, half: vec2): f32 {\n  return max(abs(p.x) - half.x, abs(p.y) - half.y);\n}\n\nfunction edge(distance: f32): f32 {\n  return 1.0 - smoothstep(0.0, 0.01, distance);\n}\n\n@fragment\nexport function fs(p: builtin<"position">): vec4 {\n  const uv = (2.0 * p.xy - frame.size) / frame.size.y;\n  const disc = edge(circle(uv - vec2(-0.5, 0.0), 0.3));\n  const panel = edge(box(uv - vec2(0.5, 0.0), vec2(0.3, 0.2)));\n  return vec4(0.1 + 0.8 * disc, 0.1 + 0.4 * disc + 0.3 * panel, 0.15 + 0.8 * panel, 1.0);\n}\n',
    hostFile: 'path/sdf-shapes/host.ts',
    hostSource:
      "// Step 4. The host is the host of step 2: functions of the module change the picture, not the call.\nimport { fs } from './sdf-shapes.shade.ts';\n\nexport async function run(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<void> {\n  await fs(canvas, { frame: { size: [canvas.width, canvas.height] } });\n}\n",
    tiers: ['webgpu', 'webgl2', 'cpu'],
  },
];
