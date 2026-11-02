"use typeshade";

/* @example
{
  "title": "Subgroup reduction before an atomic",
  "blurb": "`subgroupAdd` folds each subgroup's values in one instruction and `subgroupElect` picks one lane to add the fold into the bin with `atomicAdd`: one atomic per subgroup instead of one per lane (§77, change 0117). The call derives `enable subgroups;` and the host feature. On WebGL2 and on the CPU oracle a subgroup is one invocation (Rule 11.21), so the fold is the lane's own value and the sum is the same; a compute entry with a storage buffer is WGSL-only on the gallery all the same.",
  "renderable": false,
  "reason": "missing capabilities: storageBuffer, compute"
}
*/

// The use typeshade/radiance asked for (#536): a backward pass adds each pixel's contribution
// into a splat's adjoint with an integer `atomicAdd`, and many lanes land in one bin at once.
// `subgroupAdd(x)` gives every lane of the subgroup the subgroup's sum, `subgroupElect()` is
// true in one lane of it, and that lane adds the sum once. An integer sum has one value in any
// order, so the bin holds the same total on every device and on every tier; a float fold would
// not (the determinism report lists it as `order`).
//
// `subgroup_id` and `num_subgroups` are the two built-in values WGSL added beside the pair of
// §50; both are compute inputs. On WebGL2 and on the CPU oracle a subgroup is one invocation
// (Rule 11.21): `num_subgroups` is the workgroup size, `subgroup_id` the local invocation index.
//
// Measured on Tint (Chrome for Testing 153, SwiftShader, 2026-11-02): the module compiles on a
// device that asked for `subgroups`, which the compile gate derives from the module itself;
// without the feature Tint answers "cannot call built-in function 'subgroupAdd' without
// extension 'subgroups'", which is why the call derives the capability.

declare const src: storage<array<u32>>;
declare const bins: storage<array<atomic<u32>>, "read_write">;
declare const seen: storage<array<u32>, "read_write">;

export const histogram = compute([64, 1, 1], function histogram(
  gid: builtin<"global_invocation_id", vec3u>,
  subgroup: builtin<"subgroup_id", u32>,
  subgroups: builtin<"num_subgroups", u32>,
): void {
  // A lane past the end contributes 0, so the subgroup fold stays in uniform control flow:
  // an early `return` here would be a lane the fold cannot wait for (§54).
  let x: u32 = 0;
  if (gid.x < src.length) {
    x = src[gid.x];
  }
  const total = subgroupAdd(x);
  if (subgroupElect()) {
    atomicAdd(bins[0], total);
  }
  // One word per subgroup of the workgroup: which subgroup each lane ran in.
  if (gid.x < subgroups) {
    seen[gid.x] = subgroup;
  }
});
