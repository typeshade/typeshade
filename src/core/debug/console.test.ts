// A debug session delivers the console calls it steps over (changes/0018, surface §66).
//
// The session is the fourth CPU path a `console.*` call runs on, after `compileModule`, the
// generated CPU code and `dispatch`. What it delivers must be what `compile().eval` delivers
// for the same entry and arguments, labels, span and invocation included, and it must deliver
// each event at the step that runs its call, never before and never at a step that skips it.

// Verifies: Rule 11.9 (a stepped run delivers each console call, a table of a matrix by column).

import { describe, expect, it } from 'vitest';
import { compile } from '../../compiler/ts/compile.js';
import type { ConsoleEvent } from '../console.js';
import { startDebugSessionFromConfig } from './config.js';
import { startDebugSession } from './session.js';

const KERNEL = `"use typeshade";
@compute([4])
export function main(@builtin("global_invocation_id") gid: vec3u): void {
  const x = f32(gid.x) * 1.5;
  console.log("i =", gid.x, x);
  if (gid.x > 1) {
    console.warn("big", vec2(x, 2.));
  }
}

@fragment
export function fs(@builtin("position") p: vec4): vec4 {
  console.info("pixel", p.xy);
  return vec4(1.);
}`;

/** What `compile().eval` delivers for one call of `entry`. */
function evalEvents(entry: string, args: readonly unknown[]): ConsoleEvent[] {
  const out: ConsoleEvent[] = [];
  compile(KERNEL, { consoleSink: (e) => out.push(e) }).eval(entry, args);
  return out;
}

/** What a session delivers, run to the end. */
function sessionEvents(entry: string, args: readonly unknown[]): ConsoleEvent[] {
  const out: ConsoleEvent[] = [];
  const s = startDebugSession(compile(KERNEL).module, entry, args as never[], {
    consoleSink: (e) => out.push(e),
  });
  s.continue();
  expect(s.pause).toBeUndefined();
  return out;
}

describe('a debug session delivers console calls to its sink (surface §66)', () => {
  it('sanity: the kernel compiles, so an empty module is not what the cases below compare', () => {
    const errors = compile(KERNEL).diagnostics.filter((d) => d.category === 'error');
    expect(errors.map((d) => `${d.code} ${d.message}`)).toEqual([]);
  });

  it('delivers what compile().eval delivers, for each compute invocation', () => {
    for (const x of [0, 1, 3]) {
      const args = [[x, 0, 0]];
      const expected = evalEvents('main', args);
      // Sanity: not two empty lists, and the branch is taken where it should be.
      expect(expected.map((e) => e.method)).toEqual(x > 1 ? ['log', 'warn'] : ['log']);
      expect(expected[0]!.invocation).toEqual([x, 0, 0]);
      expect(sessionEvents('main', args)).toEqual(expected);
    }
  });

  it('marks a fragment entry with its pixel, as compile().eval does', () => {
    const args = [[10.5, 20.5, 0, 1]];
    const expected = evalEvents('fs', args);
    expect(expected).toHaveLength(1);
    expect(expected[0]!.invocation).toEqual([10, 20, 0]);
    expect(expected[0]!.args[0]).toBe('pixel');
    expect(sessionEvents('fs', args)).toEqual(expected);
  });

  it('delivers each event at the step that runs its call, and nothing at a step that skips it', () => {
    const src = compile(KERNEL);
    const lines: ConsoleEvent[] = [];
    const s = startDebugSession(src.module, 'main', [[1, 0, 0]], {
      consoleSink: (e) => lines.push(e),
    });
    // Each stop, with how many events had arrived by it.
    const stops: [string, number][] = [];
    while (s.pause) {
      const { start, length } = s.pause.span;
      stops.push([KERNEL.slice(start, start + length).split('\n')[0]!, lines.length]);
      s.stepOver();
    }
    expect(stops).toEqual([
      ['const x = f32(gid.x) * 1.5;', 0],
      ['console.log("i =", gid.x, x);', 0],
      ['if (gid.x > 1) {', 1],
    ]);
    expect(lines).toHaveLength(1);
  });

  it('delivers nothing without a sink, and a sink changes nothing else', () => {
    const m = compile(KERNEL).module;
    const bare = startDebugSession(m, 'main', [[3, 0, 0]]);
    const sunk = startDebugSession(m, 'main', [[3, 0, 0]], { consoleSink: () => {} });
    bare.continue();
    sunk.continue();
    expect(sunk.result).toEqual(bare.result);
  });

  it('delivers a console.table of a matrix as its columns, as compile().eval does', () => {
    const src = `"use typeshade";
@compute([1])
export function t(@builtin("global_invocation_id") gid: vec3u): void {
  console.table(mat2x2(1., 2., 3., f32(gid.x)));
}`;
    const expected: ConsoleEvent[] = [];
    compile(src, { consoleSink: (e) => expected.push(e) }).eval('t', [[5, 0, 0]]);
    expect(expected[0]!.args).toEqual([
      [
        [1, 2],
        [3, 5],
      ],
    ]);
    const got: ConsoleEvent[] = [];
    const s = startDebugSession(compile(src).module, 't', [[5, 0, 0]], {
      consoleSink: (e) => got.push(e),
    });
    s.continue();
    expect(got).toEqual(expected);
  });

  it('takes the sink beside a launch configuration, which is JSON', () => {
    const out: ConsoleEvent[] = [];
    const s = startDebugSessionFromConfig(
      compile(KERNEL).module,
      { entry: 'main', invocation: { global_invocation_id: [2, 0, 0] } },
      { consoleSink: (e) => out.push(e) },
    );
    s.continue();
    expect(out).toEqual(evalEvents('main', [[2, 0, 0]]));
  });
});
