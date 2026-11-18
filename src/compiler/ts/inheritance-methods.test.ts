import { describe, expect } from 'vitest';
import { compile } from './compile.js';
import { compileModule } from '../../core/oracle.js';
import { compileModuleJs } from '../../core/cpu-codegen.js';
import { itNoInlining } from '../../core/testing/no-inlining-test.js';

const agree = (r: ReturnType<typeof compile>, expected: number[]): void => {
  for (const make of [compileModule, compileModuleJs]) {
    expect(make(r.module).fns['fs']!(), make.name).toEqual(expected);
  }
};

const file = (head: string, body: string) => `"use typeshade"
${head}@fragment export function fs(): vec4 {
${body}
}
`;

describe('a method is inherited by being lowered again', () => {
  itNoInlining('into the derived class, and an override wins', () => {
    const r = compile(
      file(
        `class Base {
  x: f32
  twice(): f32 {
    return this.x * 2.
  }
  v(): f32 {
    return this.x
  }
}
class Derived extends Base {
  y: f32
  v(): f32 {
    return this.x + this.y
  }
}
`,
        `  const d: Derived = { x: 1., y: 2. }\n  return vec4(d.twice(), d.v(), 0., 1.)`,
      ),
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('fn Derived_twice(self_: ptr<function, Derived>) -> f32 {');
    expect(r.wgsl).toContain('fn Base_twice(self_: Base) -> f32 {');
    agree(r, [2, 3, 0, 1]);
  });

  itNoInlining('so an inherited body calls the override, which is what TypeScript does', () => {
    const r = compile(
      file(
        `abstract class Shape {
  k: f32
  abstract area(): f32
  scaled(): f32 {
    return this.area() * this.k
  }
}
class Square extends Shape {
  s: f32
  area(): f32 {
    return this.s * this.s
  }
}
class Circle extends Shape {
  r: f32
  area(): f32 {
    return 3. * this.r * this.r
  }
}
`,
        `  const q: Square = { k: 2., s: 3. }\n  const c: Circle = { k: 1., r: 2. }\n  return vec4(q.scaled(), c.scaled(), 0., 1.)`,
      ),
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('return (Square_area(self_) * (*self_).k);');
    expect(r.wgsl).toContain('return (Circle_area(self_) * (*self_).k);');
    expect(r.wgsl).not.toContain('fn Shape_scaled');
    agree(r, [18, 12, 0, 1]);
  });

  itNoInlining('and a static function and a field initializer come down too', () => {
    const r = compile(
      file(
        `class Base {
  x: f32 = 4.
  static unit(): f32 {
    return 1.
  }
}
class Derived extends Base {
  y: f32
}
`,
        `  const d = new Derived()\n  return vec4(Derived.unit(), Base.unit(), d.x, 1.)`,
      ),
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('fn Derived_unit() -> f32 {');
    agree(r, [1, 1, 4, 1]);
  });
});
