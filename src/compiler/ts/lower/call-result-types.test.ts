import { describe, expect, it } from 'vitest';
import { bothRefuse, bothTake } from '../../../core/testing/both-halves.js';

const HEAD = '"use typeshade"\n';

const wgslOf = (source: string): string => bothTake(source).result.wgsl ?? '';

describe('the type of a builtin call comes from the overload row, then from these shapes', () => {
  it('dot of two vec3u is a u32, which the row says and no float default does', () => {
    expect(
      wgslOf(`${HEAD}export function t(a: vec3u, b: vec3u): u32 { return dot(a, b) }\n`),
    ).toContain('return dot(a, b);');
  });

  it('length, distance, dot and determinant of floats are an f32', () => {
    bothTake(
      `${HEAD}export function t(a: vec3, b: vec3, m: mat3x3): f32 { return length(a) + distance(a, b) + dot(a, b) + determinant(m) }\n`,
    );
  });

  it('length, distance and dot of an emulated-double vector are an f64', () => {
    bothTake(`${HEAD}export function t(a: vec3f64): f64 { return length(a) }\n`);
    bothTake(`${HEAD}export function t(a: vec3f64, b: vec3f64): f64 { return distance(a, b) }\n`);
    bothTake(`${HEAD}export function t(a: vec3f64, b: vec3f64): f64 { return dot(a, b) }\n`);
  });

  it('transpose of a matrix of C columns and R rows has R columns and C rows', () => {
    bothTake(`${HEAD}export function t(m: mat2x3): mat3x2 { return transpose(m) }\n`);
    bothTake(`${HEAD}export function t(m: mat3x2): mat2x3 { return transpose(m) }\n`);
    bothRefuse(
      `${HEAD}export function t(m: mat2x3): mat2x3 { return transpose(m) }\n`,
      'TS8003',
      'Function "t" return type mismatch: declared mat2x3, got mat3x2.',
    );
  });
});

describe('a call of a generic function reads T off its arguments', () => {
  const PICK = 'function pick<T>(a: T, b: T): T { return a }\n';

  it('a bare integer literal is an f32 there, and pick<i32> says otherwise', () => {
    const wgsl = wgslOf(`${HEAD}${PICK}export function t(): f32 { return pick(1, 2) }\n`);
    expect(wgsl).toContain('fn pick_f32(a: f32, b: f32) -> f32 {');
    expect(wgsl).toContain('return pick_f32(1.0, 2.0);');
    const typed = wgslOf(`${HEAD}${PICK}export function t(): i32 { return pick<i32>(1, 2) }\n`);
    expect(typed).toContain('fn pick_i32(a: i32, b: i32) -> i32 {');
    expect(typed).toContain('return pick_i32(1, 2);');
  });

  it('an absent value written as an argument takes the optional parameter type of the instance', () => {
    const wgsl = wgslOf(
      `${HEAD}function g<T>(a: T, b: T | undefined): T { return b ?? a }\n` +
        'export function t(): f32 { return g(1., undefined) }\n',
    );
    expect(wgsl).toContain('return g_f32(1.0, _opt_f32_(0.0, false));');
  });

  it('an argument is lowered once, so what it hoists is hoisted once', () => {
    const wgsl = wgslOf(
      `${HEAD}function a(x: f32): f32 | undefined { return x > 0. ? x : undefined }\n` +
        'function pick<T>(p: T, q: T): T { return p }\n' +
        'export function t(): f32 { return pick(a(1.) ?? 0., 2.) }\n',
    );
    expect(wgsl).toContain('var _opt: _opt_f32_ = a(1.0);');
    expect(wgsl).toContain('return pick_f32(select(0.0, _opt.value, _opt.present), 2.0);');
  });

  it('an error inside an argument is reported once', () => {
    bothRefuse(
      `${HEAD}${PICK}export function t(): f32 { return pick(1. + true, 2.) }\n`,
      'TS8003',
      'Type mismatch: cannot + f32 and bool. Types must match, or cast with f32()/i32()/u32().',
    );
  });
});

describe('a call of a generic function that takes a function lowers the other arguments by their own nodes', () => {
  const APP = 'function inc(a: f32): f32 { return a + 1. }\n';

  it('an integer literal after the function argument takes the parameter type', () => {
    const wgsl = wgslOf(
      `${HEAD}${APP}function app<T>(f: (a: T) => T, a: T, k: u32): T { return f(a) }\n` +
        'export function t(): f32 { return app(inc, 1., 5) }\n',
    );
    expect(wgsl).toContain('fn app_f32_inc(a: f32, k: u32) -> f32 {');
    expect(wgsl).toContain('return app_f32_inc(1.0, 5u);');
  });

  it('the arity counts the arguments written, the function included', () => {
    bothRefuse(
      `${HEAD}${APP}function app<T>(f: (a: T) => T, a: T): T { return f(a) }\n` +
        'export function t(): f32 { return app(inc, 1., 5.) }\n',
      'TS8019',
      '"app" expects 1 argument(s), got 2.',
    );
  });
});
