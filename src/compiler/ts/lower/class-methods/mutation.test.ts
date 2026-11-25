import { describe, expect, it } from 'vitest';
import { bothRefuse, bothTake } from '../../../../core/testing/both-halves.js';
import { uninlined } from '../../../../core/testing/keep-helpers.js';

const objectModes = (source: string): Record<string, 'inout' | 'in'> => {
  const glsl = uninlined(() => bothTake(source)).result.glsl?.fragment ?? '';
  return Object.fromEntries(
    [...glsl.matchAll(/^\w+ (\w+)\((inout )?\w+ self_/gm)].map((m) => [
      m[1]!,
      m[2] === undefined ? 'in' : 'inout',
    ]),
  );
};

describe('a body that changes its object', () => {
  const modes = objectModes(`"use typeshade";
class Inner {
  n: f32 = 0.;
  bump(): void { this.n += 1.; }
  get peek(): f32 { this.n += 1.; return this.n; }
}
class Outer {
  inner: Inner = new Inner();
  items: array<Inner, 2> = array<Inner, 2>();
  k: f32 = 0.;
  viaField(): void { this.inner.bump(); }
  viaItem(i: u32): void { this.items[i].bump(); }
  viaGetter(): f32 { return this.inner.peek; }
  viaLocal(): void { const i = this.inner; i.bump(); }
  viaItemLocal(): void { const i = this.items[1]; i.bump(); }
  viaAlias(): void { const i = this.inner; i.n = 2.; }
  viaLoop(): void { for (const it of this.items) { it.bump(); } }
  incr(): void { this.k++; }
  decr(): void { --this.k; }
  pure(): f32 { return this.k; }
  viaThis(): void { this.viaField(); }
}
class Chain {
  k: f32 = 0.;
  set(v: f32) { this.k = v; return this; }
  go(): void { this.set(1.).set(2.); }
}
class D extends Outer { viaField(): void { super.viaField(); } }
function poke(c: Chain): void { c.k = 5.; }
class E { c: Chain = new Chain(); u(): void { poke(this.c); } }
@fragment export function fs(): vec4 {
  let o = new Outer();
  o.viaField(); o.viaItem(1); o.viaLocal(); o.viaItemLocal(); o.viaThis(); o.viaAlias(); o.viaLoop(); o.incr(); o.decr();
  const g = o.viaGetter();
  let c = new Chain(); c.go();
  let d = new D(); d.viaField();
  let e = new E(); e.u();
  return vec4(o.pure() + g, c.k, d.k, e.c.k);
}
`);

  it('is one that assigns a field of this, or reads a getter that does', () => {
    expect(modes['Inner_bump']).toBe('inout');
    expect(modes['Inner_get_peek']).toBe('inout');
    expect(modes['Chain_set']).toBe('inout');
    expect(modes['Outer_incr']).toBe('inout');
    expect(modes['Outer_decr']).toBe('inout');
  });

  it('is one that calls such a method on a field, an element, or a local made from them', () => {
    expect(modes['Outer_viaField']).toBe('inout');
    expect(modes['Outer_viaItem']).toBe('inout');
    expect(modes['Outer_viaLocal']).toBe('inout');
    expect(modes['Outer_viaItemLocal']).toBe('inout');
    expect(modes['Outer_viaAlias']).toBe('inout');
    expect(modes['Outer_viaLoop']).toBe('inout');
  });

  it('is one that reads a getter that changes the object of a field', () => {
    expect(modes['Outer_viaGetter']).toBe('inout');
  });

  it('is one that calls such a method on this, or on a chain through methods that return this', () => {
    expect(modes['Outer_viaThis']).toBe('inout');
    expect(modes['Chain_go']).toBe('inout');
  });

  it('is one that reaches such a base body through super, or hands this to a writing function', () => {
    expect(modes['D_viaField']).toBe('inout');
    expect(modes['D_super_Outer_viaField']).toBe('inout');
    expect(modes['E_u']).toBe('inout');
  });

  it('is not one that only reads', () => {
    expect(modes['Outer_pure']).toBe('in');
  });
});

describe('a body that changes the object of a class written after it', () => {
  it('is found whatever the order of the classes in the file', () => {
    const modes = objectModes(`"use typeshade";
class Outer {
  inner: Inner = new Inner();
  viaField(): void { this.inner.bump(); }
  viaGetter(): f32 { return this.inner.peek; }
}
class Inner {
  n: f32 = 0.;
  bump(): void { this.n += 1.; }
  get peek(): f32 { this.n += 1.; return this.n; }
}
@fragment export function fs(): vec4 {
  let o = new Outer();
  o.viaField();
  return vec4(o.viaGetter(), o.inner.n, 0., 1.);
}
`);
    expect(modes['Outer_viaField']).toBe('inout');
    expect(modes['Outer_viaGetter']).toBe('inout');
    expect(modes['Inner_bump']).toBe('inout');
  });
});

describe('a call of a method that changes its object and writes no return type', () => {
  it('has the type its body returns, lowered before the call is read', () => {
    const modes = objectModes(`"use typeshade";
class A { x: f32 = 1.; bump() { this.x += 1.; return this.x; } }
@fragment export function fs(): vec4 {
  let a = new A();
  const y = a.bump();
  return vec4(y, a.bump(), 0., 1.);
}
`);
    expect(modes['A_bump']).toBe('inout');
  });

  it('has no value when its body returns nothing, and says so', () => {
    bothRefuse(
      `"use typeshade";
class A { x: f32 = 1.; poke() { this.x += 1.; } }
@fragment export function fs(): vec4 { let a = new A(); const y = a.poke(); return vec4(a.x, 0., 0., 1.); }
`,
      'TS8035',
      '"A.poke" changes its object and returns nothing; call it on its own line.',
    );
  });
});

describe('a body that calls a method through a method that returns this', () => {
  it('changes its object when the method at the end of the chain does', () => {
    const modes = objectModes(`"use typeshade";
class Chain {
  k: f32 = 0.;
  id() { return this; }
  poke(): void { this.k = 1.; }
  go(): void { this.id().poke(); }
}
@fragment export function fs(): vec4 {
  let c = new Chain();
  c.go();
  return vec4(c.k, 0., 0., 1.);
}
`);
    expect(modes['Chain_go']).toBe('inout');
  });
});

describe('a call on this', () => {
  it('resolves to the member of the class that emits the body, not of the class that wrote it', () => {
    const modes = objectModes(`"use typeshade";
class A {
  x: f32 = 1.;
  bump(): void { this.x += 1.; }
  go(): f32 { this.bump(); return this.x; }
}
class B extends A { bump(): void { const y = this.x; } }
@fragment export function fs(): vec4 {
  let a = new A();
  let b = new B();
  return vec4(a.go(), b.go(), 0., 1.);
}
`);
    expect(modes['A_go']).toBe('inout');
    expect(modes['B_go']).toBe('in');
  });
});
