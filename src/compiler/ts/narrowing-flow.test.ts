import { describe, expect, it } from 'vitest';
import { bothHalves, bothRefuse, bothTake } from '../../core/testing/both-halves.js';
import { compileModule } from '../../core/oracle.js';
import type { CpuValue } from '../../core/cpu-runtime.js';

const program = (body: string): string => `"use typeshade";
${body}
@fragment export function fs(uv: location<0, vec2>): vec4 {
  return vec4(uv, 0., 1.);
}
`;

const present = (value: CpuValue): CpuValue => ({ value, present: true });
const absent: CpuValue = { value: 0, present: false };

const sentence = (path: string, takes: string): string =>
  `TS8003 "${path}" is "f32 | undefined" here, and ${takes} f32. Test it first, ` +
  `"if (${path} !== undefined)", or give the absent case a value, "${path} ?? 0.".`;

const unnarrowed = (source: string, path: string, takes: string): void => {
  bothRefuse(program(source), 'TS8003', sentence(path, takes).slice('TS8003 '.length));
};

describe('the paths that meet at a join', () => {
  const CASES: readonly (readonly [
    string,
    string,
    readonly (readonly [CpuValue[], CpuValue])[],
  ])[] = [
    [
      'a value on one arm and the absent start on the other',
      `export function run(k: f32): f32 { let v: f32 | undefined; if (k > 0.) { v = k; } return v ?? -1.; }`,
      [
        [[2], 2],
        [[-1], -1],
      ],
    ],
    [
      'a value on one arm and undefined assigned on the other',
      `export function run(k: f32): f32 { let v: f32 | undefined = k; if (k > 5.) { v = undefined; } return v ?? -1.; }`,
      [
        [[2], 2],
        [[6], -1],
      ],
    ],
    [
      'a presence test on one arm and an absence test on the other',
      `export function run(k: f32, v: f32 | undefined): f32 { if (k > 0.) { if (v === undefined) { return 0.; } } else { if (v !== undefined) { return 0.; } } return v ?? -2.; }`,
      [
        [[1, present(3)], 3],
        [[1, absent], 0],
        [[-1, absent], -2],
        [[-1, present(3)], 0],
      ],
    ],
  ];
  for (const [name, body, calls] of CASES) {
    it(`${name}: the read keeps its flag`, () => {
      const { result } = bothTake(program(body));
      const run = compileModule(result.module).fns['run']!;
      for (const [args, answer] of calls) expect(run(...args), name).toEqual(answer);
    });
  }
});

describe('a loop feeds its back edge to its head', () => {
  it('an optional assigned at the end of the body clears the narrowing the head had', () => {
    unnarrowed(
      `export function run(w: f32 | undefined): f32 { let v: f32 | undefined = 1.; let s = 0.; while (s < 3.) { s = s + v; v = w; } return s; }`,
      'v',
      '"+" takes an',
    );
  });
});

describe('a join keeps only what both paths say', () => {
  it('a value on one arm and the absent start on the other is no presence', () => {
    unnarrowed(
      `export function run(k: f32): f32 { let v: f32 | undefined; if (k > 0.) { v = k; } return v + 1.; }`,
      'v',
      '"+" takes an',
    );
  });

  it('a test of undefined on one arm and a test of null on the other leave both states', () => {
    bothRefuse(
      program(
        `export function run(k: f32, v: f32 | null | undefined): f32 { if (k > 0.) { if (v === undefined) { return 0.; } } else { if (v === null) { return 0.; } } return v + 1.; }`,
      ),
      'TS8003',
      '"v" is "f32 | null | undefined" here, and "+" takes an f32. Test it first, ' +
        '"if (v != null)", or give the absent case a value, "v ?? 0.".',
    );
  });
});

describe('a call of a method that writes through this clears the paths of its root', () => {
  const clearedBy = (
    method: string,
  ): string => `class Host { k: f32 | undefined; t: f32; a: Inner; ${method} }
class Inner { d: f32; }
export function run(): f32 { const h = new Host(); h.k = 2.; h.go(); return h.k; }`;

  it('the set is one for the file: a same-named method of a class that does not write clears too', () => {
    unnarrowed(
      `class Reader { k: f32 | undefined; go(): void { } }
class Writer { k: f32 | undefined; go(): void { this.k = undefined; } }
export function run(): f32 { const h = new Reader(); h.k = 2.; h.go(); return h.k; }`,
      'h.k',
      'the result here is an',
    );
  });

  for (const [name, method] of [
    ['a member path of this', 'go(): void { this.a.d = 1.; }'],
    ['a compound assignment', 'go(): void { this.t += 1.; }'],
    ['a postfix increment', 'go(): void { this.t++; }'],
    ['a prefix increment', 'go(): void { ++this.t; }'],
  ] as const) {
    it(`${name} makes the method a writer`, () => {
      unnarrowed(clearedBy(method), 'h.k', 'the result here is an');
    });
  }

  it('a write inside a function expression of the method does not', () => {
    const source =
      program(`class Host { k: f32 | undefined; go(): void { const f = (): void => { this.k = undefined; }; } }
export function run(): f32 { const h = new Host(); h.k = 2.; h.go(); return h.k; }`);
    expect(bothHalves(source).compiler).toEqual([]);
  });
});

describe('a closure keeps no member path', () => {
  it('a path tested before the closure is un-narrowed inside it', () => {
    unnarrowed(
      `class Hit { k: f32 | undefined; }
export function run(h: Hit): f32 { if (h.k !== undefined) { const g = (): f32 => h.k + 1.; return g(); } return 0.; }`,
      'h.k',
      '"+" takes an',
    );
  });
});

describe('a loop inside a loop settles in the rounds the lattice needs', () => {
  it('an optional that moves through two names reaches the read in the inner loop', () => {
    unnarrowed(
      `export function run(w: f32 | undefined): f32 { let a: f32 | undefined = 1.; let b: f32 | undefined = 1.; let s = 0.; while (s < 3.) { while (s < 2.) { s = s + a; a = b; b = w; } s = s + 1.; } return s; }`,
      'a',
      '"+" takes an',
    );
  });
});
