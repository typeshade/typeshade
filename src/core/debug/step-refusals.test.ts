import { describe, expect, it } from 'vitest';
import { f32T, type Stmt } from '../ir/index.js';
import { entryModule, lit } from '../testing/ir-shorthand.js';
import { steppedToEnd } from '../testing/stepped-run.js';
import { startDebugSession } from './session.js';

const runBody = (body: Stmt[]): void => {
  startDebugSession(entryModule(body), 'fs', [1]).continue();
};

const COUNTER = `"use typeshade";
declare const total: storage<atomic<u32>, "read_write">;
@compute([1, 1, 1]) export function c(gid: builtin<"global_invocation_id">): void {
  atomicAdd(total, 1);
}
`;

describe('a stepped run refuses what it has no CPU value for, and says what', () => {
  it('a host-provided global', () => {
    expect(() =>
      runBody([{ s: 'return', expr: { op: 'externref', type: f32T, name: 'g' } }]),
    ).toThrow("typeshade/debug: host-provided global 'g' has no CPU value");
  });

  it('a placeholder statement the composer did not splice', () => {
    expect(() =>
      runBody([
        { s: 'placeholder', tag: 'T' },
        { s: 'return', expr: lit(1) },
      ]),
    ).toThrow(
      'typeshade/debug: placeholder Stmt reached the stepping backend; composer forgot to splice tag=T',
    );
  });

  it('a raw statement', () => {
    expect(() =>
      runBody([
        { s: 'raw', wgsl: 'x' },
        { s: 'return', expr: lit(1) },
      ]),
    ).toThrow(
      'typeshade/debug: raw Stmt reached the stepping backend; raw passthrough is GPU-only',
    );
  });

  it('an atomic location on a binding nobody supplied', () => {
    expect(() => steppedToEnd(COUNTER, 'c', [[0, 0, 0]])).toThrow(
      "typeshade/debug: no value supplied for binding 'total'; pass it in the session's bindings",
    );
  });
});
