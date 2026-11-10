// Implements: Rule 6.6 (docs/language-design.md; traced in reqs/).
//
// The type a `builtin<N, …>` writes, read once for the whole file (change 0135, decision D1.2).
//
// A built-in value takes its type from WGSL (`WGSL_BUILTIN_TYPES`), so the language's form
// writes none: `builtin<"vertex_index">`, and an option second, `builtin<"position", {
// invariant: true }>`. Three forms are answered here, each once, where it is written:
//
//   builtin<"vertex_index", u32>      the migration form: the written type is WGSL's. It still
//                                     compiles in the release that ships change 0135, with a
//                                     `TS8028` warning that names the short form and
//                                     `tshc migrate`; the release after it refuses the type.
//   builtin<"clip_distances">         `clip_distances` is the one name whose type the author
//                                     chooses, `array<f32, N>`: refused, `TS8003`.
//   builtin<"vertx_index">            a name WGSL does not have, with no type to read on: the
//                                     name's own refusal, `TS8024`, said here because the
//                                     declaration it would be read on has no type to lower.
//
// A written type that is not WGSL's keeps its own refusal (`checkBuiltinType`, `TS8003`), and
// nothing is said here about it (Rule 12.4).
//
// The short form's text is one authority: `tshc migrate` (`src/cli/migrate.ts`) rewrites a
// migration form to `shortBuiltinForm`, the text the warning names.
import ts from 'typescript';
import { typeKey } from '../../core/ir/types.js';
import { WGSL_BUILTIN_TYPES, type FixedTypeBuiltinName } from '../../core/sot.js';
import { MAX_CLIP_DISTANCES, attributeArgumentsOf, builtinNameOf } from './attribute-types.js';
import { checkBuiltinName } from './builtin-check.js';
import { TS_CODES } from './codes.js';
import { authorTypeText } from './context.js';
import { declaredTypeNames } from './decorated-form.js';
import { makeDiagnostic } from './diagnostic.js';
import type { TsCompilerDiagnostic } from './source-file.js';
import { mapTsTypeToShaderType } from './type-map.js';

/** `ref` as the language writes it: the name, then the options where it has any. */
export function shortBuiltinForm(ref: ts.TypeReferenceNode, sf: ts.SourceFile): string {
  const name = ref.typeArguments![0]!.getText(sf);
  const options = attributeArgumentsOf(ref).options;
  return `builtin<${name}${options === undefined ? '' : `, ${options.getText(sf)}`}>`;
}

/** A `builtin<N, T, …>` whose written `T` is the type WGSL fixes for `N`: the migration form. */
export interface WrittenBuiltinType {
  readonly ref: ts.TypeReferenceNode;
  /** The built-in value's name, `vertex_index`. */
  readonly name: string;
  /** The type argument the short form does not write. */
  readonly written: ts.TypeNode;
}

/** Whether `node` is a `builtin<…>` that names the ambient library's type. A file that declares
 *  a type of that name itself keeps it. */
function isBuiltinType(node: ts.Node, declared: ReadonlySet<string>): node is ts.TypeReferenceNode {
  return (
    ts.isTypeReferenceNode(node) &&
    ts.isIdentifier(node.typeName) &&
    node.typeName.text === 'builtin' &&
    !declared.has('builtin')
  );
}

const found = new WeakMap<ts.SourceFile, readonly WrittenBuiltinType[]>();

/** Every migration form `sf` writes, in source order: a `builtin<N, T>` or `builtin<N, T, O>`
 *  whose `N` has one type in WGSL and whose `T` is that type. */
export function writtenBuiltinTypes(sf: ts.SourceFile): readonly WrittenBuiltinType[] {
  const known = found.get(sf);
  if (known !== undefined) return known;
  const declared = declaredTypeNames(sf);
  const out: WrittenBuiltinType[] = [];
  const visit = (node: ts.Node): void => {
    if (isBuiltinType(node, declared)) {
      const name = builtinNameOf(node);
      const written = attributeArgumentsOf(node).value;
      if (name !== undefined && written !== undefined && Object.hasOwn(WGSL_BUILTIN_TYPES, name)) {
        const fixed = WGSL_BUILTIN_TYPES[name as FixedTypeBuiltinName];
        const type = mapTsTypeToShaderType(written, sf);
        if (type !== undefined && typeKey(type) === typeKey(fixed))
          out.push({ ref: node, name, written });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  found.set(sf, out);
  return out;
}

/**
 * The diagnostics of a `builtin<N, …>`'s type, once each (Rule 12.4): the `TS8028` warning on a
 * written type that WGSL fixes, on the type argument the short form drops; the `TS8003` refusal
 * of `builtin<"clip_distances">`, which has no type to take; and the refusal of an unknown name
 * that writes no type.
 */
export function checkBuiltinTypeForms(
  sf: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): void {
  for (const { ref, name, written } of writtenBuiltinTypes(sf)) {
    const start = ref.getStart(sf);
    const end = ref.getEnd();
    // A refusal the compiler already made inside this type keeps that answer alone.
    if (
      diagnostics.some(
        (d) => d.category === 'error' && d.start >= start && d.start + d.length <= end,
      )
    )
      continue;
    const fixed = WGSL_BUILTIN_TYPES[name as FixedTypeBuiltinName];
    diagnostics.push(
      makeDiagnostic(
        sf,
        written,
        `"${name}" has the type WGSL gives it, ${authorTypeText(fixed)}: write ` +
          `${shortBuiltinForm(ref, sf)}, or run "tshc migrate".`,
        TS_CODES.ATTRIBUTE_NAME,
        'warning',
      ),
    );
  }
  const declared = declaredTypeNames(sf);
  const visit = (node: ts.Node): void => {
    if (isBuiltinType(node, declared)) {
      const name = builtinNameOf(node);
      if (name !== undefined && attributeArgumentsOf(node).value === undefined) {
        if (name === 'clip_distances') {
          diagnostics.push(
            makeDiagnostic(
              sf,
              node,
              `Builtin "clip_distances" has no single type: write ` +
                `builtin<"clip_distances", array<f32, N>> with N from 1 to ` +
                `${String(MAX_CLIP_DISTANCES)}.`,
              TS_CODES.TYPE_MISMATCH,
            ),
          );
        } else if (!Object.hasOwn(WGSL_BUILTIN_TYPES, name)) {
          checkBuiltinName(
            diagnostics,
            sf,
            (node.typeArguments![0] as ts.LiteralTypeNode).literal,
            name,
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

/** Whether `type` is, or wraps, a `builtin<N>` that takes no type: `clip_distances` with no
 *  type written, or a name WGSL does not have. Its declaration has nothing to lay out, and
 *  {@link checkBuiltinTypeForms} says why. */
export function isUntypedBuiltin(type: ts.TypeNode | undefined, sf: ts.SourceFile): boolean {
  if (type === undefined || !isBuiltinType(type, declaredTypeNames(sf))) return false;
  const name = builtinNameOf(type);
  return (
    name !== undefined &&
    attributeArgumentsOf(type).value === undefined &&
    !Object.hasOwn(WGSL_BUILTIN_TYPES, name)
  );
}
