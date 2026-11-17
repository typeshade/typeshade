import ts from 'typescript';
import type { StructDecl } from '../../../core/ir/nodes.js';
import type { PrivateField, RestrictedField } from '../structs.js';
import {
  PrivateFieldTable,
  WithheldTable,
  ReadonlyFieldTable,
  RestrictedFieldTable,
} from '../context.js';

export function withheldTableOf(
  structs: readonly { readonly decl: StructDecl; readonly withheld?: ReadonlySet<string> }[],
): WithheldTable {
  const out = new Map<string, ReadonlySet<string>>();
  for (const s of structs) {
    if (s.withheld !== undefined && s.withheld.size > 0) out.set(s.decl.name, s.withheld);
  }
  return out;
}

export function restrictedFieldTableOf(
  structs: readonly {
    readonly decl: StructDecl;
    readonly restrictedFields?: ReadonlyMap<string, RestrictedField>;
  }[],
): RestrictedFieldTable {
  const out = new Map<string, ReadonlyMap<string, RestrictedField>>();
  for (const s of structs) {
    if (s.restrictedFields !== undefined && s.restrictedFields.size > 0) {
      out.set(s.decl.name, s.restrictedFields);
    }
  }
  return out;
}

export function readonlyFieldTableOf(
  structs: readonly {
    readonly decl: StructDecl;
    readonly readonlyFields?: ReadonlyMap<string, ts.ClassLikeDeclaration>;
  }[],
): ReadonlyFieldTable {
  const out = new Map<string, ReadonlyMap<string, ts.ClassLikeDeclaration>>();
  for (const s of structs) {
    if (s.readonlyFields !== undefined && s.readonlyFields.size > 0) {
      out.set(s.decl.name, s.readonlyFields);
    }
  }
  return out;
}

export function privateFieldTableOf(
  structs: readonly {
    readonly decl: StructDecl;
    readonly privateFields?: ReadonlyMap<string, PrivateField>;
  }[],
): PrivateFieldTable {
  const out = new Map<string, ReadonlyMap<string, PrivateField>>();
  for (const s of structs) {
    if (s.privateFields !== undefined && s.privateFields.size > 0) {
      out.set(s.decl.name, s.privateFields);
    }
  }
  return out;
}
