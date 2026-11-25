import { describe, expect, it } from 'vitest';
import { emitModuleAt } from '../../../../core/backends/wgsl.js';
import { bothRefuse, bothTake } from '../../../../core/testing/both-halves.js';
import { uninlined } from '../../../../core/testing/keep-helpers.js';

const o1 = (source: string): string =>
  emitModuleAt(uninlined(() => bothTake(source)).result.module, 'O1');

describe('a call that names a namespace', () => {
  const source = `"use typeshade";
namespace A {
  export namespace B {
    export function two(): f32 { return 2.; }
    export function gen<T>(x: T): T { return x; }
  }
  export function one(): f32 { return B.two() + B.gen(1.); }
  export class P {
    x: f32 = 1.;
    m(): f32 { return A.B.two(); }
  }
  export function mk(): P { return new P(); }
}
@fragment export function fs(): vec4 {
  const p = new A.P();
  return vec4(A.one(), A.B.two(), p.m(), A.mk().x);
}
`;

  it('joins a chain of names, and reads a member namespace by its short name inside', () => {
    const w = o1(source);
    expect(w).toContain('return (A_B_two() + A_B_gen_f32(1.0));');
    expect(w).toContain('fn A_P_m(self_: ptr<function, A_P>) -> f32 {\n  return A_B_two();');
    expect(w).toContain('vec4<f32>(A_one(), A_B_two(),');
    expect(w).toContain('fn A_mk() -> A_P {\n  return A_P_new();');
  });

  it('makes a generic member and a member that takes a function for the call', () => {
    const w = o1(`"use typeshade";
namespace A {
  export function ap(f: (v: f32) => f32): f32 { return f(1.); }
}
@fragment export function fs(): vec4 { return vec4(A.ap((v: f32) => v * 2.), 0., 0., 1.); }
`);
    expect(w).toContain('fn A_ap_fs_f() -> f32 {\n  return fs_f(1.0);');
    expect(w).not.toContain('fn A_ap(');
  });
});

describe('a call that names a namespace member that is not there', () => {
  it('names the function the unknown name is spelled like', () => {
    bothRefuse(
      `"use typeshade";
namespace Shapes { export function circle(): f32 { return 1.; } }
@fragment export function fs(): vec4 { return vec4(Shapes.circel(), 0., 0., 1.); }
`,
      'TS8035',
      '"Shapes" has no function "circel". Did you mean "circle"?',
    );
  });

  it('adds nothing for a member whose declaration was refused', () => {
    bothRefuse(
      `"use typeshade";
namespace A { export function bad(p: Foo): f32 { return 1.; } }
@fragment export function fs(): vec4 { return vec4(A.bad(1.), 0., 0., 1.); }
`,
      'TS8002',
      'Unknown type "Foo". Declare it in this file, or import it from another shader module.',
    );
  });
});
