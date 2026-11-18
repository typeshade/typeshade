import type ts from 'typescript';
import { hostExportsOf, type HostDeclared } from '../host-exports.js';
import { REASON } from '../host-face-shared.js';

export interface ExportRef {
  readonly name: string;
  readonly decl?: HostDeclared;
  readonly missing?: string;
}

export function exportsOf(sf: ts.SourceFile): ExportRef[] {
  return hostExportsOf(sf).map((r) =>
    r.missing === undefined ? r : { name: r.name, missing: REASON[r.missing] },
  );
}
