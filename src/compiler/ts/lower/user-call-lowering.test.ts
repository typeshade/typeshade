import { describe, expect, it } from 'vitest';
import { bothHalves, bothRefuse, bothTake } from '../../../core/testing/both-halves.js';

const HEAD = '"use typeshade"\n';

const wgslOf = (source: string): string => bothTake(source).result.wgsl ?? '';

describe('an argument is checked against the parameter it is written for', () => {
  it('a bare integer literal takes the type of an i32 or u32 parameter', () => {
    const wgsl = wgslOf(
      `${HEAD}function g(a: u32): u32 { return a }\nexport function t(): u32 { return g(1) }\n`,
    );
    expect(wgsl).toContain('return g(1u);');
    expect(
      wgslOf(
        `${HEAD}function g(a: i32): i32 { return a }\nexport function t(): i32 { return g(1) }\n`,
      ),
    ).toContain('return g(1);');
  });

  it('a literal that does not fit the parameter is refused with its range', () => {
    bothRefuse(
      `${HEAD}function g(a: u32): u32 { return a }\nexport function t(): u32 { return g(-1) }\n`,
      'TS8003',
      'The value has to fit: -1 is outside u32, which holds 0 to 4294967295 (§13).',
    );
  });

  it('a value of another type is a type mismatch of that argument', () => {
    bothRefuse(
      `${HEAD}function g(a: u32): u32 { return a }\nexport function t(): u32 { return g(1.5) }\n`,
      'TS8003',
      'Argument 1 of "g" type mismatch.',
    );
    bothRefuse(
      `${HEAD}function g(a: f32, b: u32): f32 { return a }\nexport function t(): f32 { return g(1., 1.5) }\n`,
      'TS8003',
      'Argument 2 of "g" type mismatch.',
    );
  });

  it('two structs with the same fields are two types, and the sentence says why', () => {
    bothRefuse(
      `${HEAD}namespace N { export class P { a: f32 = 1. }\n export function f(p: P): f32 { return p.a } }\n` +
        'class P { a: f32 = 1. }\nexport function t(): f32 { return N.f(new P()) }\n',
      'TS8003',
      'Argument 1 of "N.f" is P, and "N.f" takes N.P. A struct is its own type whatever its ' +
        'fields, so pass a value of type N.P.',
    );
  });

  it('the same sentence for an argument of a generic call, which is lowered before the callee', () => {
    bothRefuse(
      `${HEAD}function g<T>(a: T, b: f32): T { return a }\nexport function t(v: f32 | undefined): f32 { return g(1., v) }\n`,
      'TS8003',
      '"v" is "f32 | undefined" here, and argument 2 of "g" takes an f32. Test it first, ' +
        '"if (v !== undefined)", or give the absent case a value, "v ?? 0.".',
    );
  });

  it('an optional value handed to a parameter that takes its T names the test to write', () => {
    bothRefuse(
      `${HEAD}function g(a: f32): f32 { return a }\nexport function t(v: f32 | undefined): f32 { return g(v) }\n`,
      'TS8003',
      '"v" is "f32 | undefined" here, and argument 1 of "g" takes an f32. Test it first, ' +
        '"if (v !== undefined)", or give the absent case a value, "v ?? 0.".',
    );
  });
});

describe('a call of a parameter that takes a function', () => {
  it('reads the function type of the parameter the call names, not of another one', () => {
    const wgsl = wgslOf(
      `${HEAD}function run(f: (x: f32) => f32 | undefined, h: (x: f32) => f32): f32 { return h(1.) + (f(1.) ?? 0.) }\n` +
        'function a(x: f32): f32 | undefined { return x > 0. ? x : undefined }\nfunction b(x: f32): f32 { return x }\n' +
        'export function t(): f32 { return run(a, b) }\n',
    );
    expect(wgsl).toContain('return (b(1.0) + select(0.0, _opt.value, _opt.present));');
  });
});

describe('a call that needs a function of the file that cannot be called', () => {
  it('names the entry point on the call and what to move', () => {
    bothRefuse(
      `${HEAD}@fragment export function fs(): vec4 { return vec4(0.) }\nexport function g(): vec4 { return fs() }\n`,
      'TS8099',
      '"fs" is a fragment entry point and cannot be called; the pipeline invokes it. Move the ' +
        'body into a plain function and call that from both.',
    );
  });
});

describe('a call lowers each written argument once and reports an arity mistake once', () => {
  it('too many arguments report the arity, whatever the arguments hold', () => {
    bothRefuse(
      `${HEAD}function g(a: f32): f32 { return a }\nexport function t(): f32 { return g(1., 2., 3.) }\n`,
      'TS8019',
      '"g" expects 1 argument(s), got 3.',
    );
  });

  it('an unknown function inside an argument is reported once', () => {
    bothRefuse(
      `${HEAD}function g(a: f32): f32 { return a }\nexport function t(): f32 { return g(nope(1.)) }\n`,
      'TS8004',
      'Unknown function "nope". Declare it in this file, or import it from another shader module.',
    );
  });
});

describe('an argument that the function writes, and an argument that a default fills', () => {
  it('an object parameter the function writes takes the place its argument names', () => {
    const wgsl = wgslOf(
      `${HEAD}class P { a: f32 = 1. }\nfunction bump(p: P) { p.a += 1. }\n` +
        'export function t(): f32 { const p = new P(); bump(p); return p.a }\n',
    );
    expect(wgsl).toContain('fn bump(p: ptr<function, P>) {');
    expect(wgsl).toContain('bump(&p);');
  });

  it('a default is filled only up to the first parameter that has none', () => {
    bothRefuse(
      `${HEAD}function f(a: f32, b: f32, c: f32 = 3., d: f32): f32 { return a + b + c + d }\n` +
        'export function t(): f32 { return f(1.) }\n',
      'TS8019',
      '"f" expects 4 argument(s), got 1.',
    );
    const broken = bothHalves(
      `${HEAD}function f(a: f32, b: f32 = nope(), c: f32): f32 { return a + b + c }\n` +
        'export function t(): f32 { return f(1.) }\n',
    );
    expect(broken.compiler).toEqual([
      'typeshade TS8004: Unknown function "nope". Declare it in this file, or import it from another shader module.',
    ]);
  });

  it('a call that a default spliced into a body counts as a call of that body', () => {
    const source =
      `${HEAD}function f(a: f32, b: f32 = g()): f32 { return a + b }\n` +
      'function g(): f32 { return f(1.) }\nexport function t(): f32 { return g() }\n';
    const halves = bothRefuse(
      source,
      'TS8031',
      'Recursive call: "g" -> "g". WGSL has no call stack, so a function must not take part in a call cycle.',
    );
    expect(halves.result.diagnostics[0]!.start).toBe(source.indexOf('f(1.)'));
  });
});
