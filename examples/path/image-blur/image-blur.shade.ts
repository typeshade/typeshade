"use typeshade";

// Step 13. A 2D grid of invocations, one for each pixel. A pixel at an edge reads the nearest pixel inside the image.
interface Size {
  width: u32;
  height: u32;
}

declare const size: uniform<Size>;
declare const source: storage<array<f32>>;
declare const blurred: storage<array<f32>, "read_write">;

@compute([8, 8])
export function blur(gid: builtin<"global_invocation_id">) {
  if (gid.x >= size.width || gid.y >= size.height) {
    return;
  }
  let total = 0.0;
  for (let dy: i32 = -1; dy <= 1; dy++) {
    for (let dx: i32 = -1; dx <= 1; dx++) {
      const x = clamp(i32(gid.x) + dx, 0, i32(size.width) - 1);
      const y = clamp(i32(gid.y) + dy, 0, i32(size.height) - 1);
      total += source[u32(y) * size.width + u32(x)];
    }
  }
  blurred[gid.y * size.width + gid.x] = total / 9.0;
}
