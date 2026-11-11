// ═══ Which exported binding is a host resource (change 0138, R10; Rule 6.1) ═══
//
// One predicate for two readers. `resourceFaces` in `host-face.ts` makes the host view and the
// generated module from it, and `collectBindings` in `bindings.ts` refuses a field named like a
// member of the host accessor (`TS8079`, Amendment A5, D3) only on a binding it calls a resource.
// So the compiler never refuses a field of a binding that the host view declares `never`, and
// never misses one that the view declares a `Uniform<T>` or a `Buffer<T>`.
//
// The class's own facts come from each reader: the host face reads its exported classes, and the
// front end reads the file's class declarations (`classInFile`). Both judge them with
// `classProblem`, so the criteria are one: an exported class, not abstract, with the layout.

import ts from 'typescript';
import type { BindingDecl, StructDecl } from '../../core/ir/nodes.js';
import type { ShaderType } from '../../core/ir/types.js';
import { layoutOf } from '../../core/manifest.js';
import { authorTypeText } from './context.js';

/** What a reader knows of the class of struct `struct`: undefined when no exported class
 *  declares it. `layoutProblem` is why it has no layout of the kind asked for, if it has none. */
export interface ResourceClassFacts {
  /** The name the host imports the class by. */
  readonly name: string;
  readonly abstract: boolean;
  readonly layoutProblem?: string;
}

/** Why a class cannot make a host resource, or undefined when it can. */
export function classProblem(
  struct: string,
  facts: ResourceClassFacts | undefined,
): string | undefined {
  if (facts === undefined) return `its type ${struct} is no class the module exports`;
  if (facts.abstract) return `its class ${facts.name} is abstract`;
  return facts.layoutProblem;
}

/** What an exported binding is to a host. */
export type HostResource =
  | {
      readonly kind: 'resource';
      /** `Uniform` for a `uniform<T>`, `Buffer` for a storage array. */
      readonly resource: 'Uniform' | 'Buffer';
      /** The struct each field of the resource is laid out by: the uniform's, or the element's. */
      readonly struct: ShaderType & { kind: 'struct' };
      /** The exported class, by the name the host imports. */
      readonly cls: string;
      /** A storage array's element count, `null` for one with no size; absent for a uniform. */
      readonly length?: number | null;
    }
  /** A uniform or storage binding that is no host resource, and why. */
  | { readonly kind: 'none'; readonly why: string }
  /** A texture, a sampler, or a binding with no type: not a buffer at all. */
  | { readonly kind: 'other' };

/**
 * The host resource an exported binding is (change 0138, R10; Amendment A3), or why it is none.
 * A `uniform<T>` of a class is a `Uniform<T>`, and a `storage<array<T, N>>` or `storage<array<T>>`
 * of one a `Buffer<T>`. A storage array whose size is an override, a scalar, a vector, a struct no
 * class declares and one `storage<T>` are none. `classOf` gives the facts of the class of a struct,
 * for the uniform layout (`'u'`) or the storage layout (`'s'`).
 */
export function hostResourceOf(
  b: BindingDecl,
  classOf: (struct: string, layout: 'u' | 's') => ResourceClassFacts | undefined,
): HostResource {
  const t = b.type;
  if (b.space === 'uniform' && t.kind === 'struct') {
    const facts = classOf(t.name, 'u');
    const why = classProblem(t.name, facts);
    return why !== undefined
      ? { kind: 'none', why }
      : { kind: 'resource', resource: 'Uniform', struct: t, cls: facts!.name };
  }
  if (b.space === 'storage' && t.kind === 'array' && t.elem.kind === 'struct') {
    if (t.sizeOverride !== undefined)
      return {
        kind: 'none',
        why: 'a storage array whose size is an override has no length a host resource takes',
      };
    const facts = classOf(t.elem.name, 's');
    const why = classProblem(t.elem.name, facts);
    return why !== undefined
      ? { kind: 'none', why }
      : {
          kind: 'resource',
          resource: 'Buffer',
          struct: t.elem,
          cls: facts!.name,
          length: t.size ?? null,
        };
  }
  if (b.space === 'uniform' || b.space === 'storage')
    return {
      kind: 'none',
      why: 'only a uniform of a class and a storage array of a class are host resources at milestone 1 of change 0138',
    };
  return { kind: 'other' };
}

/** The local names a file exports by a list with no module, each with the name it exports it as:
 *  `export { camera as cam }` maps `camera` to `cam`. */
export function exportedByList(sourceFile: ts.SourceFile): Map<string, string> {
  const out = new Map<string, string>();
  for (const stmt of sourceFile.statements)
    if (
      ts.isExportDeclaration(stmt) &&
      !stmt.isTypeOnly &&
      stmt.moduleSpecifier === undefined &&
      stmt.exportClause !== undefined &&
      ts.isNamedExports(stmt.exportClause)
    )
      for (const el of stmt.exportClause.elements)
        if (!el.isTypeOnly && !out.has((el.propertyName ?? el.name).text))
          out.set((el.propertyName ?? el.name).text, el.name.text);
  return out;
}

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind): boolean =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((m) => m.kind === kind) ?? false);

/** The top-level class `name` declares in `sourceFile`, if any. */
export function classDeclarationIn(
  sourceFile: ts.SourceFile,
  name: string,
): ts.ClassDeclaration | undefined {
  return sourceFile.statements.find(
    (s): s is ts.ClassDeclaration => ts.isClassDeclaration(s) && s.name?.text === name,
  );
}

/** The facts of the class of struct `struct` as the file declares it, for `hostResourceOf`: a
 *  top-level class with `export`, or named in an `export { … }` list, under the name it is
 *  exported as. A struct of another file is undefined here, so the front end does not judge it. */
export function classInFile(
  sourceFile: ts.SourceFile,
  structs: ReadonlyMap<string, StructDecl>,
): (struct: string, layout: 'u' | 's') => ResourceClassFacts | undefined {
  const listed = exportedByList(sourceFile);
  return (struct, layout) => {
    const decl = classDeclarationIn(sourceFile, struct);
    if (decl === undefined || !structs.has(struct)) return undefined;
    const name = hasModifier(decl, ts.SyntaxKind.ExportKeyword) ? struct : listed.get(struct);
    if (name === undefined || hasModifier(decl, ts.SyntaxKind.DefaultKeyword)) return undefined;
    const t: ShaderType = { kind: 'struct', name: struct };
    const l =
      layout === 'u'
        ? layoutOf(t, 'std140', structs, authorTypeText)
        : layoutOf({ kind: 'array', elem: t }, 'std430', structs, authorTypeText);
    return {
      name,
      abstract: hasModifier(decl, ts.SyntaxKind.AbstractKeyword),
      ...('none' in l ? { layoutProblem: l.none } : {}),
    };
  };
}
