"use typeshade";

// A cell can receive several values, so each update is an integer atomic combine (#761).
// Both operand orders and both integer storage types must keep the sequential result.
export function unsignedMin(best: array<u32>, keys: array<u32>, values: array<u32>): void {
  for (let i: u32 = 0; i < keys.length; i++) {
    const k = keys[i];
    best[k] = min(best[k], values[i]);
  }
}

export function unsignedMax(best: array<u32>, keys: array<u32>, values: array<u32>): void {
  for (let i: u32 = 0; i < keys.length; i++) {
    best[keys[i]] = max(values[i], best[keys[i]]);
  }
}

export function signedMin(best: array<i32>, keys: array<u32>, values: array<i32>): void {
  for (let i: u32 = 0; i < keys.length; i++) {
    best[keys[i]] = min(values[i], best[keys[i]]);
  }
}

export function signedMax(best: array<i32>, keys: array<u32>, values: array<i32>): void {
  for (let i: u32 = 0; i < keys.length; i++) {
    const k = keys[i];
    best[k] = max(best[k], values[i]);
  }
}
