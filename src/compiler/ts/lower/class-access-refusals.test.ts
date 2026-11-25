import { describe, expect, it } from 'vitest';
import { bothHalves, bothRefuse } from '../../../core/testing/both-halves.js';

const program = (classes: string, body: string): string => `"use typeshade"
${classes}
@fragment export function fs(): vec4 {
${body}
}
`;

describe('a private name is its declaring class own (Rule 8.12)', () => {
  it('a class that declares a #w of its own does not reach the #w of another', () => {
    const halves = bothHalves(
      program(
        'class A { v: f32 = 1.; get #w(): f32 { return this.v; } getW(): f32 { return this.#w; } }\n' +
          'class B { get #w(): f32 { return 2.; } m(a: A): f32 { return a.#w; } }',
        '  const b = new B();\n  return vec4(b.m(new A()), 0., 0., 1.);',
      ),
    );
    const sentence =
      'typeshade TS8035: "#w" is private to "A", and this code is outside its class body. Reach ' +
      'it through a member "A" declares without the "#".';
    expect(halves.compiler).toEqual([sentence]);
    expect(halves.editor).toContain(sentence);
  });

  it('a private method answers to its # name only, and the refusal names it', () => {
    bothRefuse(
      program(
        'class A { v: f32 = 1.; #step(): f32 { return this.v; } m(): f32 { return this.#step(); } }',
        '  const a = new A();\n  return vec4(a.step(), a.m(), 0., 1.);',
      ),
      'TS8035',
      '"A" has no method "step". Did you mean "#step"?',
    );
  });

  it('an accessor and a private one of one name say the collision once', () => {
    bothRefuse(
      program(
        'class A { v: f32 = 1.; get #x(): f32 { return 1.; } get x(): f32 { return 2.; } }',
        '  const a = new A();\n  return vec4(a.x, 0., 0., 1.);',
      ),
      'TS8035',
      'The getter "A.#x" and the getter "A.x" would be emitted under one name. Rename one of them.',
    );
  });
});

describe('a getter returns a copy, and one that changes its object needs a place (Rule 8.11)', () => {
  it('a getter that fills a cache is refused on a value that is dropped', () => {
    bothRefuse(
      program(
        'class A { v: f32 = 2.; c: f32 = 0.; get d(): f32 { this.c = this.v * 2.; return this.c; } }',
        '  return vec4(new A().d, 0., 0., 1.);',
      ),
      'TS8035',
      '"A.d" changes its object, and this one is a value that is dropped; keep it in a let and ' +
        'call the method on that.',
    );
  });

  it('a write into the element of what a getter returns is refused, as the copy is lost', () => {
    bothRefuse(
      program(
        'class A { p: array<f32, 2> = array<f32, 2>(1., 2.); get q(): array<f32, 2> { return this.p; } }',
        '  const a = new A();\n  a.q[1] = 5.;\n  return vec4(a.p[1], 0., 0., 1.);',
      ),
      'TS8018',
      '"a.q[1]" writes into what the getter "A.q" returns, which is a copy, so the write would be ' +
        'lost. Assign the whole property, or add a method that changes the field.',
    );
  });
});
