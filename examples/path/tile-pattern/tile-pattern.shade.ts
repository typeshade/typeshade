"use typeshade";

/* @example
{
  "title": "Tile pattern",
  "blurb": "Step 5 of the learning path. `fract` keeps the part of a coordinate inside one tile, and `floor` names the tile. A `for` loop counts three rings, and an `if` picks the colours of one tile from its place in the grid.",
  "renderable": false,
  "reason": "no entry point"
}
*/

// Step 5. A loop repeats work, an if chooses, and fract turns one picture into a grid of tiles.
interface Frame {
  size: vec2;
}

declare const frame: uniform<Frame>;

function rings(cell: vec2): f32 {
  let level = 0.0;
  for (let n = 0; n < 3; n++) {
    if (length(cell) < 0.15 + 0.1 * f32(n)) {
      level += 1.0;
    }
  }
  return level / 3.0;
}

@fragment
export function fs(p: builtin<"position">): vec4 {
  const grid = 6.0 * p.xy / frame.size.y;
  const tile = floor(grid);
  const level = rings(fract(grid) - 0.5);
  if ((i32(tile.x) + i32(tile.y)) % 2 == 0) {
    return vec4(0.2 + 0.7 * level, 0.3 + 0.4 * level, 0.9 - 0.5 * level, 1.0);
  }
  return vec4(0.9 - 0.6 * level, 0.4 + 0.2 * level, 0.2 + 0.3 * level, 1.0);
}
