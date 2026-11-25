import { describe, expect, it } from 'vitest';
import { bothRefuse, bothTake } from '../../core/testing/both-halves.js';

const PAIR = `class Pair<T> {
  a: T;
  b: T;
  constructor(a: T, b: T) {
    this.a = a;
    this.b = b;
  }
}
`;

const structNames = (wgsl: string | undefined): string[] =>
  [...(wgsl ?? '').matchAll(/^struct (\w*Pair\w*) \{/gm)].map((m) => m[1]!);

describe('the instances of a generic class, as the file writes them', () => {
  it('emits the structs in the order the file first writes them', () => {
    const wide = bothTake(`"use typeshade";
${PAIR}@fragment export function fs(): vec4 {
  const q = new Pair<vec3>(vec3(0.), vec3(1.));
  const p = new Pair<f32>(1., 2.);
  const r = new Pair<vec3>(vec3(2.), vec3(3.));
  return vec4(q.a * p.a * r.b, 1.);
}
`);
    expect(structNames(wide.result.wgsl)).toEqual(['Pair_vec3', 'Pair_f32']);
    const narrow = bothTake(`"use typeshade";
${PAIR}@fragment export function fs(): vec4 {
  const p = new Pair<f32>(1., 2.);
  const q = new Pair<vec3>(vec3(0.), vec3(1.));
  return vec4(q.a * p.a, 1.);
}
`);
    expect(structNames(narrow.result.wgsl)).toEqual(['Pair_f32', 'Pair_vec3']);
  });

  it('resolves a short name written inside its own namespace', () => {
    const halves = bothTake(`"use typeshade";
namespace A {
  export class Pair<T> {
    a: T;
  }
  export function f(): f32 {
    const p: Pair<f32> = { a: 1. };
    return p.a;
  }
}
@fragment export function fs(): vec4 {
  return vec4(A.f());
}
`);
    expect(structNames(halves.result.wgsl)).toEqual(['A_Pair_f32']);
  });

  it('refuses a short name that two namespaces declare, and does not guess', () => {
    bothRefuse(
      `"use typeshade";
namespace A {
  export class Pair<T> {
    a: T;
  }
}
namespace B {
  export class Pair<T> {
    a: T;
  }
}
@fragment export function fs(): vec4 {
  const p: Pair<f32> = { a: 1. };
  return vec4(p.a);
}
`,
      'TS8002',
      'Type arguments are not supported yet (got "Pair<...>").',
    );
  });

  it('names an instance in a sentence as the file writes it, with its qualifiers', () => {
    bothRefuse(
      `"use typeshade";
namespace N {
  export class P<T> {
    a: T;
    constructor(a: T) {
      this.a = a;
    }
  }
  export class Q {
    x: f32 = 1.;
  }
}
@fragment export function fs(): vec4 {
  const a = new N.P<N.Q>(new N.Q());
  const b = new N.P<f32>(1.);
  const c = new N.P(2.);
  return vec4(b.a + a.a.x + c.a);
}
`,
      'TS8035',
      '"N.P" is generic and this file writes it at 2 sets of type arguments ' +
        '(N.P<N.Q>, N.P<f32>), so "new N.P(…)" does not say which one to build. ' +
        'Write the type argument: "new N.P<f32>(…)".',
    );
  });
});

describe('an instance named in a sentence', () => {
  it('reads as the arguments the file writes, not the emitted struct name', () => {
    bothRefuse(
      `"use typeshade";
type Wide = vec3;
class Box<T> {
  v: T;
}
class Pair<T> {
  a: T;
  constructor(a: T) {
    this.a = a;
  }
}
@fragment export function fs(): vec4 {
  const x: Box<f32> = { v: 1. };
  const a = new Pair<Box<f32>>(x);
  const d = new Pair<Wide>(vec3(0.));
  const b = new Pair<f32>(1.);
  const c = new Pair(2.);
  return vec4(b.a + a.a.v + c.a + d.a.x);
}
`,
      'TS8035',
      '"Pair" is generic and this file writes it at 3 sets of type arguments ' +
        '(Pair<Box<f32>>, Pair<Wide>, Pair<f32>), so "new Pair(…)" does not say which one to build. ' +
        'Write the type argument: "new Pair<f32>(…)".',
    );
  });
});

describe('what a use writes beyond what the class declares', () => {
  it('reports surplus type arguments of a new once', () => {
    bothRefuse(
      `"use typeshade";
class Pair<T> {
  a: T;
  constructor(a: T) {
    this.a = a;
  }
}
@fragment export function fs(): vec4 {
  const p = new Pair<f32, f32>(1.);
  return vec4(p.a);
}
`,
      'TS8019',
      '"Pair" takes 1 type argument(s), got 2.',
    );
  });

  it('reports a type argument that names nothing once for each annotation, and no struct', () => {
    const sentence =
      'Unknown type "Nope". Declare it in this file, or import it from another shader module.';
    const halves = bothRefuse(
      `"use typeshade";
class Pair<T> {
  a: T;
}
@fragment export function fs(): vec4 {
  const p: Pair<Nope> = { a: 1. };
  const q: Pair<Nope> = { a: 1. };
  return vec4(0.);
}
`,
      'TS8002',
      [sentence, sentence],
    );
    expect(halves.compiler.join('\n')).not.toContain('Pair_');
  });
});
