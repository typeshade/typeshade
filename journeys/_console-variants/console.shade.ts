"use typeshade";
declare const out: storage<array<f32>, "read_write">;
function report(i: u32) { console.log("retained", i, 7.25); }
@compute([1])
export function main(gid: builtin<"global_invocation_id">) {
  report(gid.x);
  out[gid.x] = 7.25;
}
