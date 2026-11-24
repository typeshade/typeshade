import { describe, expect, it } from 'vitest';
import { bothHalves, bothRefuse, bothTake } from '../../core/testing/both-halves.js';

const mixins = (a: string, b: string, use: string): string => `"use typeshade";
class S2 { pos: vec3; }
function A<TB extends AnyClass>(Base: TB) {
  return class extends Base { ${a} };
}
function B<TB extends AnyClass>(Base: TB) {
  return class extends Base { ${b} };
}
class D extends B(A(S2)) {}
class E extends A(S2) {}
class F extends B(S2) {}
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

const useD = (t: string): string => `const d = new D();\n  const k: ${t} = d.v;`;

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

  it('refuses two untyped fields when a use decides one of them as u32', () => {
    bothRefuse(mixins('v = 0;', 'v = 1;', useD('u32')), 'TS8099', text('f32', 'u32'));
  });

  it('refuses two untyped fields when a use decides one of them as i32', () => {
    bothRefuse(mixins('v = 0;', 'v = 1;', useD('i32')), 'TS8099', text('f32', 'i32'));
  });

  it('refuses an untyped integer-written field against a bool', () => {
    const h = bothHalves(mixins('v = 0;', 'v = true;', ''));
    const expected = [`typeshade TS8099: ${text('f32', 'bool')}`];
    expect(twice(h.compiler)).toEqual(expected);
    expect(twice(h.editor)).toEqual(expected);
  });

  it('refuses an untyped integer-written field against a u32 constructor', () => {
    bothRefuse(mixins('v = 0;', 'v = u32(1);', ''), 'TS8099', text('f32', 'u32'));
  });

  it('takes two untyped fields that every use decides as u32', () => {
    const uses = `${useD('u32')}\n  const e = new E();\n  const k2: u32 = e.v;\n  const f = new F();\n  const k3: u32 = f.v;`;
    const h = bothTake(mixins('v = 0;', 'v = 1;', uses));
    expect(twice(h.compiler)).toEqual([]);
  });

  it('refuses two untyped fields that two uses decide as different types', () => {
    const uses = `${useD('u32')}\n  const e = new E();\n  const k2: i32 = e.v;`;
    bothRefuse(mixins('v = 0;', 'v = 1;', uses), 'TS8099', text('i32', 'u32'));
  });

  it('spells an integer-written expression as f32 when no use decides it', () => {
    bothRefuse(mixins('v: i32;', 'v = 1 + 2;', ''), 'TS8099', text('i32', 'f32'));
  });

  it('spells an integer-written expression as the type a use decides', () => {
    bothRefuse(mixins('v = 1 + 2;', 'v = 1 + 2;', useD('u32')), 'TS8099', text('f32', 'u32'));
  });

  it('takes an integer-written expression against an untyped integer-written number', () => {
    bothTake(mixins('v = 0;', 'v = 1 + 2;', ''));
  });

  it('takes a field written f32 against an untyped number with a fraction', () => {
    bothTake(mixins('v: f32;', 'v = 0.5;', ''));
  });

  it('does not name a type for a field that has none, in an equal-typed pair', () => {
    const pairs: ReadonlyArray<readonly [string, string]> = [
      ['v = 1 + 2.;', 'v = 1.;'],
      ['v = 1 + 2.;', 'v = f32(1);'],
      ['v = 7 % 2;', 'v = 1.;'],
      ['v = 1 / 2;', 'v = 1 << 2;'],
      ['v = vec3<f32>(1);', 'v: vec3;'],
      ['v = 1 + 2.;', 'v: i32;'],
    ];
    for (const [a, b] of pairs) {
      const h = bothHalves(mixins(a, b, ''));
      expect(twice(h.compiler), `${a} / ${b}`).toEqual([]);
      expect(twice(h.editor), `${a} / ${b}`).toEqual([]);
      expect(h.compiler.some((l) => l.includes('needs a type'))).toBe(true);
      expect(h.editor.some((l) => l.includes('needs a type'))).toBe(true);
    }
  });
});
