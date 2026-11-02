"use typeshade";

// Nine storage buffers in one entry: eight arrays summed into a ninth. WebGPU's default device
// binds eight storage buffers per stage, so the runtime refuses this entry on that device, by
// name (Rule 11.11, refusal R4). A device that `createRuntime({ programs })` requests binds all
// nine, where the adapter allows them.

declare const a0: storage<array<f32>>;
declare const a1: storage<array<f32>>;
declare const a2: storage<array<f32>>;
declare const a3: storage<array<f32>>;
declare const a4: storage<array<f32>>;
declare const a5: storage<array<f32>>;
declare const a6: storage<array<f32>>;
declare const a7: storage<array<f32>>;
declare const out: storage<array<f32>, "read_write">;

export const main = compute([64], function main(gid: builtin<"global_invocation_id", vec3u>): void {
  const i = gid.x;
  if (i >= out.length) {
    return;
  }
  out[i] = a0[i] + a1[i] + a2[i] + a3[i] + a4[i] + a5[i] + a6[i] + a7[i];
});
