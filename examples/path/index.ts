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
  {
    id: 'double-array',
    step: 12,
    part: 'GPU compute',
    title: 'Double an array',
    blurb:
      'Step 12 of the learning path. The first compute kernel. A `@compute` entry runs once for each invocation, and `global_invocation_id` says which one. The storage binding `numbers` is the array the host passes by name. The host calls `doubled({ numbers }, workgroups)`, waits, and reads the doubled numbers from the array it passed.',
    shadeFile: 'path/double-array/double-array.shade.ts',
    shadeSource:
      '"use typeshade";\n\n/* @example\n{\n  "title": "Double an array",\n  "blurb": "Step 12 of the learning path. The first compute kernel. A `@compute` entry runs once for each invocation, and `global_invocation_id` says which one. The storage binding `numbers` is the array the host passes by name. The host calls `doubled({ numbers }, workgroups)`, waits, and reads the doubled numbers from the array it passed.",\n  "renderable": false,\n  "reason": "missing capabilities: storageBuffer, compute"\n}\n*/\n\n// Step 12. One invocation doubles one number. The entry checks its own bound, because the host dispatches whole workgroups.\ndeclare const numbers: storage<array<f32>, "read_write">;\n\n@compute([64])\nexport function doubled(gid: builtin<"global_invocation_id">) {\n  if (gid.x >= numbers.length) {\n    return;\n  }\n  numbers[gid.x] = numbers[gid.x] * 2.0;\n}\n',
    hostFile: 'path/double-array/host.ts',
    hostSource:
      "// Step 12. A compute entry takes its arrays by binding name and a count of workgroups of 64.\n// When the promise resolves, the array holds what the entry wrote.\nimport { doubled } from './double-array.shade.ts';\n\nexport async function run(count = 100): Promise<Float32Array> {\n  const numbers = Float32Array.from({ length: count }, (_, i) => i);\n  await doubled({ numbers }, Math.ceil(count / 64));\n  return numbers;\n}\n",
    tiers: ['webgpu', 'webgl2', 'cpu'],
  },
  {
    id: 'image-blur',
    step: 13,
    part: 'GPU compute',
    title: 'Image blur',
    blurb:
      'Step 13 of the learning path. An image is a grid of numbers, one brightness for each pixel. The entry is `@compute([8, 8])`, so each invocation has an `x` and a `y`, and it averages the nine pixels around its own. A uniform holds the width and the height. The host dispatches a 2D grid of workgroups and reads the blurred image back.',
    shadeFile: 'path/image-blur/image-blur.shade.ts',
    shadeSource:
      '"use typeshade";\n\n/* @example\n{\n  "title": "Image blur",\n  "blurb": "Step 13 of the learning path. An image is a grid of numbers, one brightness for each pixel. The entry is `@compute([8, 8])`, so each invocation has an `x` and a `y`, and it averages the nine pixels around its own. A uniform holds the width and the height. The host dispatches a 2D grid of workgroups and reads the blurred image back.",\n  "renderable": false,\n  "reason": "missing capabilities: storageBuffer, compute"\n}\n*/\n\n// Step 13. A 2D grid of invocations, one for each pixel. A pixel at an edge reads the nearest pixel inside the image.\ninterface Size {\n  width: u32;\n  height: u32;\n}\n\ndeclare const size: uniform<Size>;\ndeclare const source: storage<array<f32>>;\ndeclare const blurred: storage<array<f32>, "read_write">;\n\n@compute([8, 8])\nexport function blur(gid: builtin<"global_invocation_id">) {\n  if (gid.x >= size.width || gid.y >= size.height) {\n    return;\n  }\n  let total = 0.0;\n  for (let dy: i32 = -1; dy <= 1; dy++) {\n    for (let dx: i32 = -1; dx <= 1; dx++) {\n      const x = clamp(i32(gid.x) + dx, 0, i32(size.width) - 1);\n      const y = clamp(i32(gid.y) + dy, 0, i32(size.height) - 1);\n      total += source[u32(y) * size.width + u32(x)];\n    }\n  }\n  blurred[gid.y * size.width + gid.x] = total / 9.0;\n}\n',
    hostFile: 'path/image-blur/host.ts',
    hostSource:
      "// Step 13. A 2D dispatch: the workgroup count is `[x, y]`, and a uniform is passed as a plain object.\n// The image is a flat array of brightness values, row by row.\nimport { blur } from './image-blur.shade.ts';\n\nexport async function run(width = 16, height = 16): Promise<Float32Array> {\n  const source = Float32Array.from({ length: width * height }, (_, i) => {\n    const x = i % width;\n    const y = Math.floor(i / width);\n    return x >= width / 4 && x < width / 2 && y >= height / 4 && y < height / 2 ? 1 : 0;\n  });\n  const blurred = new Float32Array(width * height);\n  await blur({ size: { width, height }, source, blurred }, [\n    Math.ceil(width / 8),\n    Math.ceil(height / 8),\n  ]);\n  return blurred;\n}\n",
    tiers: ['webgpu', 'webgl2', 'cpu'],
  },
  {
    id: 'parallel-sum',
    step: 14,
    part: 'GPU compute',
    title: 'Parallel sum',
    blurb:
      'Step 14 of the learning path. One workgroup of 64 invocations adds up an array. Each invocation adds every 64th number, then the workgroup halves its partial sums in rounds through `workgroup` memory. `workgroupBarrier()` makes every invocation wait, so a round reads only what the round before wrote. The CPU tier refuses a barrier, so this step lists WebGPU and WebGL2, which runs the barrier in its pass program.',
    shadeFile: 'path/parallel-sum/parallel-sum.shade.ts',
    shadeSource:
      '"use typeshade";\n\n/* @example\n{\n  "title": "Parallel sum",\n  "blurb": "Step 14 of the learning path. One workgroup of 64 invocations adds up an array. Each invocation adds every 64th number, then the workgroup halves its partial sums in rounds through `workgroup` memory. `workgroupBarrier()` makes every invocation wait, so a round reads only what the round before wrote. The CPU tier refuses a barrier, so this step lists WebGPU and WebGL2, which runs the barrier in its pass program.",\n  "renderable": false,\n  "reason": "missing capabilities: storageBuffer, compute"\n}\n*/\n\n// Step 14. Workgroup memory is shared by the 64 invocations of one workgroup. A barrier orders the rounds.\ndeclare const numbers: storage<array<f32>>;\ndeclare const total: storage<array<f32>, "read_write">;\n\nlet partial: workgroup<array<f32, 64>>;\n\n@compute([64])\nexport function sum(lid: builtin<"local_invocation_id">) {\n  let mine = 0.0;\n  for (let i: u32 = lid.x; i < numbers.length; i += 64) {\n    mine += numbers[i];\n  }\n  partial[lid.x] = mine;\n  workgroupBarrier();\n  for (let stride: u32 = 32; stride > 0; stride /= 2) {\n    if (lid.x < stride) {\n      partial[lid.x] = partial[lid.x] + partial[lid.x + stride];\n    }\n    workgroupBarrier();\n  }\n  if (lid.x === 0) {\n    total[0] = partial[0];\n  }\n}\n',
    hostFile: 'path/parallel-sum/host.ts',
    hostSource:
      "// Step 14. One workgroup does the whole sum, so the call dispatches one workgroup and reads one number.\n// A barrier needs a GPU tier: this host runs on WebGPU.\nimport { sum } from './parallel-sum.shade.ts';\n\nexport async function run(count = 1000): Promise<number> {\n  const numbers = Float32Array.from({ length: count }, (_, i) => (i % 10) + 1);\n  const total = new Float32Array(1);\n  await sum({ numbers, total }, 1);\n  return total[0]!;\n}\n",
    tiers: ['webgpu', 'webgl2'],
  },
  {
    id: 'histogram',
    step: 15,
    part: 'GPU compute',
    title: 'Histogram',
    blurb:
      'Step 15 of the learning path. Many invocations count into the same bin at once. `bins[bin] = bins[bin] + 1` would lose counts, because two invocations read the same old value. `atomicAdd` is one indivisible step, so no count is lost. The host reads eight counts, and each count is the height of one bar. Atomics need a storage buffer, so this step lists WebGPU and the CPU tier.',
    shadeFile: 'path/histogram/histogram.shade.ts',
    shadeSource:
      '"use typeshade";\n\n/* @example\n{\n  "title": "Histogram",\n  "blurb": "Step 15 of the learning path. Many invocations count into the same bin at once. `bins[bin] = bins[bin] + 1` would lose counts, because two invocations read the same old value. `atomicAdd` is one indivisible step, so no count is lost. The host reads eight counts, and each count is the height of one bar. Atomics need a storage buffer, so this step lists WebGPU and the CPU tier.",\n  "renderable": false,\n  "reason": "missing capabilities: storageBuffer, compute"\n}\n*/\n\n// Step 15. A value from 0 to 1 lands in one of eight bins. The atomic add counts it without a lost update.\ndeclare const values: storage<array<f32>>;\ndeclare const bins: storage<array<atomic<u32>>, "read_write">;\n\n@compute([64])\nexport function histogram(gid: builtin<"global_invocation_id">) {\n  if (gid.x >= values.length) {\n    return;\n  }\n  const bin = u32(clamp(values[gid.x], 0.0, 0.999) * 8.0);\n  atomicAdd(bins[bin], 1);\n}\n',
    hostFile: 'path/histogram/host.ts',
    hostSource:
      "// Step 15. An array of atomics is passed as a typed array of its integers.\n// The eight counts are the heights of the eight bars of the chart.\nimport { histogram } from './histogram.shade.ts';\n\nexport async function run(count = 1000): Promise<Uint32Array> {\n  const values = Float32Array.from({ length: count }, (_, i) => ((i * 37) % 100) / 100);\n  const bins = new Uint32Array(8);\n  await histogram({ values, bins }, Math.ceil(count / 64));\n  return bins;\n}\n",
    tiers: ['webgpu', 'webgl2', 'cpu'],
  },
  {
    id: 'ray-tracer',
    step: 17,
    part: 'Putting it together',
    title: 'Ray tracer',
    blurb:
      'Step 17 of the learning path. No new concept: the pieces of steps 1 to 8 work together. A uniform gives the canvas size, vectors build a camera ray for each pixel, a `class Sphere` finds where a ray hits it, and a loop follows the ray through one bounce. The floor is a plane with a checker made from `floor` and `fract`. Each hit asks the light if a sphere is in the way, and that gives the shadow. The host is the host of step 2.',
    shadeFile: 'path/ray-tracer/ray-tracer.shade.ts',
    shadeSource:
      '"use typeshade";\n\n/* @example\n{\n  "title": "Ray tracer",\n  "blurb": "Step 17 of the learning path. No new concept: the pieces of steps 1 to 8 work together. A uniform gives the canvas size, vectors build a camera ray for each pixel, a `class Sphere` finds where a ray hits it, and a loop follows the ray through one bounce. The floor is a plane with a checker made from `floor` and `fract`. Each hit asks the light if a sphere is in the way, and that gives the shadow. The host is the host of step 2.",\n  "renderable": false,\n  "reason": "no entry point"\n}\n*/\n\n// Step 17. A ray from the eye through each pixel hits two spheres and a floor, and bounces once.\ninterface Frame {\n  size: vec2;\n}\n\ndeclare const frame: uniform<Frame>;\n\nclass Sphere {\n  constructor(\n    readonly center: vec3,\n    readonly radius: f32,\n    readonly color: vec3,\n  ) {}\n\n  hit(origin: vec3, direction: vec3): f32 {\n    const offset = origin - this.center;\n    const b = dot(offset, direction);\n    const c = dot(offset, offset) - this.radius * this.radius;\n    const discriminant = b * b - c;\n    if (discriminant < 0.0) {\n      return -1.0;\n    }\n    return -b - sqrt(discriminant);\n  }\n}\n\nfunction sky(direction: vec3): vec3 {\n  return mix(vec3(0.95, 0.9, 0.8), vec3(0.3, 0.5, 0.9), clamp(direction.y, 0.0, 1.0));\n}\n\n@fragment\nexport function fs(p: builtin<"position">): vec4 {\n  const uv = (2.0 * p.xy - frame.size) / frame.size.y;\n  const red = new Sphere(vec3(-0.6, -0.2, 0.0), 0.8, vec3(0.9, 0.2, 0.2));\n  const blue = new Sphere(vec3(0.9, -0.5, 0.5), 0.5, vec3(0.2, 0.4, 0.9));\n  const light = normalize(vec3(0.5, 1.0, 0.7));\n  let origin = vec3(0.0, 0.0, 3.0);\n  let direction = normalize(vec3(uv.x, -uv.y, -1.5));\n  let weight = 1.0;\n  let color = vec3(0.0, 0.0, 0.0);\n  for (let bounce: i32 = 0; bounce < 2; bounce++) {\n    let nearest = 1000.0;\n    let normal = vec3(0.0, 1.0, 0.0);\n    let albedo = vec3(0.0, 0.0, 0.0);\n    const onRed = red.hit(origin, direction);\n    if (onRed > 0.001 && onRed < nearest) {\n      nearest = onRed;\n      normal = normalize(origin + direction * onRed - red.center);\n      albedo = red.color;\n    }\n    const onBlue = blue.hit(origin, direction);\n    if (onBlue > 0.001 && onBlue < nearest) {\n      nearest = onBlue;\n      normal = normalize(origin + direction * onBlue - blue.center);\n      albedo = blue.color;\n    }\n    if (direction.y < 0.0) {\n      const onFloor = (-1.0 - origin.y) / direction.y;\n      if (onFloor > 0.001 && onFloor < nearest) {\n        nearest = onFloor;\n        normal = vec3(0.0, 1.0, 0.0);\n        const spot = origin + direction * onFloor;\n        const tile = fract(0.5 * (floor(spot.x + 0.31) + floor(spot.z + 0.17)));\n        albedo = vec3(0.35 + 0.5 * tile, 0.35 + 0.5 * tile, 0.35 + 0.5 * tile);\n      }\n    }\n    if (nearest >= 1000.0) {\n      color += weight * sky(direction);\n      weight = 0.0;\n      break;\n    }\n    const point = origin + direction * nearest;\n    let lit = max(dot(normal, light), 0.0);\n    if (red.hit(point, light) > 0.001 || blue.hit(point, light) > 0.001) {\n      lit = lit * 0.3;\n    }\n    color += weight * 0.65 * albedo * (0.2 + 0.8 * lit);\n    weight = weight * 0.35;\n    origin = point;\n    direction = reflect(direction, normal);\n  }\n  color += weight * sky(direction);\n  return vec4(sqrt(color), 1.0);\n}\n',
    hostFile: 'path/ray-tracer/host.ts',
    hostSource:
      "// Step 17. The host is the host of step 2: the scene lives in the module, and the call only passes the canvas size.\nimport { fs } from './ray-tracer.shade.ts';\n\nexport async function run(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<void> {\n  await fs(canvas, { frame: { size: [canvas.width, canvas.height] } });\n}\n",
    tiers: ['webgpu', 'webgl2', 'cpu'],
  },
];
