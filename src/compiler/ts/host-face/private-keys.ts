import type { GlComputeProgram } from '../../../core/passes/gl-compute.js';
import type { StructDecl } from '../../../core/ir/nodes.js';
import type { ShaderType } from '../../../core/ir/types.js';
import { layoutOf } from '../../../core/manifest.js';
import { packLayout, type PackLayout } from '../../../core/manifest-types.js';
import { authorTypeText } from '../context.js';
import type { CollectedStruct } from '../structs.js';
import { shaderField } from '../../../core/host-key.js';

export function privateFieldsOf(
  collected: readonly CollectedStruct[],
): ReadonlyMap<string, ReadonlySet<string>> {
  return new Map(
    collected
      .filter((s) => (s.privateFields?.size ?? 0) > 0)
      .map((s) => [s.decl.name, new Set(s.privateFields!.keys())] as const),
  );
}

export function keyedStructs(
  structs: ReadonlyMap<string, StructDecl>,
  privates: ReadonlyMap<string, ReadonlySet<string>>,
): ReadonlyMap<string, StructDecl> {
  if (privates.size === 0) return structs;
  return new Map(
    [...structs].map(([name, decl]) => {
      const keyed = privates.get(name);
      return [
        name,
        keyed === undefined
          ? decl
          : {
              ...decl,
              fields: decl.fields.map((f) =>
                keyed.has(f.name) ? { ...f, name: `#${f.name}` } : f,
              ),
            },
      ] as const;
    }),
  );
}

export function keyedUniforms(
  gl: GlComputeProgram,
  bindings: readonly { readonly name: string; readonly type: ShaderType }[],
  c: {
    readonly structs: ReadonlyMap<string, StructDecl>;
    readonly cpuStructs: ReadonlyMap<string, StructDecl>;
  },
): GlComputeProgram {
  if (c.structs === c.cpuStructs) return gl;
  const layoutOfUniform = (u: GlComputeProgram['uniforms'][number]): PackLayout => {
    const type = bindings.find((b) => b.name === u.name)?.type;
    if (type === undefined) return u.layout;
    const layout = layoutOf(type, 'std140', c.structs, authorTypeText);
    return 'none' in layout ? u.layout : packLayout(layout);
  };
  return { ...gl, uniforms: gl.uniforms.map((u) => ({ ...u, layout: layoutOfUniform(u) })) };
}

export function writtenName(struct: CollectedStruct, key: string): string {
  return struct.privateFields?.get(shaderField(key))?.written ?? shaderField(key);
}

export function keyedStructsOf(
  structs: ReadonlyMap<string, StructDecl>,
  collected: readonly CollectedStruct[],
): ReadonlyMap<string, StructDecl> {
  return keyedStructs(structs, privateFieldsOf(collected));
}
