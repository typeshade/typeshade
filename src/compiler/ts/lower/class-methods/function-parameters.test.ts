import { describe, expect, it } from 'vitest';
import { emitModuleAt } from '../../../../core/backends/wgsl.js';
import { bothTake } from '../../../../core/testing/both-halves.js';
import { uninlined } from '../../../../core/testing/keep-helpers.js';

const o1 = (source: string): string =>
  emitModuleAt(uninlined(() => bothTake(source)).result.module, 'O1');

describe('a method, a static function and a constructor that take a function', () => {
  const w = o1(`"use typeshade";
class A {
  x: f32 = 1.;
  constructor(f: (v: f32) => f32) { this.x = f(2.); }
  apply(f: (v: f32) => f32): f32 { return f(this.x); }
  bump(f: (v: f32) => f32): void { this.x = f(this.x); }
  static each(f: (v: f32) => f32, n: f32): f32 { return f(n); }
}
class B extends A { apply(f: (v: f32) => f32): f32 { return super.apply(f) + 1.; } }
@fragment export function fs(): vec4 {
  const a = new A((v: f32) => v * 3.);
  let b = new B((v: f32) => v + 1.);
  b.bump((v: f32) => v * 2.);
  return vec4(
    a.apply((v: f32) => v + 1.),
    A.each((v: f32) => v * 2., 3.),
    b.apply((v: f32) => v - 1.),
    1.,
  );
}
`);

  it('are compiled once for each function their calls hand them', () => {
    expect(w).toContain('fn A_new_fs_f_into(_dst: ptr<function, A>) {');
    expect(w).toContain('fn B_new_fs_f_1_into(_dst: ptr<function, B>) {');
    expect(w).toContain('fn B_bump_fs_f_2(self_: ptr<function, B>) {');
    expect(w).toContain('fn A_apply_fs_f_3(self_: ptr<function, A>) -> f32 {');
    expect(w).toContain('fn A_each_fs_f_4(n: f32) -> f32 {');
  });

  it('never emit their own stub, whose parameters are the others', () => {
    expect(w).not.toMatch(/fn A_apply\(/);
    expect(w).not.toMatch(/fn A_each\(/);
    expect(w).not.toMatch(/fn A_new(_into)?\(/);
    expect(w).not.toMatch(/fn B_bump\(/);
  });

  it('are copied for a call through super, on the object of the body that calls', () => {
    expect(w).toContain('fn B_super_A_apply_fs_f_5(self_: ptr<function, B>) -> f32 {');
    expect(w).toContain('return (B_super_A_apply_fs_f_5(self_) + 1.0);');
  });
});
