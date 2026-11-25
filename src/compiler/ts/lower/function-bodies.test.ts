import { describe, expect, it } from 'vitest';
import { bothHalves } from '../../../core/testing/both-halves.js';
import { uninlined } from '../../../core/testing/keep-helpers.js';

const entry = (head: string, value: string): string =>
  `"use typeshade"\n${head}\n@fragment export function fs(): vec4 { return vec4(${value}, 0., 0., 1.); }\n`;

const read = (source: string) => uninlined(() => bothHalves(source));

const wgslOf = (source: string): string => {
  const h = read(source);
  expect(h.compiler).toEqual([]);
  expect(h.editor).toEqual([]);
  return h.result.wgsl ?? '';
};

const both = (source: string, sentence: string): void => {
  const h = read(source);
  expect(h.compiler).toEqual([sentence]);
  expect(h.editor).toContain(sentence);
};

describe('what a body says of its returns', () => {
  it('names the first return and the other when an inferred result disagrees', () => {
    both(
      entry('function f(x: f32) { if (x > 0.) { return 1. } return true }', 'f(1.)'),
      'typeshade TS8003: Function "f" returns f32 at its first "return" and bool at another; a function returns one type (Rule 8.19): make them agree, or write the return type.',
    );
  });

  it('names the declared type when a written result disagrees', () => {
    both(
      entry('function f(x: f32): f32 { return true }', 'f(1.)'),
      'typeshade TS8003: Function "f" return type mismatch: declared f32, got bool.',
    );
  });

  it('refuses a bare return in a function that returns a value', () => {
    both(
      entry('function f(x: f32): f32 { if (x > 0.) { return } return 1. }', 'f(1.)'),
      'typeshade TS8021: Function "f" returns f32 but has a bare "return".',
    );
  });

  it('reports each void-function return on its own line', () => {
    const h = read(`"use typeshade";
function h(x: f32): void {
  if (x > 1.) { return 1.; }
  return 2.;
}
@fragment export function fs(): vec4 { h(1.); return vec4(0.); }
`);
    expect(h.result.diagnostics.map((d) => d.line)).toEqual([3, 4]);
    expect(h.editor.filter((l) => l.includes('returns void but returns a value'))).toHaveLength(2);
  });

  it('ends an optional result that falls off its body with the absent value', () => {
    const wgsl = wgslOf(
      entry('function open(x: f32) { if (x > 0.) { return 1. } }', '(open(1.) ?? 0.)'),
    );
    expect(wgsl).toContain('(*_dst) = _opt_f32_(0.0, false);');
  });

  it('gives an entry that writes no result the result its body says', () => {
    const wgsl = wgslOf(`"use typeshade";
@fragment export function fs() { const c = vec3(1.); return c; }
`);
    expect(wgsl).toContain('fn fs() -> @location(0) vec3<f32> {');
  });
});

describe('what a body says of its constructor', () => {
  it('refuses a return in a constructor a class inherits, where initializers run after it', () => {
    both(
      `"use typeshade";
class B { v: f32 = 1.; constructor(a: f32) { this.v = a; if (a > 1.) { return; } this.v = 2.; } }
class D extends B { w: f32 = 2.; }
@fragment export function fs(): vec4 { const d = new D(3.); return vec4(d.v, d.w, 0., 1.); }
`,
      'typeshade TS8035: "new D" runs a constructor it inherits, and the initializers of the classes below the one that declared it run when that body returns; a "return" inside it would skip them. Declare a constructor on the class, or end the body without "return".',
    );
  });

  it('runs what follows super after it, and lets a bare return end the body', () => {
    const wgsl = wgslOf(`"use typeshade";
class B { v: f32 = 1.; constructor(a: f32) { this.v = a; } }
class D extends B {
  w: f32 = 2.;
  constructor(a: f32) { super(a); this.w = a; if (a > 1.) { return; } this.w = 4.; }
}
@fragment export function fs(): vec4 { const d = new D(3.); return vec4(d.v, d.w, 0., 1.); }
`);
    expect(wgsl).toContain('B_new_into(&_sup, a);\n  (*_dst) = D(_sup.v, a);');
    expect(wgsl).toContain('if ((a > 1.0)) {\n    return;\n  }\n  (*_dst).w = 4.0;');
  });
});

describe('what a body says of its parameters', () => {
  it('copies a parameter the body writes whole, and leaves the caller its argument', () => {
    const wgsl = wgslOf(entry('function f(a: f32): f32 { a += 1.; return a }', 'f(1.)'));
    expect(wgsl).toContain(
      'fn f(a: f32) -> f32 {\n  var a_1: f32 = a;\n  a_1 += 1.0;\n  return a_1;',
    );
  });

  it('hands a captured parameter the copy the body writes', () => {
    const wgsl = wgslOf(
      entry(
        'function f(a: f32): f32 { a += 1.; const g = (x: f32) => x + a; return g(2.) }',
        'f(1.)',
      ),
    );
    expect(wgsl).toContain('return f_g(a_1, 2.0);');
  });

  it('names the caller object of an object parameter the body writes', () => {
    const wgsl = wgslOf(`"use typeshade";
class P { x: f32 = 1.; }
function bump(p: P) { p.x += 1.; }
@fragment export function fs(): vec4 { const p = new P(); bump(p); return vec4(p.x, 0., 0., 1.); }
`);
    expect(wgsl).toContain('fn bump(p: ptr<function, P>) {\n  (*p).x += 1.0;');
    expect(wgsl).toContain('bump(&p);');
  });

  it('refuses a second parameter of one name', () => {
    const sentence = 'typeshade TS8023: Duplicate parameter "x" in this scope.';
    const h = read(entry('function f(x: f32, x: f32): f32 { return x }', 'f(1., 2.)'));
    expect(h.compiler).toEqual([sentence]);
    expect(h.editor).toContain(sentence);
  });
});
