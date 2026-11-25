import { describe, expect, it } from 'vitest';
import { bothRefuse, bothTake } from '../../core/testing/both-halves.js';

const fn = (result: string, body: string, params = ''): string =>
  `"use typeshade"\nexport function f(${params}): ${result} { ${body} }`;

const fits = (value: string, type: 'i32' | 'u32'): string =>
  `The value has to fit: ${value} is outside ${type}, which holds ${
    type === 'u32' ? '0 to 4294967295' : '-2147483648 to 2147483647'
  } (§13).`;

describe('a typed literal is folded as its own type computes it', () => {
  it('refuses the negation of a u32 value, which has no u32 to fold to', () => {
    bothRefuse(
      fn('u32', 'return -u32(1);'),
      'TS8003',
      'Unary "-" is not defined on u32; WGSL has no negation for an unsigned integer. Write 0u - x to wrap, or i32(x) to change kind first.',
    );
  });

  it('refuses a u32 division by a literal zero and leaves no folded value', () => {
    bothRefuse(
      fn('u32', 'return u32(7) / 0;'),
      'TS8003',
      'Division by zero: "0" is 0 on every invocation. WGSL refuses it and GLSL ES 3.00 leaves it undefined.',
    );
  });

  it('keeps the quotient of two written floats a float', () => {
    const halves = bothTake(fn('f32', 'return 4. / 2.;'));
    expect(halves.result.wgsl).toContain('return 2.0;');
  });
});

describe('an integer literal takes the type its position declares', () => {
  it('retypes both arms of a conditional', () => {
    const halves = bothTake(fn('u32', 'return c ? 1 : 2;', 'c: bool'));
    expect(halves.result.wgsl).toContain('return select(2u, 1u, c);');
  });

  it('refuses a conditional whose second arm is out of range, naming that arm', () => {
    bothRefuse(fn('u32', 'return c ? 1 : -2;', 'c: bool'), 'TS8003', fits('-2', 'u32'));
  });

  it('refuses a conditional whose first arm is out of range, naming that arm', () => {
    bothRefuse(
      fn('i32', 'return c ? 2147483648 : 1;', 'c: bool'),
      'TS8003',
      fits('2147483648', 'i32'),
    );
  });

  it.each([
    ['a quotient that is no integer', fn('u32', 'return 1 / 2;')],
    ['a float written past the range', fn('u32', 'return 4294967296.;')],
    ['a sum of floats that folds past the range', fn('u32', 'return 4294967295. + 1.;')],
    ['a conditional with an f32 arm', fn('u32', 'return c ? 1 : x;', 'c: bool, x: f32')],
  ])('keeps the return type mismatch of %s', (_what, source) => {
    bothRefuse(source, 'TS8003', 'Function "f" return type mismatch: declared u32, got f32.');
  });

  it('refuses a float written as a float, though it folds to a whole number', () => {
    const mismatch =
      'Type mismatch: cannot let/const y i32 and f32 — no implicit int/float conversion. Cast explicitly: f32(intVal) or i32(floatVal) / u32(floatVal).';
    bothRefuse(fn('i32', 'let y: i32 = 1.5; return y;'), 'TS8003', mismatch);
  });
});

describe('a declared f64 position takes a written number and no call', () => {
  it('keeps the mismatch of an f32 conversion the author wrote', () => {
    bothRefuse(
      fn('f64', 'const k: f64 = f32(0.1); return k;'),
      'TS8003',
      'Type mismatch: cannot let/const k f64 and f32. Types must match.',
    );
  });

  it('keeps the mismatch of a parenthesized f32 conversion', () => {
    bothRefuse(
      fn('f64', 'const k: f64 = (f32(0.1)); return k;'),
      'TS8003',
      'Type mismatch: cannot let/const k f64 and f32. Types must match.',
    );
  });

  it('folds arithmetic over written numbers and keeps arithmetic beside an f64 conversion', () => {
    const written = bothTake(fn('f64', 'const k: f64 = 0.5 * 4.; return k;'));
    expect(written.result.wgsl).toContain('let k = vec2<f32>(2.0, 0.0);');
    const converted = bothTake(fn('f64', 'const k: f64 = f64(0.5) * 4.; return k;'));
    expect(converted.result.wgsl).toContain('let k = (vec2<f32>(4.0, 0.0) * 0.5);');
  });

  it('takes a written number and arithmetic over written numbers', () => {
    bothTake(fn('f64', 'const k: f64 = 0.1; return k;'));
    bothTake(fn('f64', 'const k: f64 = 1. / 4.; return k;'));
  });
});

describe('a shift amount is held to 0 .. 31', () => {
  const amount = (n: string): string =>
    `A shift amount must be between 0 and 31, got ${n}: a 32-bit integer has no bit to shift into.`;

  it.each([
    ['32', fn('u32', 'return u32(1) << 32;')],
    ['40', fn('u32', 'return u32(1) << 40;')],
    ['-1', fn('i32', 'return 1 << -1;')],
  ])('refuses the amount %s', (n, source) => {
    bothRefuse(source, 'TS8003', amount(n));
  });

  it('takes 0 and 31, and a runtime amount', () => {
    bothTake(fn('u32', 'return (u32(1) << 31) | (u32(1) << 0);'));
    bothTake(fn('u32', 'return x << n;', 'x: u32, n: u32'));
  });
});
