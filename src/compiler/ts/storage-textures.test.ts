// Storage textures and `textureStore` (roadmap 0.4 item 10).
//
// An image a shader reads and writes by texel coordinate, with no sampler and no filtering.
// Its OWN IR kind rather than another `dim` on `texture`: a sampled texture is read through a
// sampler and carries an element type, a storage one is addressed directly and carries a FORMAT
// and an ACCESS mode, and keeping them apart makes every site that must decide about storage
// textures fail to compile until it does.
//
// The format and the access mode are written as string LITERAL types, which is what lets `tsc`
// check a mistyped format in the editor before this compiler sees the file — the ambient lib
// carries the same sixteen formats, the same read_write rule and a conditional type for the
// texel, so the editor and the compiler refuse the same programs.
//
// Two of the refusals below are things TINT DOES NOT REFUSE, and that is the point of them.
// Tint compiles a shader; a device binds one. Tint accepts every format at every access mode,
// while a real device accepts `read_write` at three formats only and accepts no format outside
// the sixteen without a feature request. Both were measured by asking a device to build a bind
// group layout for each pair. A spelling Tint takes and a device refuses passes the compile
// gate and then fails at `createBindGroupLayout` — the shape issue #113 was.

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { compileTsSource } from './source-file.js';
import { reflect } from '../../core/reflect.js';

const errorsOf = (src: string) =>
  compileTsSource(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => d.message);

const wgslOf = (src: string): string => {
  const r = compile(src);
  expect(r.diagnostics.filter((d) => d.category === 'error').map((d) => d.message)).toEqual([]);
  return r.wgsl ?? '';
};

const compute = (bindings: string, body: string): string => `"use typeshade"
${bindings}
@compute([64, 1, 1])
export function cs(@builtin("global_invocation_id") gid: vec3u): void {
${body}
}
`;

describe('the binding', () => {
  it('declares as a handle, with the format and the access inside the type', () => {
    const wgsl = wgslOf(
      compute(
        `declare const dst: texture_storage_2d<"rgba8unorm", "write">`,
        `  textureStore(dst, vec2i(i32(gid.x), 0), vec4(1., 0., 0., 1.))`,
      ),
    );
    // No address space: a storage texture is a handle, like a sampled texture and a sampler,
    // even though it is written through.
    expect(wgsl).toContain('@group(0) @binding(0) var dst: texture_storage_2d<rgba8unorm, write>;');
    expect(wgsl).toContain(
      'textureStore(dst, vec2<i32>(i32(gid.x), 0), vec4<f32>(1.0, 0.0, 0.0, 1.0));',
    );
  });

  it('takes the array form', () => {
    const wgsl = wgslOf(
      compute(
        `declare const dst: texture_storage_2d_array<"rgba8unorm", "write">`,
        `  textureStore(dst, vec2i(i32(gid.x), 0), 0, vec4(1., 0., 0., 1.))`,
      ),
    );
    expect(wgsl).toContain('var dst: texture_storage_2d_array<rgba8unorm, write>;');
  });

  it('retypes the array layer to an integer, and refuses a fractional one', () => {
    // A bare `0` lowers to an f32 on this surface; WGSL's storage forms take an integer layer,
    // so `0.0` was emitted and Tint refused it ("no matching call"). Found by the spec audit.
    const store = wgslOf(
      compute(
        `declare const dst: texture_storage_2d_array<"rgba8unorm", "write">`,
        `  textureStore(dst, vec2i(i32(gid.x), 0), 0, vec4(1., 0., 0., 1.))`,
      ),
    );
    expect(store).toContain(
      'textureStore(dst, vec2<i32>(i32(gid.x), 0), 0, vec4<f32>(1.0, 0.0, 0.0, 1.0));',
    );
    const load = wgslOf(
      compute(
        `declare const src: texture_storage_2d_array<"r32float", "read">\ndeclare let out: storage<array<vec4>>`,
        `  out[gid.x] = textureLoad(src, vec2i(0, 0), 1)`,
      ),
    );
    expect(load).toContain('textureLoad(src, vec2<i32>(0, 0), 1)');
    // Not a float layer, which is the shape Tint refused: the assertion above would pass on
    // `textureStore(dst, …, 0.0, vec4<f32>(…))` if the layer ever stopped being retyped.
    expect(store).not.toMatch(/0\.0,\s*vec4/);
    expect(
      errorsOf(
        compute(
          `declare const dst: texture_storage_2d_array<"rgba8unorm", "write">`,
          `  textureStore(dst, vec2i(0, 0), 1.5, vec4(1., 0., 0., 1.))`,
        ),
      ),
    ).toEqual([
      'A texture layer must be a whole number of 0 or more, got 1.5. WGSL rejects a fractional or negative one and GLSL ES 3.00 silently rounds it, so the two targets would disagree.',
    ]);
  });

  it('refuses a coordinate of the wrong width or element kind on a storage texture', () => {
    // The storage path checked ARITY only, on the claim that the coordinate was "left to the
    // ordinary argument check" — there is none. Tint answers "no matching overload" for both
    // (`C` is a `vec2` of `i32` or `u32`, wgsl.txt:24255, 25342).
    expect(
      errorsOf(
        compute(
          `declare const src: texture_storage_2d<"r32float", "read">\ndeclare let out: storage<array<vec4>>`,
          `  out[gid.x] = textureLoad(src, vec3i(0, 0, 0))`,
        ),
      ),
    ).toEqual([
      'textureLoad on a texture_storage_2d<r32float, read> takes a vec2 coordinate; got vec3<i32>.',
    ]);
    expect(
      errorsOf(
        compute(
          `declare const dst: texture_storage_2d<"rgba8unorm", "write">`,
          `  textureStore(dst, vec3i(0, 0, 0), vec4(1., 0., 0., 1.))`,
        ),
      ),
    ).toEqual([
      'textureStore on a texture_storage_2d<rgba8unorm, write> takes a vec2 coordinate; got vec3<i32>.',
    ]);
    expect(
      errorsOf(
        compute(
          `declare const dst: texture_storage_2d<"rgba8unorm", "write">`,
          `  textureStore(dst, vec2(0., 0.), vec4(1., 0., 0., 1.))`,
        ),
      ),
    ).toEqual([
      'textureStore on a texture_storage_2d<rgba8unorm, write> takes an integer coordinate, an i32 or a u32; got vec2<f32>.',
    ]);
    // A vec2u is the other integer coordinate WGSL takes, and is written as it is.
    expect(
      wgslOf(
        compute(
          `declare const dst: texture_storage_2d<"rgba8unorm", "write">`,
          `  textureStore(dst, vec2u(gid.x, gid.y), vec4(1., 0., 0., 1.))`,
        ),
      ),
    ).toContain('textureStore(dst, vec2<u32>(gid.x, gid.y), vec4<f32>(1.0, 0.0, 0.0, 1.0));');
  });

  it('refuses a read of a writable storage texture from a vertex entry', () => {
    // A resource with write or read_write access must not be reached from a vertex stage at
    // all (wgsl.txt:7741-7743, 15343-15347), so the READ of one is refused with the write. The
    // neutral id is the sampled fetch's, so the texture's own type decides, not the name: a
    // "read" storage texture and every sampled fetch stay legal in a vertex entry.
    const vs = (decl: string, body: string): string => `"use typeshade"
class Clip { @builtin("position") pos: vec4 }
${decl}
@vertex
export function vs(@builtin("vertex_index") i: u32): Clip {
${body}
}
`;
    expect(
      errorsOf(
        vs(
          `declare const acc: texture_storage_2d<"r32float", "read_write">`,
          `  const v = textureLoad(acc, vec2i(0, 0))\n  return { pos: vec4(v.x, 0., 0., 1.) }`,
        ),
      ),
    ).toEqual([
      '"textureLoad" is only valid in a fragment or compute shader; "vs" is a vertex entry. A storage texture declared "read_write" must not be reached from a vertex stage at all, so reading or measuring one there is refused with writing it. (A "write" one refuses the read itself, whatever the stage.)',
    ]);
    expect(
      errorsOf(
        vs(
          `declare const acc: texture_storage_2d<"r32float", "read">`,
          `  const v = textureLoad(acc, vec2i(0, 0))\n  return { pos: vec4(v.x, 0., 0., 1.) }`,
        ),
      ),
    ).toEqual([]);
  });

  it('answers textureNumLayers on a storage array', () => {
    // The storage path had arms for textureDimensions, textureLoad and textureStore and
    // nothing else, so every other read fell through to "takes a sampled texture; … has no
    // sampler" — the wrong answer AND the wrong reason. Measured accepted on Tint.
    const wgsl = wgslOf(
      compute(
        `declare const src: texture_storage_2d_array<"r32float", "read">\ndeclare let out: storage<array<u32>>`,
        `  out[gid.x] = textureNumLayers(src)`,
      ),
    );
    expect(wgsl).toContain('textureNumLayers(src)');
    // A storage texture with no layers says so, rather than talking about samplers.
    expect(
      errorsOf(
        compute(
          `declare const src: texture_storage_2d<"r32float", "read">\ndeclare let out: storage<array<u32>>`,
          `  out[gid.x] = textureNumLayers(src)`,
        ),
      ),
    ).toEqual([
      'textureNumLayers needs a texture_storage_2d_array; "texture_storage_2d<r32float, read>" has no layers.',
    ]);
  });

  it('takes bgra8unorm at write, refuses it at read, and derives the capability', () => {
    // The seventeenth format, and the only one that is not core (#147). Measured on two
    // Chromium builds, asking a device for a bind group layout at each access mode:
    //
    //   default device          bgra8unorm write-only -> "Texture format
    //                           TextureFormat::BGRA8Unorm does not support storage texture
    //                           access StorageTextureAccess::WriteOnly"
    //   + bgra8unorm-storage    write-only -> builds; read-only and read-write -> same refusal
    //
    // Tint compiles every one of those spellings, so neither the compile gate nor any shader
    // compiler can tell them apart. The capability is what carries the requirement to the host,
    // and the access rule is what stops the two spellings no device binds.
    const src = compute(
      `declare const dst: texture_storage_2d<"bgra8unorm", "write">`,
      `  textureStore(dst, vec2i(i32(gid.x), 0), vec4(1., 0., 0., 1.))`,
    );
    expect(errorsOf(src)).toEqual([]);
    const r = compile(src);
    expect(r.wgsl).toContain('texture_storage_2d<bgra8unorm, write>');
    // The host learns which feature to request, from the module's own shape.
    expect(reflect(r.module!).requiredFeatures).toContain('bgra8unormStorage');
    // An ordinary format derives no such thing, so the capability really is about this one.
    expect(
      reflect(
        compile(
          compute(
            `declare const dst: texture_storage_2d<"rgba8unorm", "write">`,
            `  textureStore(dst, vec2i(i32(gid.x), 0), vec4(1., 0., 0., 1.))`,
          ),
        ).module!,
      ).requiredFeatures,
    ).not.toContain('bgra8unormStorage');
    // Read and read_write are refused, with the reason that is about this format.
    for (const access of ['read', 'read_write']) {
      expect(
        errorsOf(
          compute(
            `declare const dst: texture_storage_2d<"bgra8unorm", "${access}">`,
            `  textureStore(dst, vec2i(i32(gid.x), 0), vec4(1., 0., 0., 1.))`,
          ),
        )[0],
      ).toContain('"bgra8unorm" is "write" only.');
    }
  });

  it('reports the WGSL language feature a readable storage texture needs', () => {
    // A language feature is not a device feature: it is not requested at requestDevice, it is
    // either in the browser's WGSL implementation or not. Measured on Chromium:
    // `navigator.gpu.wgslLanguageFeatures` reports
    // `readonly_and_readwrite_storage_textures`, the module compiles with and without a
    // `requires` directive, and a `requires` naming a feature the browser lacks is refused —
    // so the check belongs at the host, before the module is built.
    //
    // The DIRECTIVE is emitted as well, since §50 gave the `requires` axis a writer (#146):
    // `requires readonly_and_readwrite_storage_textures;` is accepted by the Tint the compile
    // gate runs, and a module binding a storage texture at `read` depends on the extension to
    // be a program at all — the bare `read` access mode needs it too, so the directive names a
    // dependency the module already has rather than adding one. Reporting it for the host to
    // check and writing it in the source are both true; the assertion below is the reported
    // half, and the emitted half is the line after it. Not every reported row is written:
    // `packed_4x8_integer_dot_product` is reported and emits nothing, because those builtins
    // compile bare and the directive changes nothing (see `REQUIRES_DIRECTIVE`).
    const readable = compile(
      compute(
        `declare const src: texture_storage_2d<"r32float", "read">\ndeclare let out: storage<array<u32>>`,
        `  out[gid.x] = textureDimensions(src).x`,
      ),
    );
    expect(reflect(readable.module!).requiredLanguageFeatures).toEqual([
      'readonly_and_readwrite_storage_textures',
    ]);
    expect(readable.wgsl).toContain('requires readonly_and_readwrite_storage_textures;');
    // A write-only storage texture is core WGSL and needs none.
    const writeOnly = compile(
      compute(
        `declare const dst: texture_storage_2d<"r32float", "write">`,
        `  textureStore(dst, vec2i(i32(gid.x), 0), vec4(1., 0., 0., 1.))`,
      ),
    );
    expect(reflect(writeOnly.module!).requiredLanguageFeatures).toEqual([]);
  });

  it('refuses a mip level on a storage textureDimensions, which has no levels', () => {
    // The sampled and depth textures gained the two-argument form with this item; a storage
    // texture must NOT, and the difference is measured rather than reasoned. Tint answers
    // `no matching call to 'textureDimensions(texture_storage_2d<r32float, read>, u32)'` for
    // the second argument and compiles the one-argument form, because a storage texture has
    // exactly one mip level.
    expect(
      errorsOf(
        compute(
          `declare const src: texture_storage_2d<"r32float", "read">\ndeclare let out: storage<array<u32>>`,
          `  out[gid.x] = textureDimensions(src, 0).x`,
        ),
      ),
    ).toEqual([
      'textureDimensions on a texture_storage_2d<r32float, read> takes the texture alone: a ' +
        'storage texture has one mip level, so there is no level to ask for.',
    ]);
    expect(
      wgslOf(
        compute(
          `declare const src: texture_storage_2d<"r32float", "read">\ndeclare let out: storage<array<u32>>`,
          `  out[gid.x] = textureDimensions(src).x`,
        ),
      ),
    ).toContain('textureDimensions(src)');
  });

  it('refuses a QUERY of a writable storage texture from a vertex entry too', () => {
    // The rule is about the RESOURCE, not the builtin: "a resource with write or read_write
    // access must not be statically accessed by a vertex shader" (wgsl.txt:15343-15347). So it
    // cannot be a list of names — `textureDimensions` is the id a sampled texture uses — and a
    // size query of a writable storage texture is refused with the read and the write.
    const vs = (decl: string): string => `"use typeshade"
class Clip { @builtin("position") pos: vec4 }
${decl}
@vertex
export function vs(@builtin("vertex_index") i: u32): Clip {
  const d = textureDimensions(acc)
  return { pos: vec4(f32(d.x), 0., 0., 1.) }
}
`;
    expect(errorsOf(vs(`declare const acc: texture_storage_2d<"r32float", "read_write">`))).toEqual(
      [
        '"textureDimensions" is only valid in a fragment or compute shader; "vs" is a vertex entry. A storage texture declared "read_write" must not be reached from a vertex stage at all, so reading or measuring one there is refused with writing it. (A "write" one refuses the read itself, whatever the stage.)',
      ],
    );
    // A "read" storage texture is reachable from a vertex stage, so its query is legal there.
    expect(errorsOf(vs(`declare const acc: texture_storage_2d<"r32float", "read">`))).toEqual([]);
  });

  it('refuses textureStore in a vertex entry, and in a helper the entry reaches', () => {
    // Tint's table gives textureStore @stage("fragment", "compute"); a vertex entry writing a
    // texture compiled clean here and failed at pipeline creation. Found by the spec audit.
    const vertex = (fns: string): string => `"use typeshade"
declare const dst: texture_storage_2d<"rgba8unorm", "write">
class Clip {
  @builtin("position") pos: vec4;
}
${fns}
`;
    expect(
      errorsOf(
        vertex(`@vertex
export function vs(@builtin("vertex_index") i: u32): Clip {
  textureStore(dst, vec2i(0, 0), vec4(1., 0., 0., 1.))
  return { pos: vec4(0., 0., 0., 1.) }
}`),
      ),
    ).toEqual([
      '"textureStore" is only valid in a fragment or compute shader; "vs" is a vertex entry. WGSL allows a texture write in a fragment or compute stage only.',
    ]);
    expect(
      errorsOf(
        vertex(`function write(): void {
  textureStore(dst, vec2i(0, 0), vec4(1., 0., 0., 1.))
}
@vertex
export function vs(@builtin("vertex_index") i: u32): Clip {
  write()
  return { pos: vec4(0., 0., 0., 1.) }
}`),
      ),
    ).toEqual([
      '"textureStore" is only valid in a fragment or compute shader; "write" is reachable from the vertex entry "vs". WGSL allows a texture write in a fragment or compute stage only.',
    ]);
  });

  it('defaults the access mode to write, as the ambient lib does', () => {
    const wgsl = wgslOf(
      compute(
        `declare const dst: texture_storage_2d<"rgba8unorm">`,
        `  textureStore(dst, vec2i(i32(gid.x), 0), vec4(1.))`,
      ),
    );
    expect(wgsl).toContain('texture_storage_2d<rgba8unorm, write>');
  });

  it('is not a module variable', () => {
    const errors = errorsOf(`"use typeshade";
let dst: texture_storage_2d<"rgba8unorm", "write">;
@compute([64, 1, 1])
export function cs(@builtin("global_invocation_id") gid: vec3u): void {
  textureStore(dst, vec2i(0, 0), vec4(1.));
}
`);
    expect(errors[0]).toContain(
      'a storage texture is a resource, declared bare with "declare const"',
    );
  });
});

describe('what the format decides', () => {
  it('stores a vec4u to an integer format', () => {
    const wgsl = wgslOf(
      compute(
        `declare const ids: texture_storage_2d<"rgba8uint", "write">`,
        `  textureStore(ids, vec2i(0, 0), vec4u(gid.x, gid.y, u32(1), u32(255)))`,
      ),
    );
    expect(wgsl).toContain('texture_storage_2d<rgba8uint, write>');
    expect(wgsl).toContain('vec4<u32>(gid.x, gid.y, 1u, 255u)');
  });

  it('refuses the wrong texel type, as Tint does, in its own words', () => {
    const errors = errorsOf(
      compute(
        `declare const ids: texture_storage_2d<"rgba8uint", "write">`,
        `  textureStore(ids, vec2i(0, 0), vec4(1.))`,
      ),
    );
    expect(errors[0]).toContain('stores a vec4<u32>; got vec4<f32>');
    expect(errors[0]).toContain('a "…uint" format stores a vec4u');
  });
});

describe('what the access mode decides', () => {
  it('refuses a load from a write-only texture', () => {
    const errors = errorsOf(
      compute(
        `declare const dst: texture_storage_2d<"rgba8unorm", "write">`,
        `  textureStore(dst, vec2i(0, 0), textureLoad(dst, vec2i(0, 0)))`,
      ),
    );
    expect(errors[0]).toContain('is write-only, so textureLoad cannot read it');
  });

  it('refuses a store to a read-only texture', () => {
    const errors = errorsOf(
      compute(
        `declare const src: texture_storage_2d<"rgba8unorm", "read">`,
        `  textureStore(src, vec2i(0, 0), vec4(1.))`,
      ),
    );
    expect(errors[0]).toContain('is read-only, so textureStore cannot write it');
  });

  it('takes both ways on a format a device reads and writes', () => {
    const wgsl = wgslOf(
      compute(
        `declare const acc: texture_storage_2d<"r32float", "read_write">`,
        `  const old = textureLoad(acc, vec2i(0, 0))\n  textureStore(acc, vec2i(0, 0), vec4(old.x + 1., 0., 0., 0.))`,
      ),
    );
    expect(wgsl).toContain('texture_storage_2d<r32float, read_write>');
    expect(wgsl).toContain('textureLoad(acc,');
    expect(wgsl).toContain('textureStore(acc,');
  });
});

describe('what a DEVICE refuses and Tint does not', () => {
  it('refuses read_write on a format no device reads and writes, in one sentence', () => {
    // Tint compiles `texture_storage_2d<rgba8unorm, read_write>` without a word. A device
    // answers "Texture format TextureFormat::RGBA8Unorm does not support storage texture access
    // StorageTextureAccess::ReadWrite" at createBindGroupLayout, which no compile gate reaches.
    const errors = errorsOf(
      compute(
        `declare const acc: texture_storage_2d<"rgba8unorm", "read_write">`,
        `  textureStore(acc, vec2i(0, 0), vec4(1.))`,
      ),
    );
    // The type is still returned after the report, so this is the WHOLE of what it says: no
    // second refusal at the use and no "Unknown identifier" at every read of the binding.
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('"rgba8unorm" cannot be read_write');
    expect(errors[0]).toContain('"r32uint", "r32sint", "r32float"');
  });

  it('refuses a format outside the sixteen every device stores to', () => {
    const errors = errorsOf(
      compute(
        `declare const dst: texture_storage_2d<"rg16float", "write">`,
        `  textureStore(dst, vec2i(0, 0), vec4(1.))`,
      ),
    );
    expect(errors[0]).toContain('needs a texel format written as a string');
    expect(errors[0]).toContain('fails when the host builds the bind group');
  });
});

describe('a sampled texture and a storage one are different things', () => {
  it('refuses textureStore on a sampled texture, naming the declaration to write', () => {
    const errors = errorsOf(
      compute(`declare const tex: texture_2d<f32>`, `  textureStore(tex, vec2i(0, 0), vec4(1.))`),
    );
    expect(errors[0]).toContain('is a sampled texture, which is read through a sampler');
    expect(errors[0]).toContain('texture_storage_2d<"rgba8unorm", "write">');
  });

  it('refuses textureSample on a storage texture, naming what does read it', () => {
    const errors = errorsOf(
      compute(
        `declare const dst: texture_storage_2d<"rgba8unorm", "read">\ndeclare const smp: sampler`,
        `  const v = textureSample(dst, smp, vec2(0.5))\n  const _keep = v.x`,
      ),
    );
    expect(errors[0]).toContain('is a storage texture, which is read and written by texel');
    expect(errors[0]).toContain('textureLoad and textureStore');
  });
});

describe('what the host is told', () => {
  it('reflects the format and the access in WebGPU spelling', () => {
    const r = compile(
      compute(
        `declare const dst: texture_storage_2d<"rgba8unorm", "write">\ndeclare const acc: texture_storage_2d_array<"r32float", "read_write">`,
        `  textureStore(dst, vec2i(0, 0), vec4(1.))\n  textureStore(acc, vec2i(0, 0), 0, textureLoad(acc, vec2i(0, 0), 0))`,
      ),
    );
    expect(r.diagnostics.filter((d) => d.category === 'error').map((d) => d.message)).toEqual([]);
    const entries = reflect(r.module).bindGroups.flatMap((g) => g.entries);
    const dst = entries.find((e) => e.name === 'dst')!;
    expect(dst.resourceKind).toBe('storage-texture');
    expect(dst.storageFormat).toBe('rgba8unorm');
    // WebGPU's spelling, not WGSL's: a host passing `write` through gets a validation error.
    expect(dst.storageAccess).toBe('write-only');
    expect(dst.textureDim).toBe('2d');
    const acc = entries.find((e) => e.name === 'acc')!;
    expect(acc.storageFormat).toBe('r32float');
    expect(acc.storageAccess).toBe('read-write');
    expect(acc.textureDim).toBe('2d-array');
  });

  it('requires the storageTexture capability, so GLSL fails closed', () => {
    const r = compile(
      compute(
        `declare const dst: texture_storage_2d<"rgba8unorm", "write">`,
        `  textureStore(dst, vec2i(0, 0), vec4(1.))`,
      ),
    );
    expect(reflect(r.module).requiredFeatures).toContain('storageTexture');
    // GLSL ES 3.00 has no image load/store — that is ES 3.10 — so the module emits WGSL alone.
    expect(
      compile(
        compute(
          `declare const dst: texture_storage_2d<"rgba8unorm", "write">`,
          `  textureStore(dst, vec2i(0, 0), vec4(1.))`,
        ),
      ).glsl,
    ).toBeUndefined();
  });
});

describe('the write is an effect', () => {
  it('survives an optimizer that drops a pure call', () => {
    // A `textureStore` returns nothing, so a pass that treated it as pure would drop every one
    // of them and emit an entry whose body does nothing at all.
    const wgsl = wgslOf(
      compute(
        `declare const dst: texture_storage_2d<"rgba8unorm", "write">`,
        `  textureStore(dst, vec2i(0, 0), vec4(0.25))\n  textureStore(dst, vec2i(1, 0), vec4(0.5))\n  textureStore(dst, vec2i(2, 0), vec4(0.75))`,
      ),
    );
    expect(wgsl.match(/textureStore\(/g)).toHaveLength(3);
  });
});

// P0-4 (second half) and P0-5 of the spec audit's tests critique (#155). The storage path in
// `lower/expression-call.ts` runs neither the coordinate-width check the sampled path runs nor
// the vertex-stage rule `textureStore` got, so both shapes below compile clean here and Tint
// refuses the emit. Written as `it.fails` so the lane that adds the check flips them.
//
// THE VERTEX ROW IS ALSO PINNED STRUCTURALLY, as the `STAGE_GAPS` entries of
// `src/core/spec-conformance/coredef-texture-overloads.test.ts`, which reaches it per core.def
// OVERLOAD rather than per program. Closing #145 empties that allowlist and flips this row, in
// the same commit; the two are deliberate duplicates, one by case and one by class.
describe('what the storage path checks, and the two rows #164 closed', () => {
  const store = (decls: string, body: string): string => `"use typeshade"
${decls}
@compute([64, 1, 1])
export function cs(@builtin("global_invocation_id") gid: vec3u): void {
${body}
}
`;

  const WRONG_WIDTH = store(
    `declare const acc: texture_storage_2d<"r32float", "read_write">`,
    `  const v = textureLoad(acc, vec3i(0, 0, 0))
  textureStore(acc, vec2i(0, 0), v)`,
  );

  const VERTEX_READ = `"use typeshade";
declare const src: texture_storage_2d<"r32float", "read_write">;
class Clip {
  @builtin("position") pos: vec4;
}
@vertex
export function vs(@builtin("vertex_index") i: u32): Clip {
  const v = textureLoad(src, vec2i(0, 0));
  return { pos: v };
}
`;

  // Both rows were `it.fails` against an emit Tint refuses — the coordinate one measured as
  // "no matching call to 'textureLoad(texture_storage_2d<r32float, read_write>, vec3<i32>)'"
  // (wgsl.txt:24255), the vertex one as a read `core.def:1585-1589` stages `fragment, compute`
  // exactly as `textureStore`. #164 closed both, so each now asserts the sentence the front end
  // says instead of the WGSL it used to emit.
  it('refuses a coordinate of the wrong width, as on a sampled texture', () => {
    // The wrong-width call is also why `v` never binds. Its later use used to add an "Unknown
    // identifier" to the refusal; asserted exactly, so a reader sees that one mistake now
    // yields exactly one diagnostic (Rule 12.4, #171).
    expect(errorsOf(WRONG_WIDTH)).toEqual([
      'textureLoad on a texture_storage_2d<r32float, read_write> takes a vec2 coordinate; got vec3<i32>.',
    ]);
    expect(compile(WRONG_WIDTH).wgsl).toBeUndefined();
  });

  it('takes the vec2 coordinate the refusal asks for', () => {
    // The remedy has to work, or the rule reads as a ban on `read_write` loads.
    const ok = store(
      `declare const acc: texture_storage_2d<"r32float", "read_write">`,
      `  const v = textureLoad(acc, vec2i(0, 0))
  textureStore(acc, vec2i(0, 0), v)`,
    );
    expect(errorsOf(ok)).toEqual([]);
    expect(wgslOf(ok)).toContain('textureLoad(acc, vec2<i32>(0, 0))');
  });

  it('refuses a storage read reachable from a vertex entry, naming the access mode', () => {
    // The sentence carries the rule that makes it a RESOURCE rule rather than a name rule,
    // which is the distinction #164 turned on: a `read_write` texture is unreachable from a
    // vertex stage entirely, so measuring one there is refused along with writing it.
    const errors = errorsOf(VERTEX_READ);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('"textureLoad" is only valid in a fragment or compute shader');
    expect(errors[0]).toContain('"vs" is a vertex entry');
    expect(errors[0]).toContain('must not be reached from a vertex stage');
  });
});
