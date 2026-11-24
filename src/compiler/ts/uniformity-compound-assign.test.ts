import { describe, expect, it } from 'vitest';
import { bothHalves, bothTake } from '../../core/testing/both-halves.js';

const shader = (body: string): string => `"use typeshade";
declare const k: uniform<f32>;
declare const out: storage<array<f32>, "read_write">;
@compute([64, 1, 1]) export function cs(lid: builtin<"local_invocation_id">): void {
${body}
 out[lid.x] = 1.;
}`;

describe('a compound assignment keeps the class of the value it reads (#1088)', () => {
  it.each([
    ['a varying local', 'let a = f32(lid.x); a += 1.; if (a > 0.5) { workgroupBarrier(); }'],
    [
      'a uniform local given a varying operand',
      'let a = k; a += f32(lid.x); if (a > 0.5) { workgroupBarrier(); }',
    ],
  ])('both halves refuse a barrier under %s', (_name, body) => {
    const halves = bothHalves(shader(body));
    expect(halves.compiler).toHaveLength(1);
    expect(halves.compiler[0]).toMatch(/^typeshade TS8052: /);
    expect(halves.editor).toEqual(halves.compiler);
  });

  it.each([
    [
      'a uniform local and a uniform operand',
      'let a = k; a += 1.; if (a > 0.5) { workgroupBarrier(); }',
    ],
    [
      'a varying local overwritten by a uniform value',
      'let a = f32(lid.x); a = k; if (a > 0.5) { workgroupBarrier(); }',
    ],
  ])('both halves take a barrier under %s', (_name, body) => {
    bothTake(shader(body));
  });
});
