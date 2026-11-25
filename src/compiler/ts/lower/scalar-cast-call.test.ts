import { describe, expect, it } from 'vitest';
import { bothRefuse, bothTake } from '../../../core/testing/both-halves.js';

const HEAD = '"use typeshade"\n';

const wgslOf = (source: string): string => bothTake(source).result.wgsl ?? '';

describe('a scalar constructor with no argument is its zero', () => {
  it('f32(), i32(), u32() and bool() write the literal, and f64() has no zero form', () => {
    const wgsl = wgslOf(
      `${HEAD}@fragment export function fs(): vec4 { return vec4(f32(), f32(i32()), f32(u32()), f32(bool())) }\n`,
    );
    expect(wgsl).toContain('return vec4<f32>(0.0, 0.0, 0.0, f32(false));');
    bothRefuse(
      `${HEAD}export function t(): f64 { return f64() }\n`,
      'TS8019',
      'f64() expects 1 argument.',
    );
  });

  it('a wrong count says the zero form for the scalars that have one', () => {
    for (const name of ['f32', 'i32', 'u32', 'bool']) {
      bothRefuse(
        `${HEAD}export function t(): f32 { return f32(${name}(1, 2)) }\n`,
        'TS8019',
        `${name}() expects 1 argument, or none for the zero value.`,
      );
    }
    bothRefuse(
      `${HEAD}export function t(): f64 { return f64(1., 2.) }\n`,
      'TS8019',
      'f64() expects 1 argument.',
    );
  });
});

describe('f32() of an integer tree whose u32 bits and TypeScript value differ', () => {
  const twoReadings =
    'Bitwise ">>" over 0x80000000, which only a u32 holds, gives 1073741824 on its u32 bits and ' +
    '-1073741824 in TypeScript, so it does not say which it means.';

  it('is refused with the two readings, and a u32 parameter is converted', () => {
    bothRefuse(
      `${HEAD}export function t(u: u32): f32 { return f32(0x80000000 >> 1) }\n`,
      'TS8003',
      `${twoReadings} Write "u32(0x80000000) >> 1" for the u32 shift.`,
    );
    expect(wgslOf(`${HEAD}export function t(u: u32): f32 { return f32(u >> 1) }\n`)).toContain(
      'return f32((u >> 1u));',
    );
  });

  it('says one mistake when the tree was refused already', () => {
    bothRefuse(
      `${HEAD}export function t(f: f32): f32 { return f32(f > 1.0 ? 0x80000000 >> 1 : f) }\n`,
      'TS8003',
      [
        '"0x80000000 >> 1" is an integer by its bit operator, and this position takes an f32.',
        twoReadings,
      ],
    );
  });
});

describe('i32() and u32() read a constant of no fixed type as an integer', () => {
  it('converts the written number at its exact value, as the literal does', () => {
    expect(
      wgslOf(`${HEAD}const K = 7\nexport function t(n: u32): f32 { return f32(u32(K / 2)) }\n`),
    ).toContain('return 3.0;');
    expect(
      wgslOf(`${HEAD}const C = 7.5\nexport function t(n: u32): u32 { return u32(C) }\n`),
    ).toContain('return 7u;');
    expect(
      wgslOf(`${HEAD}export function t(a: i32, b: i32): f32 { return f32(i32(a / b)) }\n`),
    ).toContain('return f32(i32((a / b)));');
  });

  it('keeps the name for f32(), which reads the constant as an f32', () => {
    const wgsl = wgslOf(
      `${HEAD}const K = 7\nexport function t(n: u32): f32 { const a = f32(K); return a + K / 2 }\n`,
    );
    expect(wgsl).toContain('let a = f32(K);');
    expect(wgsl).toContain('return (a + (K * 0.5));');
  });

  it('does not read the constant as an integer for f64() either', () => {
    bothTake(
      `${HEAD}const K = 7\nexport function t(n: u32): f32 { const a = f64(K); return f32(a) + K / 2 }\n`,
    );
  });

  it('refuses a "/" over the constant elsewhere once an integer read it', () => {
    bothRefuse(
      `${HEAD}const K = 7\nexport function t(n: u32): f32 { const a = u32(K); return f32(a) + K / 2 }\n`,
      'TS8003',
      '"K" is a u32 where another line reads it, and no operand of "K / 2" has a declared type, ' +
        'so the "/" does not say which division it is. Write "f32(K) / 2" for the float division.',
    );
    bothRefuse(
      `${HEAD}const K = 7\nexport function t(n: u32): f32 { const a = u32(K + 1); return f32(a) + K / 2 }\n`,
      'TS8003',
      '"K" is a u32 where another line reads it, and no operand of "K / 2" has a declared type, ' +
        'so the "/" does not say which division it is. Write "f32(K) / 2" for the float division.',
    );
  });

  it('does not read a float-written constant as an integer', () => {
    bothTake(
      `${HEAD}const C = 7.5\nexport function t(n: u32): f32 { const a = u32(C); return f32(a) + C / 2 }\n`,
    );
  });
});

describe('the editor names the type a conversion read a constant as', () => {
  const hoverOf = (call: string, declaration = 'const K = 7'): string | undefined =>
    bothTake(
      `${HEAD}${declaration}\nexport function t(n: u32): f32 { return f32(${call}) }\n`,
    ).hover(call.includes('+') ? 'K +' : call.includes('C') ? 'C)' : 'K)');

  it('u32, i32, f32 and f64', () => {
    expect(hoverOf('u32(K)')).toBe('```ts\nconst K: u32\n```');
    expect(hoverOf('i32(K)')).toBe('```ts\nconst K: i32\n```');
    expect(hoverOf('f32(K)')).toBe('```ts\nconst K: f32\n```');
    expect(hoverOf('f64(K)')).toBe('```ts\nconst K: f64\n```');
    expect(hoverOf('u32(K + 1)')).toBe('```ts\nconst K: u32\n```');
  });

  it('a float-written constant stays what it was written as', () => {
    expect(hoverOf('u32(C)', 'const C = 7.5')).toBe(
      '```ts\nconst C = 7.5 (f32 or f64 where it is read)\n```',
    );
  });
});
