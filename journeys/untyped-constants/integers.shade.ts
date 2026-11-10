"use typeshade";

// Change 0134, item 2: a `const` of a written number has no fixed type. Each read takes the
// type the written number would take there, so a constant that f32 does not hold exactly is
// read at its exact value through a conversion and beside a u32.

declare const src: storage<array<u32, 16>, "read">;
declare const dst: storage<array<u32, 64>, "read_write">;

const PRIME = 2654435761;
const K = 16777217;
const NEG = -16777219;
const N = 16;

class Mix {
  static SALT = 16777217;
}

@compute([1])
export function main(): void {
  for (let j: u32 = 0; j < N; j++) {
    const v = src[j];
    dst[j * 4] = v * u32(PRIME);
    dst[j * 4 + 1] = v + u32(K);
    dst[j * 4 + 2] = u32(i32(v) + i32(NEG));
    dst[j * 4 + 3] = v * K + u32(Mix.SALT);
  }
}
