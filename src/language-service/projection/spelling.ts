import type ts from 'typescript';
import type { ShaderType } from '../../core/ir/types.js';
import { authorTypeText } from '../../compiler/ts/context.js';
import { isArrayConstructorExpression } from '../../compiler/ts/lower/array-constructor/form.js';

export function ambientSpelling(type: ShaderType): string | undefined {
  if (type.kind === 'vec') {
    const suffix = { f32: '', i32: 'i', u32: 'u', bool: 'b' }[type.elem as string];
    return suffix === undefined ? undefined : `vec${type.n}${suffix}`;
  }
  if (type.kind === 'vec64') return `vec${type.n}f64`;
  if (type.kind === 'mat') {
    const name = `mat${type.cols}x${type.rows}`;
    return type.elem === 'f64' ? `${name}<f64>` : name;
  }
  return undefined;
}

export function sizedArraySpelling(
  type: ShaderType | undefined,
  field: ts.Node | undefined,
): string | undefined {
  if (type?.kind !== 'array' || type.size === undefined) return undefined;
  const initializer = (field as { readonly initializer?: ts.Expression } | undefined)?.initializer;
  if (
    field !== undefined &&
    (initializer === undefined || !isArrayConstructorExpression(initializer))
  )
    return undefined;
  return `array<${ambientSpelling(type.elem) ?? authorTypeText(type.elem)}, ${String(type.size)}>`;
}
