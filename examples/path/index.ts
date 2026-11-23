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
  {
    id: 'tile-pattern',
    step: 5,
    part: 'The language',
    title: 'Tile pattern',
    blurb:
      'Step 5 of the learning path. `fract` keeps the part of a coordinate inside one tile, and `floor` names the tile. A `for` loop counts three rings, and an `if` picks the colours of one tile from its place in the grid.',
    shadeFile: 'path/tile-pattern/tile-pattern.shade.ts',
    shadeSource:
      '"use typeshade";\n\n/* @example\n{\n  "title": "Tile pattern",\n  "blurb": "Step 5 of the learning path. `fract` keeps the part of a coordinate inside one tile, and `floor` names the tile. A `for` loop counts three rings, and an `if` picks the colours of one tile from its place in the grid.",\n  "renderable": false,\n  "reason": "no entry point"\n}\n*/\n\n// Step 5. A loop repeats work, an if chooses, and fract turns one picture into a grid of tiles.\ninterface Frame {\n  size: vec2;\n}\n\ndeclare const frame: uniform<Frame>;\n\nfunction rings(cell: vec2): f32 {\n  let level = 0.0;\n  for (let n = 0; n < 3; n++) {\n    if (length(cell) < 0.15 + 0.1 * f32(n)) {\n      level += 1.0;\n    }\n  }\n  return level / 3.0;\n}\n\n@fragment\nexport function fs(p: builtin<"position">): vec4 {\n  const grid = 6.0 * p.xy / frame.size.y;\n  const tile = floor(grid);\n  const level = rings(fract(grid) - 0.5);\n  if ((i32(tile.x) + i32(tile.y)) % 2 == 0) {\n    return vec4(0.2 + 0.7 * level, 0.3 + 0.4 * level, 0.9 - 0.5 * level, 1.0);\n  }\n  return vec4(0.9 - 0.6 * level, 0.4 + 0.2 * level, 0.2 + 0.3 * level, 1.0);\n}\n',
    hostFile: 'path/tile-pattern/host.ts',
    hostSource:
      "// Step 5. The host is the host of step 2: loops and conditions of the module change the picture, not the call.\nimport { fs } from './tile-pattern.shade.ts';\n\nexport async function run(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<void> {\n  await fs(canvas, { frame: { size: [canvas.width, canvas.height] } });\n}\n",
    tiers: ['webgpu', 'webgl2', 'cpu'],
  },
  {
    id: 'fractal',
    step: 6,
    part: 'The language',
    title: 'Mandelbrot set',
    blurb:
      'Step 6 of the learning path. Each pixel is a point `c` of the plane. A loop squares a complex number again and again, and `break` leaves it as soon as the number is far from the origin. The count of rounds the pixel lasted gives its colour.',
    shadeFile: 'path/fractal/fractal.shade.ts',
    shadeSource:
      '"use typeshade";\n\n/* @example\n{\n  "title": "Mandelbrot set",\n  "blurb": "Step 6 of the learning path. Each pixel is a point `c` of the plane. A loop squares a complex number again and again, and `break` leaves it as soon as the number is far from the origin. The count of rounds the pixel lasted gives its colour.",\n  "renderable": false,\n  "reason": "no entry point"\n}\n*/\n\n// Step 6. A loop with an early exit: break leaves the loop as soon as the point has escaped.\ninterface Frame {\n  size: vec2;\n}\n\ndeclare const frame: uniform<Frame>;\n\nfunction rounds(c: vec2): f32 {\n  let z = vec2(0.0, 0.0);\n  let count = 0.0;\n  for (let i = 0; i < 32; i++) {\n    if (length(z) > 2.0) {\n      break;\n    }\n    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;\n    count += 1.0;\n  }\n  return count / 32.0;\n}\n\n@fragment\nexport function fs(p: builtin<"position">): vec4 {\n  const uv = (2.0 * p.xy - frame.size) / frame.size.y;\n  const t = rounds(1.3 * uv - vec2(0.6, 0.0));\n  return vec4(t, sqrt(t) * 0.8, 1.0 - t, 1.0);\n}\n',
    hostFile: 'path/fractal/host.ts',
    hostSource:
      "// Step 6. The host is the host of step 2: the loop in the module changes the picture, not the call.\nimport { fs } from './fractal.shade.ts';\n\nexport async function run(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<void> {\n  await fs(canvas, { frame: { size: [canvas.width, canvas.height] } });\n}\n",
    tiers: ['webgpu', 'webgl2', 'cpu'],
  },
  {
    id: 'palette',
    step: 7,
    part: 'The language',
    title: 'Palette',
    blurb:
      'Step 7 of the learning path. A module constant holds four colours in an array. The coordinate picks two neighbours of the array by index, and `mix` blends them, so the picture is one smooth ramp through the palette.',
    shadeFile: 'path/palette/palette.shade.ts',
    shadeSource:
      '"use typeshade";\n\n/* @example\n{\n  "title": "Palette",\n  "blurb": "Step 7 of the learning path. A module constant holds four colours in an array. The coordinate picks two neighbours of the array by index, and `mix` blends them, so the picture is one smooth ramp through the palette.",\n  "renderable": false,\n  "reason": "no entry point"\n}\n*/\n\n// Step 7. A module constant holds an array of colours, and an index picks an element of it.\ninterface Frame {\n  size: vec2;\n}\n\ndeclare const frame: uniform<Frame>;\n\nconst PALETTE: array<vec3, 4> = [\n  vec3(0.1, 0.1, 0.35),\n  vec3(0.8, 0.2, 0.4),\n  vec3(0.98, 0.65, 0.2),\n  vec3(1.0, 0.95, 0.7),\n];\n\nfunction ramp(t: f32): vec3 {\n  const scaled = clamp(t, 0.0, 0.999) * 3.0;\n  const i = i32(scaled);\n  return mix(PALETTE[i], PALETTE[i + 1], fract(scaled));\n}\n\n@fragment\nexport function fs(p: builtin<"position">): vec4 {\n  const uv = p.xy / frame.size;\n  const wavy = uv.x + 0.1 * sin(10.0 * uv.y);\n  return vec4(ramp(wavy), 1.0);\n}\n',
    hostFile: 'path/palette/host.ts',
    hostSource:
      "// Step 7. The host is the host of step 2: the constant and the array live in the module, not in the call.\nimport { fs } from './palette.shade.ts';\n\nexport async function run(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<void> {\n  await fs(canvas, { frame: { size: [canvas.width, canvas.height] } });\n}\n",
    tiers: ['webgpu', 'webgl2', 'cpu'],
  },
  {
    id: 'bouncing-balls',
    step: 8,
    part: 'The language',
    title: 'Bouncing balls',
    blurb:
      "Step 8 of the learning path. A `class Ball` keeps a place, a height and a radius, and has two methods: `bounce` moves the ball, `cover` measures a pixel against it. A function that takes a `Ball` and calls `bounce` changes the caller's ball, as it does in JavaScript: objects are references (change 0142). `animate(canvas)` shows the balls move.",
    shadeFile: 'path/bouncing-balls/bouncing-balls.shade.ts',
    shadeSource:
      '"use typeshade";\n\n/* @example\n{\n  "title": "Bouncing balls",\n  "blurb": "Step 8 of the learning path. A `class Ball` keeps a place, a height and a radius, and has two methods: `bounce` moves the ball, `cover` measures a pixel against it. A function that takes a `Ball` and calls `bounce` changes the caller\'s ball, as it does in JavaScript: objects are references (change 0142). `animate(canvas)` shows the balls move.",\n  "renderable": false,\n  "reason": "no entry point"\n}\n*/\n\n// Step 8. A class groups data with methods. A function that writes its Ball changes the caller\'s Ball.\ninterface Frame {\n  size: vec2;\n  time: f32;\n}\n\ndeclare const frame: uniform<Frame>;\n\nclass Ball {\n  constructor(\n    public pos: vec2,\n    readonly rise: f32,\n    readonly radius: f32,\n  ) {}\n\n  bounce(time: f32): void {\n    this.pos.y = this.radius - 0.8 + this.rise * abs(sin(3.0 * time + 4.0 * this.pos.x));\n  }\n\n  cover(p: vec2): f32 {\n    return 1.0 - smoothstep(0.0, 0.01, length(p - this.pos) - this.radius);\n  }\n}\n\nfunction drop(ball: Ball, time: f32): void {\n  ball.bounce(time);\n}\n\n@fragment\nexport function fs(p: builtin<"position">): vec4 {\n  const uv = (2.0 * p.xy - frame.size) / frame.size.y;\n  const flipped = vec2(uv.x, -uv.y);\n  const red = new Ball(vec2(-0.5, 0.0), 1.2, 0.2);\n  const blue = new Ball(vec2(0.4, 0.0), 0.8, 0.15);\n  drop(red, frame.time);\n  drop(blue, frame.time);\n  const a = red.cover(flipped);\n  const b = blue.cover(flipped);\n  return vec4(0.1 + 0.8 * a, 0.1 + 0.3 * a + 0.3 * b, 0.15 + 0.8 * b, 1.0);\n}\n',
    hostFile: 'path/bouncing-balls/host.ts',
    hostSource:
      "// Step 8. Time is the uniform of step 3. `run` draws one frame, and `animate` draws a frame each tick.\nimport { fs } from './bouncing-balls.shade.ts';\n\nexport async function run(canvas: HTMLCanvasElement | OffscreenCanvas, time = 0): Promise<void> {\n  await fs(canvas, { frame: { size: [canvas.width, canvas.height], time } });\n}\n\nexport function animate(canvas: HTMLCanvasElement): void {\n  const tick = (ms: number): void => {\n    void run(canvas, ms / 1000);\n    requestAnimationFrame(tick);\n  };\n  requestAnimationFrame(tick);\n}\n",
    tiers: ['webgpu', 'webgl2', 'cpu'],
  },
];
