"use typeshade";

class Material {
  value: f32;
  constructor(value: f32) { this.value = value; }
  response(): f32 { return this.value * 2.; }
}
class LeafMaterial extends Material {
  extra: f32;
  constructor(value: f32, extra: f32) { super(value); this.extra = extra; }
  transmission(): f32 { return this.extra; }
}
class Leaf {
  material: Material;
  constructor(material: Material) { this.material = material; }
}

declare const xs: storage<array<f32>>;
declare const out: storage<array<f32>, "read_write">;

let count: f32 = 0.;
function factory(value: f32): LeafMaterial {
  count += 1.;
  return new LeafMaterial(value + count, 10.);
}
function result(first: f32, material: Material, last: f32): f32 {
  return first + material.response() + last;
}
function next(): f32 { count += 1.; return count; }

@compute([64])
export function main(@builtin("global_invocation_id") gid: vec3u): void {
  if (gid.x >= arrayLength(xs)) { return; }
  const concrete = new LeafMaterial(xs[gid.x], 10.);
  const leaf = new Leaf(concrete);
  out[gid.x] = leaf.material.response() + result(next(), factory(xs[gid.x]), next());
}
