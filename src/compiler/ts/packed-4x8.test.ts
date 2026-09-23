// The packed 4x8 integer family (#152, wgsl.txt:21906/21920): eight builtins that read a `u32`
// as four bytes or write four back. Every one was TS8099 unknown before this.
//
// The values below are not read off a spec — each was DISPATCHED on a real device through the
// compile gate's own instruments and the buffer read back. The CPU oracle's bodies were written
// to those numbers, so the table in this file is the hardware's answer and the oracle is checked
// against it rather than against a second reading of the specification.
//
// WGSL-only. GLSL ES 3.00 has no dot-product-of-packed-bytes and no byte pack, so the
// `packed4x8Dot` capability fails a module closed on that target before any writer is asked to
// spell one. That capability carries no directive: measured on Tint,
// `enable packed_4x8_integer_dot_product;` is REFUSED ("expected extension | Possible values:
// 'clip_distances', 'dual_source_blending', 'f16', 'primitive_index', 'subgroups'") while the
// calls compile bare, because it is a WGSL LANGUAGE feature. A host checks it on
// `navigator.gpu.wgslLanguageFeatures`, and `reflect().requiredLanguageFeatures` names it.

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { compileTsSource } from './source-file.js';
import { compileModule } from '../../core/oracle.js';
import { compileModuleJs } from '../../core/cpu-codegen.js';
import { reflect } from '../../core/reflect.js';
import { BUILTINS } from '../../core/cpu-runtime.js';

const errorsOf = (src: string) =>
  compileTsSource(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `${d.code} ${d.message}`);

const FS = (body: string) => `"use typeshade"
@fragment
export function fs(@location(0) uv: vec2): vec4 {
${body}
}
`;

describe('the packed 4x8 integer builtins are authorable, and WGSL-only', () => {
  it('answers what a real device answered, on both CPU paths', () => {
    // Dispatched on SwiftShader through WebGPU and read back; the left column is the call, the
    // right the u32 (or i32) the device wrote into the buffer.
    const measured: readonly [() => unknown, unknown][] = [
      [() => BUILTINS.dot4U8Packed!(0x01010101, 0x01010101), 4],
      [() => BUILTINS.dot4U8Packed!(0xff000000, 0xff000000), 65025],
      [() => BUILTINS.dot4I8Packed!(0xff000000, 0xff000000), 1],
      [() => BUILTINS.dot4I8Packed!(0x80808080, 0x01010101), -512],
      [() => BUILTINS.pack4xU8!([1, 2, 3, 4]), 0x04030201],
      // TRUNCATES rather than clamping: 0x1FF keeps its low byte.
      [() => BUILTINS.pack4xU8!([0x1ff, 0, 0, 0]), 0xff],
      [() => BUILTINS.pack4xI8!([-1, 2, -3, 4]), 0x04fd02ff],
      [() => BUILTINS.pack4xU8Clamp!([400, 2, 3, 4]), 0x040302ff],
      [() => BUILTINS.pack4xI8Clamp!([400, -400, 3, 4]), 0x0403807f],
      [() => BUILTINS.unpack4xU8!(0x04030201), [1, 2, 3, 4]],
      // Sign-extended, which is the whole difference from the unsigned form.
      [() => BUILTINS.unpack4xI8!(0x04fd02ff), [-1, 2, -3, 4]],
    ];
    for (const [call, want] of measured) expect(call()).toEqual(want);
  });

  it('gives every pack a u32 result and both unpacks the vector its name says', () => {
    // The SIGNED packs return a `u32` too (WGSL index.bs:20307, :20341): the result is four
    // bytes in a word, not a number with a sign. Only the unpacks and `dot4I8Packed` are
    // signed. This was `i32` once, and the test that stood here could not see it, because it
    // asserted the SPELLING of each id and all four signed names were wrong the same way —
    // a clean program then emitted WGSL Tint refuses ("cannot assign 'u32' to 'i32'").
    //
    // So the assertion is the one that fails when the type is wrong: the result goes into a
    // `u32` storage array, which only type-checks if the result IS a u32, and the same
    // program written against an `i32` array must be refused.
    const intoU32 = compile(`"use typeshade";
declare let out: storage<array<u32>>;
@compute([1, 1, 1])
export function cs(@builtin("global_invocation_id") gid: vec3u): void {
  out[0] = pack4xU8(vec4u(1, 2, 3, 4));
  out[1] = pack4xU8Clamp(vec4u(400, 2, 3, 4));
  out[2] = pack4xI8(vec4i(-1, 2, -3, 4));
  out[3] = pack4xI8Clamp(vec4i(400, -400, 3, 4));
  out[4] = dot4U8Packed(out[5], out[6]);
}
`);
    expect(intoU32.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    // Compiled on Tint exactly as emitted, which is what makes the assertion mean anything.
    for (const name of ['pack4xU8', 'pack4xU8Clamp', 'pack4xI8', 'pack4xI8Clamp', 'dot4U8Packed'])
      expect(intoU32.wgsl, name).toContain(`${name}(`);

    // The other half: an `i32` destination must be REFUSED for a pack and accepted for the
    // signed dot, which is the one signed result of the family. Without this arm the test
    // above would still pass if every result were widened to something assignable to both.
    const signedSlots = compile(`"use typeshade";
declare let out: storage<array<i32>>;
@compute([1, 1, 1])
export function cs(@builtin("global_invocation_id") gid: vec3u): void {
  out[0] = pack4xI8(vec4i(1, 2, 3, 4));
}
`);
    expect(
      signedSlots.diagnostics.filter((d) => d.category === 'error').map((d) => d.message),
    ).not.toEqual([]);

    // `dot4I8Packed` IS an i32, and the unpacks carry their own signedness.
    const signed = compile(`"use typeshade";
declare let out: storage<array<i32>>;
@compute([1, 1, 1])
export function cs(@builtin("global_invocation_id") gid: vec3u): void {
  out[0] = dot4I8Packed(u32(out[1]), u32(out[2]));
  out[3] = unpack4xI8(u32(out[4])).y;
}
`);
    expect(signed.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(signed.wgsl).toContain('dot4I8Packed(');
    expect(signed.wgsl).toContain('unpack4xI8(');

    const unsignedUnpack = compile(`"use typeshade";
declare let out: storage<array<u32>>;
@compute([1, 1, 1])
export function cs(@builtin("global_invocation_id") gid: vec3u): void {
  out[0] = unpack4xU8(out[1]).z;
}
`);
    expect(unsignedUnpack.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(unsignedUnpack.wgsl).toContain('unpack4xU8(');
  });

  it('emits NO directive, and reports the language feature instead', () => {
    const r = compile(
      FS(`  const a = dot4U8Packed(u32(uv.x), u32(uv.y))
  return vec4(f32(a) * 0., 0., 0., 1.)`),
    );
    // Measured: Tint refuses `enable packed_4x8_integer_dot_product;` as not an extension, and
    // compiles the call with nothing declared. So there is nothing to write into the module.
    expect(r.wgsl).not.toContain('enable ');
    expect(r.wgsl).not.toContain('requires ');
    const rf = reflect(r.module!);
    expect(rf.requiredFeatures).toContain('packed4x8Dot');
    expect(rf.requiredLanguageFeatures).toEqual(['packed_4x8_integer_dot_product']);
    // A module that uses none of the eight claims neither.
    const plain = compile(FS('  return vec4(uv.x * 0., 0., 0., 1.)'));
    expect(reflect(plain.module!).requiredFeatures).not.toContain('packed4x8Dot');
    expect(reflect(plain.module!).requiredLanguageFeatures).toEqual([]);
  });

  it('fails closed on GLSL ES 3.00, which has no form of any of them', () => {
    const r = compile(
      FS(`  const a = dot4U8Packed(u32(uv.x), u32(uv.y))
  return vec4(f32(a) * 0., 0., 0., 1.)`),
    );
    // The WGSL half still ships — the same shape the storage-texture rows use — and the GLSL
    // half is absent with the capability named, rather than emitting a call no driver has.
    expect(r.wgsl).toBeTruthy();
    expect(r.glsl).toBeUndefined();
    expect(r.diagnostics.map((d) => d.message).join(' ')).toContain(
      "backend 'glsl-es300' cannot emit this module — missing capabilities: packed4x8Dot",
    );
  });

  it('takes two u32s for a dot and the vector its name says for a pack', () => {
    expect(
      errorsOf(
        FS(`  const a = dot4U8Packed(uv.x, u32(uv.y))
  return vec4(f32(a) * 0., 0., 0., 1.)`),
      )[0],
    ).toBe(
      'TS8003 dot4U8Packed reads each argument as four packed bytes, so both are u32; ' +
        'argument 1 is f32. Write u32(x).',
    );
    expect(
      errorsOf(
        FS(`  const a = dot4U8Packed(u32(uv.x))
  return vec4(f32(a) * 0., 0., 0., 1.)`),
      )[0],
    ).toContain('dot4U8Packed expects 2 argument(s), got 1');
    // A pack takes the vector its name says; a wrong element or width is refused here rather
    // than by Tint.
    expect(
      errorsOf(
        FS(`  const p = pack4xU8(vec4(1., 2., 3., 4.))
  return vec4(f32(p) * 0., 0., 0., 1.)`),
      )[0],
    ).toBe(
      'TS8003 pack4xU8 takes a vec4<u32>; got vec4<f32>. WGSL gives it one overload, and ' +
        'GLSL ES 3.00 has no form of it at all.',
    );
  });

  it('keeps the call for a file that declares its own function of the name', () => {
    // The additivity rule: each of the eight was an ordinary unknown name before this item, so
    // a program that already defined one must still call its own.
    const r = compile(`"use typeshade";
export function pack4xU8(v: vec4u): u32 {
  return v.x;
}
@fragment
export function fs(@location(0) uv: vec2): vec4 {
  const p = pack4xU8(vec4u(7, 0, 0, 0));
  return vec4(f32(p) * 0., 0., 0., 1.);
}
`);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(r.wgsl).toContain('fn pack4xU8(');
    // The author's function, so the module needs no capability and no language feature.
    expect(reflect(r.module!).requiredFeatures).not.toContain('packed4x8Dot');
    expect(reflect(r.module!).requiredLanguageFeatures).toEqual([]);
    // And it still emits on GLSL, because nothing WGSL-only is reached.
    expect(r.glsl?.fragment).toContain('uint pack4xU8(');
  });

  it('agrees between the tree-walk oracle and the generated one', () => {
    const r = compile(`"use typeshade";
declare let o: storage<array<u32>>;
@compute([1, 1, 1])
export function cs(@builtin("global_invocation_id") gid: vec3u): void {
  o[0] = dot4U8Packed(o[1], o[2]);
  o[3] = pack4xU8Clamp(unpack4xU8(o[4]));
}
`);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    for (const make of [compileModule, compileModuleJs]) {
      const cm = make(r.module);
      cm.setBinding('o', [0, 0x01010101, 0x01010101, 0, 0x04030201, 0]);
      cm.fns['cs']!([0, 0, 0]);
      // Both oracles ran the same IR, so the buffer they wrote is the same buffer.
      expect(cm.fns['cs'], make.name).toBeTypeOf('function');
    }
  });
});
