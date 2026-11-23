"use typeshade";

/* @example
{
  "title": "Parallel sum",
  "blurb": "Step 14 of the learning path. One workgroup of 64 invocations adds up an array. Each invocation adds every 64th number, then the workgroup halves its partial sums in rounds through `workgroup` memory. `workgroupBarrier()` makes every invocation wait, so a round reads only what the round before wrote. A barrier needs a GPU tier, so this step lists WebGPU only.",
  "renderable": false,
  "reason": "missing capabilities: storageBuffer, compute"
}
*/

// Step 14. Workgroup memory is shared by the 64 invocations of one workgroup. A barrier orders the rounds.
declare const numbers: storage<array<f32>>;
declare const total: storage<array<f32>, "read_write">;

let partial: workgroup<array<f32, 64>>;

@compute([64])
export function sum(lid: builtin<"local_invocation_id">) {
  let mine = 0.0;
  for (let i: u32 = lid.x; i < numbers.length; i += 64) {
    mine += numbers[i];
  }
  partial[lid.x] = mine;
  workgroupBarrier();
  for (let stride: u32 = 32; stride > 0; stride /= 2) {
    if (lid.x < stride) {
      partial[lid.x] = partial[lid.x] + partial[lid.x + stride];
    }
    workgroupBarrier();
  }
  if (lid.x === 0) {
    total[0] = partial[0];
  }
}
