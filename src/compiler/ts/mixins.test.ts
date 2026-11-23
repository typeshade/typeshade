// The mixin pattern (roadmap 0.3 item T8, #92): `class Body extends Aged(Particle) { … }`, a
// class whose base is decided by running a function.
//
// TypeScript runs that function at run time and gets a constructor. There is no run time here,
// so it runs when the file is compiled and gives a list of members. What makes that work is
// what T5 settled: a TypeShade struct is flat, and dispatch is static. `Aged(Particle)` has no
// layout a value can have and no method anything calls through, so it is not a struct of its
// own; its members are spliced into the class that applied it, behind the base's and ahead of
// that class's own — the order TypeScript's own mixin produces.
//
// Before this, `extends Aged(Particle)` was "a base has to be a declared class or interface
// here", and the mixin function itself was "TS8099 Unsupported expression" on its class.
//
// The mixins below are written the way `tsc` accepts one — `<TBase extends AnyClass>` — because
// that is the way a developer has to write it. `AnyClass` is the ambient lib's name for the
// constructor type TypeScript needs to take `class extends Base`; a mixin declaring its own,
// as the TypeScript handbook does, reads the same to this compiler, which never looks at the
// constraint. `ambient.test.ts` is what checks the spelling against `tsc`, through
// `examples/mixin-surface.shade.ts`.

import { describe, expect, it } from 'vitest';
import { bothHalves, bothTake } from '../../core/testing/both-halves.js';
import { keepHelpers } from '../../core/testing/keep-helpers.js';

describe('a mixin is a function that returns a class, run when the file is compiled', () => {
  it(
    'splices its fields behind the base and ahead of the class that applied it',
    keepHelpers(() => {
      const r = bothTake(`"use typeshade";
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
}
@fragment export function fs(): vec4 {
  const b = new Body();
  return vec4(b.pos, b.faded() + b.mass);
}
`).result;
      expect(r.diagnostics).toEqual([]);
      expect(r.wgsl).toContain('struct Body {\n  pos: vec3<f32>,\n  age: f32,\n  mass: f32,\n}');
      // The mixin's method is the applying class's, named for it: there is no
      // `Aged(Particle)` for a function to belong to.
      expect(r.wgsl).toContain('fn Body_faded(self_: ptr<function, Body>) -> f32 {');
      expect(r.wgsl).not.toContain('fn Aged');
    }),
  );

  it('chains, innermost first', () => {
    const r = bothTake(`"use typeshade";
class Particle {
  pos: vec3;
}
function Aged<TBase extends AnyClass>(Base: TBase) {
  return class extends Base {
    age: f32;
  };
}
function Named<TBase extends AnyClass>(Base: TBase) {
  return class extends Base {
    tag: u32;
  };
}
class Body extends Named(Aged(Particle)) {
  mass: f32;
}
@fragment export function fs(): vec4 {
  const b = new Body();
  return vec4(b.pos.x, b.age, f32(b.tag), b.mass);
}
`).result;
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain(
      'struct Body {\n  pos: vec3<f32>,\n  age: f32,\n  tag: u32,\n  mass: f32,\n}',
    );
  });

  it('takes no base at all, which is a mixin that only adds', () => {
    const r = bothTake(`"use typeshade";
function Tagged() {
  return class {
    tag: u32;
  };
}
class Body extends Tagged() {
  mass: f32;
}
@fragment export function fs(): vec4 {
  const b = new Body();
  return vec4(f32(b.tag), b.mass, 0., 1.);
}
`).result;
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('struct Body {\n  tag: u32,\n  mass: f32,\n}');
  });

  it('is applied through a const, the spelling the TypeScript handbook uses', () => {
    const r = bothTake(`"use typeshade";
class Particle {
  pos: vec3;
}
function Aged<TBase extends AnyClass>(Base: TBase) {
  return class extends Base {
    age: f32;
  };
}
const AgedParticle = Aged(Particle);
class Body extends AgedParticle {
  mass: f32;
}
@fragment export function fs(): vec4 {
  const b = new Body();
  return vec4(b.pos.x, b.age, b.mass, 1.);
}
`).result;
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('struct Body {\n  pos: vec3<f32>,\n  age: f32,\n  mass: f32,\n}');
    // The const holds a class, not a value: it is no module constant.
    expect(r.wgsl).not.toContain('AgedParticle');
  });

  it('reads the mixin wherever it is written, above or below its use; the editor disagrees with compile(): it refuses the use of Particle before its declaration (2449)', () => {
    const halves = bothHalves(`"use typeshade";
class Body extends Aged(Particle) {
  mass: f32;
}
class Particle {
  pos: vec3;
}
function Aged<TBase extends AnyClass>(Base: TBase) {
  return class extends Base {
    age: f32;
  };
}
@fragment export function fs(): vec4 {
  const b = new Body();
  return vec4(b.pos.x, b.age, b.mass, 1.);
}
`);
    const r = halves.result;
    expect(halves.editor, 'the editor disagrees with compile()').toEqual([
      "typescript 2449: Class 'Particle' used before its declaration.",
    ]);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('struct Body {\n  pos: vec3<f32>,\n  age: f32,\n  mass: f32,\n}');
  });
});

describe('what a mixin may carry', () => {
  it(
    'a constructor, including one that calls super over a base that has one; the editor disagrees with compile(): it refuses the mixin constructor and the base types (2545, 2417, 2510, 2339)',
    keepHelpers(() => {
      const halves = bothHalves(`"use typeshade";
class Particle {
  pos: vec3;
  constructor(p: vec3) {
    this.pos = p;
  }
}
function Aged<TBase extends AnyClass>(Base: TBase) {
  return class extends Base {
    age: f32;
    constructor(p: vec3, a: f32) {
      super(p);
      this.age = a;
    }
  };
}
class Body extends Aged(Particle) {}
@fragment export function fs(): vec4 {
  const b = new Body(vec3(1.), 0.5);
  return vec4(b.pos, b.age);
}
`);
      const r = halves.result;
      expect(halves.editor, 'the editor disagrees with compile()').toEqual([
        "typescript 2545: A mixin class must have a constructor with a single rest parameter of type 'any[]'.",
        "typescript 2417: Class static side 'typeof Body' incorrectly extends base class static side '{ prototype: Aged<any>.(Anonymous class); } & typeof Particle'.\n  Types of property 'prototype' are incompatible.\n    Type 'Body' is not assignable to type 'Aged<any>.(Anonymous class) & Particle'.\n      Property 'pos' is missing in type 'Body' but required in type 'Particle'.",
        'typescript 2510: Base constructors must all have the same return type.',
        "typescript 2339: Property 'pos' does not exist on type 'Body'.",
      ]);
      expect(r.diagnostics).toEqual([]);
      // Each constructor builds into its local through a pointer (change 0105).
      expect(r.wgsl).toContain(
        'fn Body_new_into(_dst: ptr<function, Body>, p: vec3<f32>, a: f32) {',
      );
      expect(r.wgsl).toContain('var _sup: Particle;\n  Particle_new_into(&_sup, p);');
    }),
  );

  it(
    'a static function, which belongs to the applying class',
    keepHelpers(() => {
      const r = bothTake(`"use typeshade";
class Particle {
  pos: vec3;
}
function Scaled<TBase extends AnyClass>(Base: TBase) {
  return class extends Base {
    k: f32;
    static unit(): f32 {
      return 1.;
    }
  };
}
class Body extends Scaled(Particle) {}
@fragment export function fs(): vec4 {
  const b = new Body();
  return vec4(b.pos, Body.unit() + b.k);
}
`).result;
      expect(r.diagnostics).toEqual([]);
      expect(r.wgsl).toContain('fn Body_unit() -> f32 {');
    }),
  );

  it('a field with a decorator, which reaches entry I/O as any other field does; the editor disagrees with compile(): it refuses the decorator position (1206)', () => {
    const halves = bothHalves(`"use typeshade";
function WithUv() {
  return class {
    @location(0) uv: vec2;
  };
}
class Varyings extends WithUv() {
  pos: builtin<"position">;
}
@vertex export function vs(): Varyings {
  return { pos: vec4(0., 0., 0., 1.), uv: vec2(0.) };
}
@fragment export function fs(v: Varyings): vec4 {
  return vec4(v.uv, 0., 1.);
}
`);
    const r = halves.result;
    expect(halves.editor, 'the editor disagrees with compile()').toEqual([
      'typescript 1206: Decorators are not valid here.',
      'typeshade TS8028: "@location(0)" is the decorated form, which the next release refuses: write "uv: location<0, vec2>", or run "tshc migrate" (change 0111).',
    ]);
    // The decorated form is read, and warned once (TS8028, change 0111, milestone 4).
    expect(r.diagnostics.map((d) => [d.category, d.code, d.message])).toEqual([
      [
        'warning',
        'TS8028',
        '"@location(0)" is the decorated form, which the next release refuses: write "uv: location<0, vec2>", or run "tshc migrate" (change 0111).',
      ],
    ]);
    expect(r.wgsl).toContain('@location(0) uv: vec2<f32>,');
    expect(r.wgsl).toContain('@builtin(position) pos: vec4<f32>,');
  });

  it(
    'a method reading a field of the base it was mixed over; the editor disagrees with compile(): it does not see the base field on the mixin class (2339)',
    keepHelpers(() => {
      const halves = bothHalves(`"use typeshade";
class Particle {
  pos: vec3;
}
function Aged<TBase extends AnyClass>(Base: TBase) {
  return class extends Base {
    age: f32;
    faded(): vec3 {
      return this.pos * (1. - this.age);
    }
  };
}
class Body extends Aged(Particle) {
  mass: f32;
}
@fragment export function fs(): vec4 {
  const b = new Body();
  return vec4(b.faded(), b.mass);
}
`);
      const r = halves.result;
      expect(halves.editor, 'the editor disagrees with compile()').toEqual([
        "typescript 2339: Property 'pos' does not exist on type '(Anonymous class)'.",
      ]);
      expect(r.diagnostics).toEqual([]);
      expect(r.wgsl).toContain('return ((*self_).pos * (1.0 - (*self_).age));');
    }),
  );

  it('applies over an abstract base, whose abstract method the class supplies; the editor disagrees with compile(): it refuses the abstract base and the mixed-in field (2345, 2339)', () => {
    const halves = bothHalves(`"use typeshade";
abstract class Shape {
  k: f32;
  abstract area(): f32;
}
function Scaled<TBase extends AnyClass>(Base: TBase) {
  return class extends Base {
    s: f32;
  };
}
class Disc extends Scaled(Shape) {
  r: f32;
  area(): f32 {
    return this.r * this.r * this.s;
  }
}
@fragment export function fs(): vec4 {
  const d = new Disc();
  return vec4(d.area(), d.k, d.s, 1.);
}
`);
    const r = halves.result;
    expect(halves.editor, 'the editor disagrees with compile()').toEqual([
      "typescript 2345: Argument of type 'typeof Shape' is not assignable to parameter of type 'AnyClass'.\n  Cannot assign an abstract constructor type to a non-abstract constructor type.",
      "typescript 2339: Property 'k' does not exist on type 'Disc'.",
    ]);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('struct Disc {\n  k: f32,\n  s: f32,\n  r: f32,\n}');
  });
});
