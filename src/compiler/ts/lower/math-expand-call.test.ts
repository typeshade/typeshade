import { describe, expect, it } from 'vitest';
import { bothRefuse, bothTake } from '../../../core/testing/both-halves.js';

const HEAD = '"use typeshade"\n';

describe('an expansion that reads its argument twice evaluates an argument with an effect once', () => {
  it('a workgroupUniformLoad, which carries a barrier, goes through the built function', () => {
    const wgsl =
      bothTake(
        `${HEAD}let w: workgroup<f32>\n@compute([64, 1, 1]) export function cs(lid: builtin<"local_invocation_id">) {\n` +
          '  if (lid.x === 0) { w = 8. }\n  workgroupBarrier()\n  const a = Math.cbrt(workgroupUniformLoad(w))\n' +
          '  if (a > 100.) { w = a }\n}\n',
      ).result.wgsl ?? '';
    expect(wgsl).toContain('let a = cbrt(workgroupUniformLoad(&w));');
    expect(wgsl.split('workgroupUniformLoad(').length - 1).toBe(1);
  });

  it('a pure builtin and an arithmetic argument are expanded in place', () => {
    const wgsl =
      bothTake(
        `${HEAD}export function h(x: f32): f32 { return Math.cbrt(sin(x)) + Math.cbrt(x * 2.) }\n`,
      ).result.wgsl ?? '';
    expect(wgsl).not.toContain('fn cbrt(');
    expect(wgsl).toContain('pow(abs(_cse0), 0.3333333333333333)');
  });
});

describe('an expansion refuses a vector argument in its own words, once', () => {
  it.each(['cbrt', 'expm1'])('Math.%s of a vec3', (name) => {
    bothRefuse(
      `${HEAD}export function h(x: vec3): vec3 { return Math.${name}(x) }\n`,
      'TS8003',
      `Math.${name} takes a number.`,
    );
  });

  it('Math.hypot of vec3 arguments', () => {
    bothRefuse(
      `${HEAD}export function h(x: vec3): f32 { return Math.hypot(x, x) }\n`,
      'TS8003',
      'Math.hypot takes a number.',
    );
  });
});
