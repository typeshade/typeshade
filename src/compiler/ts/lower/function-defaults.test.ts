import { describe, expect, it } from 'vitest';
import { bothHalves } from '../../../core/testing/both-halves.js';
import { uninlined } from '../../../core/testing/keep-helpers.js';

const program = (head: string, value: string): string =>
  `"use typeshade"\n${head}\n@fragment export function fs(): vec4 { return vec4(${value}, 0., 0., 1.); }\n`;

const read = (source: string) => uninlined(() => bothHalves(source));

describe('defaults are lowered before any body, to a fixed point', () => {
  it('fills a chain of defaults three deep, declared against the order of use', () => {
    const h = read(
      program(
        `function a(x: f32 = b()): f32 { return x }
function b(x: f32 = c()): f32 { return x }
function c(x: f32 = d()): f32 { return x }
function d(x: f32 = 7.): f32 { return x }`,
        'a()',
      ),
    );
    expect(h.compiler).toEqual([]);
    expect(h.editor).toEqual([]);
    expect(h.result.wgsl).toContain('a(b(c(d(7.0))))');
  });

  it('fills the same chain declared in the order of use', () => {
    const h = read(
      program(
        `function d(x: f32 = 7.): f32 { return x }
function c(x: f32 = d()): f32 { return x }
function b(x: f32 = c()): f32 { return x }
function a(x: f32 = b()): f32 { return x }`,
        'a()',
      ),
    );
    expect(h.compiler).toEqual([]);
    expect(h.editor).toEqual([]);
    expect(h.result.wgsl).toContain('a(b(c(d(7.0))))');
  });

  it('says nothing of a default that only waits for another, then says what stays unfilled', () => {
    const h = read(
      program(
        `function a(x: f32 = b()): f32 { return x }
function b(x: f32 = a()): f32 { return x }`,
        'a()',
      ),
    );
    const waits =
      'The default for "x" calls a function whose own default waits on this one, so neither has a value. Write the value out here.';
    expect(h.compiler.length).toBeGreaterThan(0);
    expect(h.compiler.every((l) => l.includes(waits))).toBe(true);
    expect(h.editor.some((l) => l.includes(waits))).toBe(true);
  });

  it('reads a method default in the module scope, never a parameter', () => {
    const h = read(
      program(
        `const S = 4.
class R {
  o: f32 = 1.
  at(t: f32 = S): f32 { return this.o + t }
}`,
        'new R().at()',
      ),
    );
    expect(h.compiler).toEqual([]);
    expect(h.editor).toEqual([]);
    expect(h.result.wgsl).toContain('4.0');
  });
});
