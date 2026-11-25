import { describe, expect, it } from 'vitest';
import { emitModuleAt } from '../../../../core/backends/wgsl.js';
import { bothTake } from '../../../../core/testing/both-halves.js';
import { uninlined } from '../../../../core/testing/keep-helpers.js';

const take = (source: string) => uninlined(() => bothTake(source));
const o1 = (source: string): string => emitModuleAt(take(source).result.module, 'O1');

const ENTRY = `@fragment export function fs(uv: location<0, vec2>): vec4 {`;

describe('a method that changes its object', () => {
  const source = `"use typeshade"
class Rng {
  state: u32 = 1;
  next(): f32 {
    this.state = this.state * 1664525 + 1013904223;
    return f32(this.state) * 0.0000001;
  }
  skip(): void { this.state += 1; }
  peek(): u32 { return this.state; }
}
${ENTRY}
  let g = new Rng();
  g.skip();
  return vec4(vec2(g.next(), g.next()), f32(g.peek()), 1.);
}
`;

  it('takes its object by reference and a method that only reads takes it by value', () => {
    const w = o1(source);
    expect(w).toContain('fn Rng_next(self_: ptr<function, Rng>) -> f32 {');
    expect(w).toContain('fn Rng_skip(self_: ptr<function, Rng>) {');
    expect(w).toContain('fn Rng_peek(self_: ptr<function, Rng>) -> u32 {');
    expect(w).toContain('(*self_).state += 1u;');
    expect(w).toContain('Rng_skip(&g);');
  });

  it('is inout on GLSL ES 3.00', () => {
    const glsl = take(source).result.glsl?.fragment ?? '';
    expect(glsl).toContain('float Rng_next(inout Rng self_) {');
    expect(glsl).toContain('void Rng_skip(inout Rng self_) {');
  });

  it('returns a value that a larger expression reads in source order', () => {
    const w = o1(source);
    expect(w).toContain(
      'let _seq0 = Rng_next(&g);\n  let _seq1 = Rng_next(&g);\n  return vec4<f32>(vec2<f32>(_seq0, _seq1)',
    );
  });
});

describe('a constructor', () => {
  const source = `"use typeshade"
class Ray {
  o: vec3;
  hits: u32 = 0;
  k: f32 = f32(this.hits) * 2.;
  constructor(public x: f32, o: vec3) { this.o = o; }
}
${ENTRY}
  const r = new Ray(1., vec3(uv, 0.));
  return vec4(r.o, r.k + r.x);
}
`;

  it('starts from the zero struct, then the parameter properties, the initializers, the body', () => {
    const w = o1(source);
    expect(w).toContain(
      '(*_dst) = Ray(vec3<f32>(0.0, 0.0, 0.0), 0u, 0.0, 0.0);\n' +
        '  (*_dst).x = x;\n' +
        '  (*_dst).hits = 0u;\n' +
        '  (*_dst).k = (f32((*_dst).hits) * 2.0);\n' +
        '  (*_dst).o = o;\n}',
    );
  });

  it('spells the zero of a vector, an array and a nested struct, so GLSL starts at zero too', () => {
    const taken = take(`"use typeshade"
class Inner { w: f32; b: bool; i: i32; }
class Pt { a: f32; v: vec3; arr: array<f32, 2>; inner: Inner; }
${ENTRY}
  const p = new Pt();
  return vec4(p.a, p.v.x, f32(p.inner.i), f32(p.arr[1]));
}
`);
    const w = emitModuleAt(taken.result.module, 'O1');
    const glsl = taken.result.glsl?.fragment;
    expect(w).toContain(
      '(*_dst) = Pt(0.0, vec3<f32>(0.0, 0.0, 0.0), array<f32, 2>(0.0, 0.0), Inner(0.0, false, 0));',
    );
    expect(glsl).toContain(
      'return Pt(0.0, vec3(0.0, 0.0, 0.0), float[2](0.0, 0.0), Inner(0.0, false, 0));',
    );
  });

  it('leaves a struct with a matrix field to the target zero-initialization', () => {
    const w = o1(`"use typeshade"
class Mt { a: f32; m: mat2x2<f32>; }
${ENTRY}
  const m = new Mt();
  return vec4(m.a);
}
`);
    expect(w).toContain('fn Mt_new() -> Mt {\n  var self_: Mt;\n  return self_;\n}');
  });
});

describe('a default argument', () => {
  const source = `"use typeshade"
class Ray {
  constructor(public o: vec3) {}
  at(t: f32, s: f32 = 2.): vec3 { return this.o * t * s; }
  static scale(a: f32, b: f32 = 3.): f32 { return a * b; }
}
${ENTRY}
  const r = new Ray(vec3(uv, 0.));
  return vec4(r.at(1.).x + Ray.scale(2.));
}
`;

  it('sits after the object of a method and at its own index in a static function', () => {
    const w = o1(source);
    expect(w).toContain('Ray_at(&r, 1.0, 2.0)');
    expect(w).toContain('Ray_scale(2.0, 3.0)');
  });
});
