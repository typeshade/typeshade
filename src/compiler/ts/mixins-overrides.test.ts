import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { compileTsSource } from './source-file.js';
import { itNoInlining } from '../../core/testing/no-inlining-test.js';

const errorsOf = (src: string) =>
  compileTsSource(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => d.message);

const FS = `@fragment export function fs(): vec4 {
  return vec4(1.)
}
`;

describe('a name declared twice in the chain is an override, closest to the value winning', () => {
  itNoInlining('the applying class overrides a mixin method, silently', () => {
    const r = compile(`"use typeshade";
class Particle {
  pos: vec3;
}
function Aged<TBase extends AnyClass>(Base: TBase) {
  return class extends Base {
    age: f32;
    faded(): f32 {
      return 1. - this.age;
    }
  };
}
class Body extends Aged(Particle) {
  mass: f32;
  faded(): f32 {
    return 0.5;
  }
}
@fragment export function fs(): vec4 {
  const b = new Body();
  return vec4(b.faded(), b.mass, 0., 1.);
}
`);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain(
      'fn Body_faded(self_: ptr<function, Body>) -> f32 {\n  return 0.5;\n}',
    );
  });

  itNoInlining('an outer mixin overrides an inner one', () => {
    const r = compile(`"use typeshade";
class Particle {
  pos: vec3;
}
function A<TBase extends AnyClass>(Base: TBase) {
  return class extends Base {
    v: f32;
    pick(): f32 {
      return 1.;
    }
  };
}
function B<TBase extends AnyClass>(Base: TBase) {
  return class extends Base {
    pick(): f32 {
      return 2.;
    }
  };
}
class Body extends B(A(Particle)) {}
@fragment export function fs(): vec4 {
  const b = new Body();
  return vec4(b.pick(), b.v, 0., 1.);
}
`);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('fn Body_pick(self_: ptr<function, Body>) -> f32 {\n  return 2.0;\n}');
  });

  it('says so when two mixins give one field two types', () => {
    // The one collision that is not an override but a change of layout: picking either
    // silently would change what the other's code reads.
    expect(
      errorsOf(`"use typeshade"
class Particle {
  pos: vec3
}
function A<TBase extends AnyClass>(Base: TBase) {
  return class extends Base {
    v: f32
  }
}
function B<TBase extends AnyClass>(Base: TBase) {
  return class extends Base {
    v: vec3
  }
}
class Body extends B(A(Particle)) {
  mass: f32
}
${FS}`),
    ).toEqual([
      '"Body" gets the field "v" twice through its mixins, written "f32" in one and "vec3" ' +
        'in another. One of them decides the layout, and picking either silently would ' +
        "change what the other's code reads. Give them one type, or two names.",
    ]);
  });
});
