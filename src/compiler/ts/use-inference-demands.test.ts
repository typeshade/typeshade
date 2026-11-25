import { describe, expect, it } from 'vitest';
import { bothTake } from '../../core/testing/both-halves.js';

const fn = (body: string, ret = 'u32'): string => `"use typeshade";
export function t(vi: u32, ii: i32, x: f32, xs: array<f32, 8>, d: f64, vd: vec3f64): ${ret} {
  ${body}
}`;

const decided = (body: string, ret: string, name: string, type: string): void => {
  const halves = bothTake(fn(body, ret));
  expect(halves.hover(`${name} = `), body).toContain(`let ${name}: ${type}`);
};

describe('a constant of no fixed type is a written number', () => {
  it('lends no type to a value that reads it, and takes the type the value gets', () => {
    const halves = bothTake(`"use typeshade";
const K = 5;
export function t(vi: u32): u32 {
  let n = 1;
  return vi + (n * K);
}`);
    expect(halves.hover('n = 1')).toContain('let n: u32');
  });
});

describe('a peer with no type of its own asks nothing', () => {
  it('a value no use has decided gives a call of a function its callers decide no f32 to take', () => {
    const halves = bothTake(`"use typeshade";
function r() {
  return 1;
}
export function t(vi: u32): u32 {
  let n = 0;
  n += vi;
  return r() + n;
}`);
    expect(halves.hover('n = 0')).toContain('let n: u32');
    expect(halves.hover('r()')).toContain('u32');
  });

  it('a parenthesized read is the read it wraps', () => {
    const halves = bothTake(`"use typeshade";
function r() {
  return 1;
}
export function t(vi: u32): u32 {
  let n = 0;
  n += vi;
  return r() + (n);
}`);
    expect(halves.hover('n = 0')).toContain('let n: u32');
  });
});

describe('an index and a shift fix no integer type by themselves', () => {
  it('an index of an i32 is an index of a u32 too, so a u32 peer decides the value', () => {
    decided('let j = 0; j += vi; return xs[j];', 'f32', 'j', 'u32');
  });

  it('a shift amount takes the type a peer gives it', () => {
    decided('let s = 1; s += vi; return vi << s;', 'u32', 's', 'u32');
  });

  it('an index with no other use is an i32', () => {
    decided('let j = 1; return xs[j];', 'f32', 'j', 'i32');
  });
});

describe('what a peer of a vector type asks of a written number', () => {
  it('asks the element type of a vector of u32, i32 and f32', () => {
    decided('let k = 2; return (vec3u(vi) * k).x;', 'u32', 'k', 'u32');
    decided('let k = 2; return (vec3i(ii) * k).x;', 'i32', 'k', 'i32');
    decided('let k = 2; return (vec3(x) * k).x;', 'f32', 'k', 'f32');
  });

  it('asks f64 of a vector of f64, as it does of an f64', () => {
    decided('let k = 2; return (vd * k).x;', 'f64', 'k', 'f64');
  });
});

describe('a written number reaches through arithmetic over written numbers', () => {
  it('a remainder', () => {
    decided('let n = 7; return vi + (n % 3);', 'u32', 'n', 'u32');
  });

  it('a negation', () => {
    decided('let n = 7; return ii + -n;', 'i32', 'n', 'i32');
  });

  it('a product and a difference', () => {
    decided('let n = 7; return vi + (n * 2 - 1);', 'u32', 'n', 'u32');
  });
});
