"use typeshade";

declare const out: storage<array<f32, 6>, "read_write">;

class Hit {
  constructor(public objectIndex: i32) {}

  half(): i32 {
    return this.objectIndex / 2;
  }

  accept(index: i32): i32 {
    return index;
  }

  static wrap(index: u32): u32 {
    return index + 1;
  }
}

class DerivedHit extends Hit {}

class Scene {
  sample(): Hit {
    return new Hit(4);
  }

  read(): i32 {
    let objectIndex = -1;
    const field = this.sample();
    objectIndex = field.objectIndex;
    return new Hit(objectIndex).objectIndex;
  }
}

@compute([1])
export function main(): void {
  const signedIndex = -3;
  const unsignedIndex = 4294967295;
  out[0] = f32(new Hit(signedIndex).half());
  out[1] = f32(Hit.wrap(unsignedIndex));
  out[2] = f32(new Scene().read());
  let selectedIndex = -5;
  const selected: i32 = selectedIndex;
  out[3] = f32(selected);
  const methodIndex = -7;
  const hit = new Hit(0);
  out[4] = f32(hit.accept(methodIndex));
  const inheritedIndex = -9;
  out[5] = f32(new DerivedHit(inheritedIndex).objectIndex);
}
