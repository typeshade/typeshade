import ts from 'typescript';
import type { ClassLayouts } from '../../../core/class-layouts.js';
import { zeroOf } from '../../../core/cpu-runtime.js';
import type { Layout } from '../../../core/host-entry.js';
import type { HostType } from '../../../core/host-values.js';
import type { StructDecl } from '../../../core/ir/nodes.js';
import type { ShaderType } from '../../../core/ir/types.js';
import { writtenName } from './private-keys.js';
import { layoutOf } from '../../../core/manifest.js';
import {
  isPrivateName,
  isReadonlyMember,
  keywordAccessOf,
  memberDeclarationInChain,
} from '../class-names.js';
import { authorTypeText } from '../context.js';
import type { ClassExport, ClassField, FaceExport } from '../host-face-contracts.js';
import { hostTypeOf } from '../host-types.js';
import { ctorFnName } from '../lower/class-methods.js';
import type { CollectedStruct } from '../structs.js';
import type { FaceCtx } from './context.js';
import { classChain, memberCall, classMembers } from './class-members.js';

export function classFace(
  name: string,
  decl: ts.ClassDeclaration,
  struct: CollectedStruct,
  c: FaceCtx,
): FaceExport {
  const local = struct.decl.name;
  const t: HostType | { readonly none: string } =
    struct.namespace === true
      ? { k: 'struct', f: [], s: local }
      : hostTypeOf({ kind: 'struct', name: local }, c.structs);
  if ('none' in t) {
    const fields = struct.decl.fields.map((f): readonly [string, HostType | undefined] => {
      const ft = hostTypeOf(f.type, c.structs);
      return [f.name, 'none' in ft ? undefined : ft];
    });
    return { kind: 'shape', name, reason: t.none, fields };
  }
  const type = t as HostType & { k: 'struct' };
  const fields = type.f.map(([key, ft]): ClassField => {
    const written = writtenName(struct, key);
    const at = memberDeclarationInChain(decl, written, false);
    const access = isPrivateName(written) || at === undefined ? undefined : keywordAccessOf(at);
    return {
      name: key,
      type: ft,
      ...(access !== undefined ? { access } : {}),
      readonly: at !== undefined && isReadonlyMember(at),
    };
  });
  const bases: string[] = [];
  for (
    let at = struct.bases?.[0];
    at !== undefined && at !== local && !bases.includes(at);
    at = c.collected.find((x) => x.decl.name === at)?.bases?.[0]
  )
    bases.push(at);
  const abstract = struct.abstract === true;
  let ctor: ClassExport['ctor'];
  if (!abstract) {
    const written = classChain(decl)
      .flatMap((k) => k.members.filter(ts.isConstructorDeclaration))
      .find((k) => k.body !== undefined);
    const fn = ctorFnName(local);
    ctor =
      written === undefined && !c.byName.has(fn)
        ? { zero: zeroOf({ kind: 'struct', name: local }, c.cpuStructs) }
        : memberCall(fn, written, false, false, c);
  }
  return {
    kind: 'class',
    name,
    type,
    abstract,
    bases,
    fields,
    layouts: abstract ? { a: 1 } : resourceLayouts(local, c.structs),
    ...(ctor !== undefined ? { ctor } : {}),
    members: classMembers(name, decl, struct, c),
  };
}

function resourceLayouts(name: string, structs: ReadonlyMap<string, StructDecl>): ClassLayouts {
  const t: ShaderType = { kind: 'struct', name };
  const u = layoutOf(t, 'std140', structs, authorTypeText);
  const s = layoutOf({ kind: 'array', elem: t }, 'std430', structs, authorTypeText);
  return {
    ...('none' in u ? { un: u.none } : { u }),
    ...('none' in s ? { sn: s.none } : { s: s as Layout & { k: 'a' } }),
  };
}
