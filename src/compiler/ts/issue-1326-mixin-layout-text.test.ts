import { describe, expect, it } from 'vitest';
import { bothHalves, bothRefuse } from '../../core/testing/both-halves.js';

const program = (use: string): string => `"use typeshade";
class S2 { pos: vec3; }
function A<TB extends AnyClass>(Base: TB) {
  return class extends Base { v: i32; };
}
function B<TB extends AnyClass>(Base: TB) {
  return class extends Base { v = 0; };
}
class D extends B(A(S2)) {}
@fragment export function fs(): vec4 {
  ${use}
  return vec4(1.);
}
`;

const text = (written: string): string =>
  `"D" gets the field "v" twice through its mixins, written "i32" in one and "${written}" in ` +
  `another. One of them decides the layout, and picking either silently would change what the ` +
  `other's code reads. Give them one type, or two names.`;

describe('a mixin field layout message reads the same in both halves (issue 1326)', () => {
  it('names the type of a field written without one', () => {
    bothRefuse(program(''), 'TS8099', text('f32'));
  });

  it('gives the same text when a use would decide the type', () => {
    const h = bothHalves(program('const d = new D();\n  const k: u32 = d.v;'));
    expect(h.compiler[0]).toContain('twice through its mixins');
    expect(h.editor.filter((e) => e.includes('twice'))).toEqual(
      h.compiler.filter((c) => c.includes('twice')),
    );
  });
});
