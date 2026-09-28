// The engine journey (change 0025, the gate issue #335 set before a reference engine): two
// materials, a shared camera and lights, a shadow pass, a render to texture and a 60-frame loop,
// on the runtime's public exports alone (`engine.mjs`). The harness runs the frames, counts the
// GPU objects every frame after the first creates, which must be none, and holds the last frame
// to the reference below, computed pixel by pixel in plain JavaScript.
//
// The scene is laid on the pixel grid so the reference is exact: the target is 64 pixels over
// two units, and every edge (the wall's, and its shadow's) falls between pixel centres.

import { LIGHTS } from './engine.mjs';

const SIZE = 64;
const FRAMES = 60;
const TIME = (FRAMES - 1) / 60;

const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const UP = [0, 0, 1];

/** The light that reaches a surface facing up: ambient, the key light unless in shadow, and the
 *  fill light at its pulse. */
function lit(seen) {
  const pulse = 0.5 + 0.5 * Math.sin(TIME * 6.2831853);
  const k = Math.max(dot3(UP, LIGHTS.key.dir), 0) * seen;
  const f = Math.max(dot3(UP, LIGHTS.fill.dir), 0) * pulse;
  return [0, 1, 2].map((i) => 0.08 + LIGHTS.key.color[i] * k + LIGHTS.fill.color[i] * f);
}

/** The colour of the pixel at column `px`, row `py` (the top row first), before the tonemap. */
function scene(px, py) {
  const x = ((px + 0.5) * 2) / SIZE - 1;
  const y = 1 - ((py + 0.5) * 2) / SIZE;
  if (Math.abs(x) < 0.25 && Math.abs(y) < 0.25) {
    // The wall's top: rows of bricks, mortar near each row's and each brick's start.
    const row = Math.floor(y * 8);
    const inRow = y * 8 - row;
    const b = x * 4 + 0.5 * row;
    const mortar = inRow < 0.2 || b - Math.floor(b) < 0.1;
    const albedo = mortar ? [0.85, 0.82, 0.78] : [0.7, 0.25, 0.2];
    return lit(1).map((l, i) => albedo[i] * l);
  }
  // The ground, in the wall's shadow where the key light, falling half a unit east per unit,
  // passes the wall's top half a unit up: half a unit west of the wall, and the wall's width.
  const shadowed = x > -0.5 && x < 0 && Math.abs(y) < 0.25;
  return lit(shadowed ? 0 : 1).map((l) => 0.6 * l);
}

export default {
  title: 'A small engine on the program runtime: two materials, a shadow pass, 60 frames',
  runs: [
    {
      kind: 'engine',
      engine: 'engine.mjs',
      programs: {
        shadow: 'shadow.shade.ts',
        ground: 'ground.shade.ts',
        brick: 'brick.shade.ts',
        tonemap: 'tonemap.shade.ts',
      },
      frames: FRAMES,
      size: SIZE,
      // What the output stores: c / (1 + c), rounded to 1/255, alpha 1.
      expected: () => {
        const out = [];
        for (let py = 0; py < SIZE; py++)
          for (let px = 0; px < SIZE; px++)
            out.push(...scene(px, py).map((c) => Math.round((c / (1 + c)) * 255) / 255), 1);
        return out;
      },
      // A half-float target and an 8-bit output: two steps of 1/255.
      tolerance: 2 / 255,
    },
  ],
};
