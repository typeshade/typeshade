import { describe, expect, it } from 'vitest';
import { emitModuleAt } from '../../../../core/backends/wgsl.js';
import { bothTake } from '../../../../core/testing/both-halves.js';
import { uninlined } from '../../../../core/testing/keep-helpers.js';

const o1 = (source: string): string =>
  emitModuleAt(uninlined(() => bothTake(source)).result.module, 'O1');

const ENTRY = `@fragment export function fs(uv: location<0, vec2>): vec4 {`;

const bodyOf = (wgsl: string, name: string): string[] => {
  const start = wgsl.indexOf(`fn ${name}(`);
  const end = wgsl.indexOf('\n}', start);
  return wgsl
    .slice(start, end)
    .split('\n')
    .slice(1)
    .map((line) => line.trim());
};

describe('the order a constructor builds its object in', () => {
  const noBaseConstructor = `"use typeshade"
class A { a: f32 = 1.; n: f32 = 1.; }
class B extends A {
  b: f32 = this.a + 10.;
  n: f32 = 5.;
  w: f32 = 0.;
  constructor(public x: f32) { super(); this.w = 9.; }
  c: f32 = 4.;
}
class C extends B { cc: f32 = 7.; }
${ENTRY}
  const b = new B(2.);
  const c = new C(3.);
  return vec4(b.a, b.b, b.c, b.n + c.cc + b.w);
}
`;

  it('runs the base initializers, the parameter properties, the own initializers, the body', () => {
    expect(bodyOf(o1(noBaseConstructor), 'B_new_into')).toEqual([
      '(*_dst) = B(0.0, 0.0, 0.0, 0.0, 0.0, 0.0);',
      '(*_dst).a = 1.0;',
      '(*_dst).n = 1.0;',
      '(*_dst).x = x;',
      '(*_dst).b = ((*_dst).a + 10.0);',
      '(*_dst).n = 5.0;',
      '(*_dst).w = 0.0;',
      '(*_dst).c = 4.0;',
      '(*_dst).w = 9.0;',
    ]);
  });

  it('runs the initializers of a class below the constructor when its body returns', () => {
    expect(bodyOf(o1(noBaseConstructor), 'C_new_into').slice(-3)).toEqual([
      '(*_dst).c = 4.0;',
      '(*_dst).w = 9.0;',
      '(*_dst).cc = 7.0;',
    ]);
  });

  const withBaseConstructor = `"use typeshade"
class A {
  a: f32 = 1.;
  constructor(public p: f32) { this.a = p + 1.; }
}
class B extends A {
  b: f32 = this.a + 10.;
  q: f32 = 0.;
  constructor(public x: f32) { super(x * 2.); this.q = 3.; }
  c: f32 = 4.;
}
class C extends B { cc: f32 = 7.; }
${ENTRY}
  const b = new B(2.);
  const c = new C(3.);
  return vec4(b.a, b.b, b.c, b.q + c.cc);
}
`;

  it('runs the base constructor first, then the parameter properties and own initializers', () => {
    expect(bodyOf(o1(withBaseConstructor), 'B_new_into')).toEqual([
      '(*_dst) = B(0.0, 0.0, 0.0, 0.0, 0.0, 0.0);',
      'var _sup: A;',
      'A_new_into(&_sup, (x * 2.0));',
      '(*_dst).a = _sup.a;',
      '(*_dst).p = _sup.p;',
      '(*_dst).x = x;',
      '(*_dst).b = ((*_dst).a + 10.0);',
      '(*_dst).q = 0.0;',
      '(*_dst).c = 4.0;',
      '(*_dst).q = 3.0;',
    ]);
  });

  it('gives a class without a constructor the constructor of the nearest base', () => {
    const w = o1(withBaseConstructor);
    expect(w).toContain('fn C_new_into(_dst: ptr<function, C>, x: f32) {');
    expect(bodyOf(w, 'C_new_into')).toContain('A_new_into(&_sup, (x * 2.0));');
    expect(bodyOf(w, 'C_new_into').slice(-2)).toEqual(['(*_dst).q = 3.0;', '(*_dst).cc = 7.0;']);
  });

  it('runs the parameter properties of an inherited constructor before the initializers of a derived class', () => {
    const w = o1(`"use typeshade"
class A { constructor(public p: f32) {} }
class B extends A { k: f32 = 2.; }
${ENTRY}
  const b = new B(1.);
  return vec4(b.p, b.k, 0., 1.);
}
`);
    expect(bodyOf(w, 'B_new_into')).toEqual([
      '(*_dst) = B(0.0, 0.0);',
      '(*_dst).p = p;',
      '(*_dst).k = 2.0;',
    ]);
  });

  it('runs the initializers of a mixin first, as they are of no class in the chain', () => {
    const w = o1(`"use typeshade"
class Particle { pos: vec3; }
function Aged<TBase extends AnyClass>(Base: TBase) {
  return class extends Base {
    age: f32 = 5.;
  };
}
class Body extends Aged(Particle) {
  mass: f32 = 2.;
  constructor(public k: f32) { super(); }
}
${ENTRY}
  const b = new Body(1.);
  return vec4(b.pos, b.age + b.mass);
}
`);
    expect(bodyOf(w, 'Body_new_into').slice(1)).toEqual([
      '(*_dst).age = 5.0;',
      '(*_dst).k = k;',
      '(*_dst).mass = 2.0;',
    ]);
  });

  it('runs the initializers of a field from the base class first, so the derived one lands last', () => {
    const w = o1(`"use typeshade"
class A { n: f32 = 1.; }
class B extends A { n: f32 = 5.; }
class C extends B { constructor() { super(); } }
${ENTRY}
  const c = new C();
  return vec4(c.n, 0., 0., 1.);
}
`);
    expect(bodyOf(w, 'C_new_into')).toEqual([
      '(*_dst) = C(0.0);',
      '(*_dst).n = 1.0;',
      '(*_dst).n = 5.0;',
    ]);
  });
});
