import { describe, expect, it } from 'vitest';
import { bothHalves, bothRefuse } from '../../core/testing/both-halves.js';

const mixins = (a: string, b: string, use: string): string => `"use typeshade";
class S2 { pos: vec3; }
function A<TB extends AnyClass>(Base: TB) {
  return class extends Base { ${a} };
}
function B<TB extends AnyClass>(Base: TB) {
  return class extends Base { ${b} };
}
class D extends B(A(S2)) {}
@fragment export function fs(): vec4 {
  ${use}
  return vec4(1.);
}
`;

const program = (use: string): string => mixins('v: i32;', 'v = 0;', use);

const text = (one: string, another: string): string =>
  `"D" gets the field "v" twice through its mixins, written "${one}" in one and "${another}" in ` +
  `another. One of them decides the layout, and picking either silently would change what the ` +
  `other's code reads. Give them one type, or two names.`;

const twice = (lines: readonly string[]): string[] => lines.filter((l) => l.includes('twice'));

describe('a mixin field layout message reads the same in both halves (issue 1326)', () => {
  it('names the type of a field written without one', () => {
    bothRefuse(program(''), 'TS8099', text('i32', 'f32'));
  });

  it('spells the type a use decides, not f32', () => {
    const h = bothHalves(program('const d = new D();\n  const k: u32 = d.v;'));
    const expected = text('i32', 'u32');
    expect(twice(h.compiler)).toEqual([`typeshade TS8099: ${expected}`]);
    expect(twice(h.editor)).toEqual([`typeshade TS8099: ${expected}`]);
  });

  it('keeps refusing a field a use decides as i32 against one written f32', () => {
    const src = mixins('v: f32;', 'v = 0;', 'const d = new D();\n  const k: i32 = d.v;');
    const h = bothHalves(src);
    expect(twice(h.compiler)).toHaveLength(1);
    expect(twice(h.editor)).toHaveLength(1);
    expect(h.compiler.join('\n')).toContain('written "f32" in one and "i32" in another');
    expect(h.result.wgsl ?? '').not.toContain('v: i32');
  });

  it('refuses two untyped fields that name different types', () => {
    bothRefuse(mixins('v = 0;', 'v = vec3(0.);', ''), 'TS8099', text('f32', 'vec3'));
  });

  it('takes two untyped integer-written fields as one type', () => {
    const h = bothHalves(mixins('v = 0;', 'v = 1;', ''));
    expect(twice(h.compiler)).toEqual([]);
    expect(twice(h.editor)).toEqual([]);
  });
});
