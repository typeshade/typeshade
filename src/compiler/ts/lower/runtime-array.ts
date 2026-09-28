// Implements: Rule 12.6 for an array with no size (docs/language-design.md; traced in reqs/).
// === An array with no size is a storage binding, not a value ===
//
// `array<T>` has its length only when the host binds it, so WGSL lets it live in the storage
// address space alone: a parameter, a result or a local that holds one is refused by Tint with
// `runtime-sized arrays can only be used in the <storage> address space`, and a result with
// `function return type must be a constructible type`. The same holds for a struct whose last
// field is such an array. The front end refuses each in the author's words (Rule 12.6), where
// before the WGSL reached Tint with no diagnostic.
//
// A loop over one (`for (const x of xs)`), an element read and a write through the binding's
// own name are all storage accesses, and stay.

import type ts from 'typescript';
import type { StructDecl } from '../../../core/ir/nodes.js';
import type { ShaderType } from '../../../core/ir/types.js';
import { typeKey } from '../../../core/ir/types.js';
import type { TsCompilerDiagnostic } from '../source-file.js';
import { TS_CODES, type TsCode } from '../codes.js';
import { makeDiagnostic } from '../diagnostic.js';

/** Where `t` holds an array with no size: `t` itself, or the struct field that does (a struct's
 *  last field, through nested structs); `undefined` when it holds none. */
export function runtimeArrayWithin(
  t: ShaderType,
  structByName: (name: string) => StructDecl | undefined,
): { readonly array: ShaderType; readonly field?: string } | undefined {
  if (t.kind === 'array') return t.size === undefined ? { array: t } : undefined;
  if (t.kind !== 'struct') return undefined;
  const last = structByName(t.name)?.fields.at(-1);
  if (last === undefined) return undefined;
  const inner = runtimeArrayWithin(last.type, structByName);
  if (inner === undefined) return undefined;
  return { array: inner.array, field: inner.field ?? last.name };
}

/** How `t` holds its array with no size, for a message: `array<f32>, an array with no size,` or
 *  `S, whose field "xs" is array<f32>, an array with no size,`. */
function described(t: ShaderType, within: { array: ShaderType; field?: string }): string {
  const own = t.kind === 'struct' ? t.name : typeKey(t);
  return within.field === undefined
    ? `${typeKey(within.array)}, ${WHY}`
    : `${own}, whose field "${within.field}" is ${typeKey(within.array)}, ${WHY}`;
}

const WHY =
  'an array with no size, which lives only in a storage binding because its length is known only when the host binds it';

/**
 * Refuse a parameter or a result whose type holds an array with no size, pushing `TS8020` on
 * `node`: a parameter, by its name, or the result. Returns `true` when it refused.
 */
export function refuseRuntimeArraySignature(
  t: ShaderType | undefined,
  what: { readonly kind: 'parameter'; readonly name: string } | { readonly kind: 'result' },
  node: ts.Node,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  structByName: (name: string) => StructDecl | undefined,
): boolean {
  if (t === undefined) return false;
  const within = runtimeArrayWithin(t, structByName);
  if (within === undefined) return false;
  const message =
    what.kind === 'parameter'
      ? `Parameter "${what.name}" is ${described(t, within)}. Give it a size, array<${typeKey(elemOf(within.array))}, N>, or read the binding by its name inside the function instead.`
      : `This function returns ${described(t, within)}. Read the binding by its name where the value is needed.`;
  push(diagnostics, sourceFile, node, message, TS_CODES.FUNCTION_SHAPE);
  return true;
}

/**
 * Refuse a local whose type holds an array with no size, pushing `TS8099` on `node`. `from` is
 * the initializer's text when it names a value to copy; `count` is the element count of a list
 * built in place, which the remedy's size takes. Returns `true` when it refused.
 */
export function refuseRuntimeArrayLocal(
  t: ShaderType | undefined,
  name: string,
  from: string | undefined,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  structByName: (name: string) => StructDecl | undefined,
  count?: number,
): boolean {
  if (t === undefined) return false;
  const within = runtimeArrayWithin(t, structByName);
  if (within === undefined) return false;
  const message =
    from === undefined
      ? `"${name}" would be ${described(t, within)}. Give the array a size: array<${typeKey(elemOf(within.array))}, ${count ?? 'N'}>.`
      : `"${name}" would copy "${from}", which is ${described(t, within)}. Read "${from}" by its name instead.`;
  push(diagnostics, sourceFile, node, message, TS_CODES.UNSUPPORTED);
  return true;
}

const elemOf = (t: ShaderType): ShaderType => (t.kind === 'array' ? t.elem : t);

function push(
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
  node: ts.Node,
  message: string,
  code: TsCode,
): void {
  diagnostics.push(makeDiagnostic(sourceFile, node, message, code));
}
