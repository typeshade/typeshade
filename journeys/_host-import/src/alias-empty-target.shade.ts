"use typeshade";

class AliasUnusedValues {
  value: f32;
}
declare const aliasEmptyUnused: uniform<AliasUnusedValues>;

// No reached authored bindings: retaining the unused uniform must not undo change 0125.
@fragment
export function aliasEmpty(p: builtin<"position">): vec4 {
  return vec4(p.x / 32., p.y / 32., 0.25, 1.);
}
