"use typeshade"

/* @example
{
  "title": "Compare-exchange, uniform load, texture barrier",
  "blurb": "The three synchronisation builtins WGSL has and this surface lacked (§48): `atomicCompareExchangeWeak`, whose result struct WGSL gives no writable name so it is bound by inference and read field by field; `workgroupUniformLoad`, a read of workgroup memory between two barriers that every invocation must reach; and `textureBarrier`. WebGPU-only — GLSL ES 3.00 has no compute stage — so this one is `renderable: false` and the gate runs its Tint half alone.",
  "renderable": false,
  "reason": "storageBuffer, compute"
}
*/
// The three WGSL synchronisation and compare-exchange builtins (§48): `atomicCompareExchangeWeak`,
// `workgroupUniformLoad` and `textureBarrier`. All three were unknown names, and all three are
// WebGPU-only — GLSL ES 3.00 has no compute stage, so it has no workgroup memory, no atomic
// compare-exchange and no barrier of any kind. This example is `renderable: false` and the gate
// runs its Tint half alone.
//
// Each rule the surface states was measured on Tint, with a broken shader fed to the same
// instrument first:
//
//   textureBarrier() inside an `if`      "'textureBarrier' must only be called from uniform
//                                         control flow"
//   textureBarrier() in a vertex entry   "built-in cannot be used by vertex pipeline stage"
//   workgroupUniformLoad of storage      "no matching call to
//                                         'workgroupUniformLoad(ptr<storage, u32, read_write>)'"
//   r.oldValue on the CAS result         "struct member oldValue not found"
//   a variable of the CAS result type    "invalid type for variable declaration"
//
// The last two are why the result is bound with `const` and its fields spelled in snake_case:
// WGSL's `__atomic_compare_exchange_result<T>` is built in and has no writable name, so this
// surface types the struct, reads its fields, and declares nothing.

declare const claimed: storage<atomic<u32>, "read_write">
declare const out: storage<array<u32>, "read_write">

// Workgroup memory: one value every invocation of the workgroup agrees on.
let leader: workgroup<u32>
let tile: workgroup<array<u32, 64>>

@compute([64, 1, 1])
export function cs(
  @builtin("global_invocation_id") gid: vec3u,
  @builtin("local_invocation_id") lid: vec3u,
): void {
  tile[lid.x] = out[gid.x]
  workgroupBarrier()

  // One invocation wins the claim; the others learn they lost from the same call. The result
  // struct is bound by inference — its type has no name to write.
  const claim = atomicCompareExchangeWeak(claimed, 0, gid.x + 1)
  if (claim.exchanged) {
    leader = lid.x
  }
  workgroupBarrier()

  // Every invocation reads the SAME leader, with a barrier on each side of the read. Outside
  // any branch, because that is what "uniform control flow" means.
  //
  // NOT named `shared`: that is a WGSL reserved keyword, and this surface does not rename an
  // author's local to avoid one — the compile gate caught `'shared' is a reserved keyword`
  // from Tint with no diagnostic from the compiler first. See the note in the CHANGELOG.
  const agreed: u32 = workgroupUniformLoad(leader)

  // Orders this workgroup's writes to the texture address space. Nothing here writes a
  // texture; the barrier is legal and meaningful on its own, which is what the surface has to
  // allow, and Tint compiles it in a compute entry with no storage texture in sight.
  textureBarrier()

  out[gid.x] = tile[lid.x] + agreed + claim.old_value
}
