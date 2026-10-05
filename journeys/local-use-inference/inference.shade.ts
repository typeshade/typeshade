"use typeshade";

declare const out: storage<array<f32, 4>, "read_write">;

function half(index: i32): i32 {
  return index / 2;
}

function wrap(index: u32): u32 {
  return index + 1;
}

@compute([1])
export function main(): void {
  let objectIndex = -3;
  const unsignedIndex = 4294967295;
  out[0] = f32(half(objectIndex));
  out[1] = f32(wrap(unsignedIndex));
  {
    const objectIndex = 6;
    out[2] = f32(half(objectIndex));
  }
  const captured = (): i32 => half(objectIndex);
  out[3] = f32(captured());
}
