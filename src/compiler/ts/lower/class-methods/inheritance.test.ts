import { describe, expect, it } from 'vitest';
import { emitModuleAt } from '../../../../core/backends/wgsl.js';
import { bothHalves, bothRefuse, bothTake } from '../../../../core/testing/both-halves.js';
import { uninlined } from '../../../../core/testing/keep-helpers.js';

const o1 = (source: string): string =>
  emitModuleAt(uninlined(() => bothTake(source)).result.module, 'O1');

const ENTRY = `@fragment export function fs(uv: location<0, vec2>): vec4 {`;
const functionsOf = (wgsl: string): string[] =>
  [...wgsl.matchAll(/^fn (\w+)\(/gm)].map((m) => m[1]!).sort();

describe('the bodies a class emits', () => {
  const source = `"use typeshade"
class A {
  x: f32 = 1.;
  get v(): f32 { return this.x; }
  set v(n: f32) { this.x = n; }
  go(): f32 { return this.x; }
  step(): f32 { this.x += 1.; return this.x; }
}
class B extends A {
  get v(): f32 { return this.x * 2.; }
  go(): f32 { return super.go() + 1.; }
  step(): f32 { return super.step() * 2.; }
}
class C extends B {
  go(): f32 { return super.go() + 10.; }
}
${ENTRY}
  let c = new C();
  let b = new B();
  return vec4(c.go(), b.v, c.step(), b.go());
}
`;

  it('are one for each member, the class own before the ones it inherits', () => {
    const names = functionsOf(o1(source)).filter((n) => /^[BC]_/.test(n));
    expect(names).toEqual([
      'B_get_v',
      'B_go',
      'B_new_into',
      'B_step',
      'B_super_A_go',
      'B_super_A_step',
      'C_get_v',
      'C_go',
      'C_new_into',
      'C_step',
      'C_super_A_go',
      'C_super_A_step',
      'C_super_B_go',
    ]);
  });

  it('count the super of a body from the class that wrote it, so a deep chain ends', () => {
    const w = o1(source);
    expect(w).toContain('return (C_super_B_go(self_) + 10.0);');
    expect(w).toContain(
      'fn C_super_B_go(self_: ptr<function, C>) -> f32 {\n  return (C_super_A_go(self_) + 1.0);',
    );
    expect(w).toContain('return (B_super_A_go(self_) + 1.0);');
  });

  it('give a class that overrides a getter alone no setter', () => {
    const w = o1(source);
    expect(w).toContain('fn A_set_v(');
    expect(w).not.toContain('fn B_set_v(');
    expect(w).not.toContain('fn C_set_v(');
  });

  it('refuse the assignment to a property whose nearest class declares only a getter', () => {
    const halves = bothHalves(`"use typeshade";
class A {
  x: f32 = 1.;
  get v(): f32 { return this.x; }
  set v(n: f32) { this.x = n; }
}
class B extends A { get v(): f32 { return this.x * 2.; } }
export function f(): f32 { const b = new B(); b.v = 3.; return b.x; }
`);
    const sentence =
      'typeshade TS8035: "B.v" has a getter and no setter, so it cannot be assigned. Declare "set v(value)" beside the getter.';
    expect(halves.compiler).toEqual([sentence]);
    expect(halves.editor).toContain(sentence);
  });

  it('take the object by reference when the base body that a super call names writes it', () => {
    const w = o1(source);
    expect(w).toContain('fn B_step(self_: ptr<function, B>) -> f32 {');
    expect(w).toContain('let _seq0 = B_super_A_step(self_);');
    expect(w).toContain(
      'fn B_super_A_step(self_: ptr<function, B>) -> f32 {\n  (*self_).x += 1.0;',
    );
  });
});

describe('a body of a base class lowered for a derived class', () => {
  it('calls the override of the derived class, as TypeScript does', () => {
    const w = o1(`"use typeshade"
class A { x: f32 = 1.; step(): f32 { return 1.; } run(): f32 { return this.step() + this.x; } }
class B extends A { step(): f32 { return 2.; } }
${ENTRY}
  return vec4(new A().run(), new B().run(), 0., 1.);
}
`);
    expect(w).toContain('fn A_run(self_: A) -> f32 {\n  return (A_step(self_) + self_.x);');
    expect(w).toContain('fn B_run(self_: B) -> f32 {\n  return (B_step(self_) + self_.x);');
  });

  it('is emitted for the members of a class in the order they are declared, accessors among them', () => {
    const w = o1(`"use typeshade"
class A {
  x: f32 = 1.;
  get v(): f32 { return this.x; }
  set v(n: f32) { this.x = n; }
  go(): f32 { return this.x; }
  step(): f32 { this.x += 1.; return this.x; }
}
${ENTRY}
  let a = new A();
  a.v = 2.;
  return vec4(a.v, a.go(), a.step(), 1.);
}
`);
    const order = [...w.matchAll(/^fn (A_\w+)\(/gm)].map((m) => m[1]!);
    expect(order.slice(0, 4)).toEqual(['A_get_v', 'A_set_v', 'A_go', 'A_step']);
  });

  it('names the accessor halves of the base that super reads, assigns and updates', () => {
    const w = o1(`"use typeshade"
class A { x: f32 = 1.; get v(): f32 { return this.x; } set v(n: f32) { this.x = n; } }
class B extends A {
  set v(n: f32) { super.v = n + 1.; }
  get v(): f32 { return super.v; }
  bump(): void { super.v += 1.; }
}
${ENTRY}
  let b = new B();
  b.v = 2.;
  b.bump();
  return vec4(b.v, 0., 0., 1.);
}
`);
    expect(w).toContain('fn B_super_A_set_v(self_: ptr<function, B>, n: f32) {');
    expect(w).toContain('fn B_super_A_get_v(self_: ptr<function, B>) -> f32 {');
    expect(w).toContain('return B_super_A_get_v(self_);');
  });

  it('refuses an assignment through super to a property whose half above is only a getter', () => {
    const halves = bothHalves(`"use typeshade"
class A { get v(): f32 { return 1.; } }
class B extends A { set v(n: f32) { super.v = n; } }
${ENTRY}
  let b = new B();
  b.v = 2.;
  return vec4(1., 0., 0., 1.);
}
`);
    const line =
      'typeshade TS8035: "super.v" has a getter and no setter above this class, so it cannot be assigned.';
    expect(halves.compiler).toEqual([line]);
    expect(halves.editor).toContain(line);
  });
});

describe('a constructor that names a base body through super', () => {
  it('emits the base body against its own class and calls it on the object it builds', () => {
    const w = o1(`"use typeshade"
class A { x: f32 = 1.; reset(): void { this.x = 0.; } }
class B extends A { y: f32 = 2.; constructor() { super(); super.reset(); } }
${ENTRY}
  const b = new B();
  return vec4(b.x, b.y, 0., 1.);
}
`);
    expect(w).toContain('fn B_super_A_reset(self_: ptr<function, B>) {\n  (*self_).x = 0.0;\n}');
    expect(w).toContain('(*_dst).y = 2.0;\n  B_super_A_reset(_dst);');
  });
});

describe('an abstract class with a constructor', () => {
  it('keeps the constructor that a super call of a derived class reaches', () => {
    const w = o1(`"use typeshade"
abstract class S { k: f32 = 1.; constructor(public p: f32) { } abstract area(): f32; }
class Q extends S { constructor() { super(3.); } area(): f32 { return this.p; } }
${ENTRY}
  return vec4(new Q().area(), 0., 0., 1.);
}
`);
    expect(w).toContain('fn S_new_into(_dst: ptr<function, S>, p: f32) {');
  });

  it('keeps the constructor of an abstract class reached through an abstract intermediate class', () => {
    const w = o1(`"use typeshade"
abstract class S { k: f32 = 1.; constructor(public p: f32) { } area(): f32 { return this.p; } }
abstract class M extends S { }
class Q extends M { constructor() { super(3.); } }
${ENTRY}
  return vec4(new Q().area(), 0., 0., 1.);
}
`);
    expect(w).toContain('fn M_new_into(_dst: ptr<function, M>, p: f32) {');
    expect(w).toContain('fn S_new(p: f32) -> S {');
  });

  it('gives no instance method of its own, and lowers its bodies into each concrete class', () => {
    const w = o1(`"use typeshade"
abstract class S { k: f32 = 1.; abstract area(): f32; double(): f32 { return this.area() * 2.; } }
class Q extends S { area(): f32 { return 4.; } }
${ENTRY}
  return vec4(new Q().double(), 0., 0., 1.);
}
`);
    expect(w).toContain('fn Q_double(');
    expect(w).not.toContain('fn S_double(');
    expect(w).not.toContain('fn S_area(');
    expect(w).not.toContain('fn S_new');
  });
});

describe('the names of the bodies a class inherits', () => {
  it('hold one underscore between the parts, since GLSL ES reserves two in a row', () => {
    const glsl = uninlined(() =>
      bothTake(`"use typeshade"
class A { go(): f32 { return 1.; } }
class B extends A { go(): f32 { return super.go() + 1.; } }
${ENTRY}
  return vec4(new B().go(), 0., 0., 1.);
}
`),
    ).result.glsl?.fragment;
    expect(glsl).toContain('B_super_A_go');
    expect(glsl).not.toContain('__');
  });
});

describe('a method that returns this', () => {
  it('returns the derived class when a derived class inherits it, written or inferred', () => {
    const w = o1(`"use typeshade"
class V {
  x: f32 = 0.;
  y: f32 = 0.;
  setX(x: f32) { this.x = x; return this; }
  setY(y: f32): this { this.y = y; return this; }
}
class W extends V {
  z: f32 = 0.;
  setZ(z: f32) { this.z = z; return this; }
}
${ENTRY}
  let w = new W();
  w.setX(1.).setY(2.).setZ(3.);
  return vec4(w.x, w.y, w.z, 1.);
}
`);
    expect(w).toContain('W_setX(&w, 1.0);\n  W_setY(&w, 2.0);\n  W_setZ(&w, 3.0);');
    expect(w).toContain('fn V_setX(self_: ptr<function, V>, x: f32) -> V {');
    expect(w).toContain('fn W_setX(self_: ptr<function, W>, x: f32) -> W {');
    expect(w).toContain('fn W_setY(self_: ptr<function, W>, y: f32) -> W {');
    expect(w).toContain('fn W_setZ(self_: ptr<function, W>, z: f32) -> W {');
  });

  it('returns the derived class when the method writes the base class by name', () => {
    const w = o1(`"use typeshade"
class V {
  y: f32 = 0.;
  setY(y: f32): V { this.y = y; return this; }
}
class W extends V { z: f32 = 0.; }
${ENTRY}
  let w = new W();
  w.setY(2.);
  return vec4(w.y, w.z, 0., 1.);
}
`);
    expect(w).toContain('fn W_setY(self_: ptr<function, W>, y: f32) -> W {');
  });
});

describe('a private member', () => {
  it('is never overridden: a second #m in the chain is reported', () => {
    bothRefuse(
      `"use typeshade";
class A { #m(): f32 { return 1.; } }
class B extends A { #m(): f32 { return 2.; } }
export function f(): f32 { return 1.; }
`,
      'TS8035',
      '"B.#m" and "A.#m" would both be the function "B_m": a private name is emitted without its "#". Rename one of them.',
    );
  });

  it('collides with a public static that would take its function name', () => {
    bothRefuse(
      `"use typeshade";
class A { static #n(): f32 { return 1.; } }
class B extends A { static n(): f32 { return 1.; } }
export function f(): f32 { return 1.; }
`,
      'TS8035',
      '"B.n" and "A.#n" would both be the function "B_n": a private name is emitted without its "#". Rename one of them.',
    );
  });

  it('collides with a static field that is the module value of the same name', () => {
    bothRefuse(
      `"use typeshade";
class D { static K: f32 = 1.; K(): f32 { return 1.; } }
export function f(): f32 { return 1.; }
`,
      'TS8035',
      'The static field "D.K" and the function "D.K" would both be "D_K", where a class names its functions and its statics alike. Rename one of them.',
    );
    bothRefuse(
      `"use typeshade";
class D { static #K: f32 = 1.; K(): f32 { return 1.; } }
export function f(): f32 { return 1.; }
`,
      'TS8035',
      'The static field "D.#K" and the function "D.K" would both be "D_K": a private name is emitted without its "#". Rename one of them.',
    );
  });
});
