"use typeshade";

class AliasValues {
  value!: f32;
}

// The unused first binding must retain slot 0 when this module is a pure alias's target.
declare const aliasUnused: uniform<AliasValues>;
declare const aliasLive: uniform<AliasValues>;
declare const aliasOut: storage<array<f32>, "read_write">;

function aliasPrivate(value: f32): f32 {
  return value + 17.;
}

const aliasHidden = compute([1], function aliasHidden(gid: builtin<"global_invocation_id", vec3u>): void {
  if (gid.x < aliasOut.length) aliasOut[gid.x] = 23.;
});

export const aliasCompute = compute([8], function aliasCompute(gid: builtin<"global_invocation_id", vec3u>): void {
  if (gid.x < aliasOut.length) aliasOut[gid.x] = f32(gid.x) * aliasLive.value + 1.;
});

export const aliasRender = fragment(function aliasRender(p: builtin<"position", vec4>): vec4 {
  return vec4(p.x / 32., p.y / 32., aliasLive.value, 1.);
});

