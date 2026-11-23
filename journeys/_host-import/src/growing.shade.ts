"use typeshade";

// A while that pushes: Route 3, which runs on the CPU tier alone (change 0114, A12, stage S2).
export function evens(limit: u32): u32[] {
  const out: u32[] = [];
  let k: u32 = 0;
  while (k < limit) {
    out.push(k);
    k += 2;
  }
  return out;
}
