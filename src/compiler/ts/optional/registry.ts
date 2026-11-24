import type { StructDecl } from '../../../core/ir/nodes.js';
import type { ShaderType } from '../../../core/ir/types.js';
import { boolT, typeKey } from '../../../core/ir/types.js';

const PREFIX = '__opt_';

export type Absence = 1 | 2 | 3;
const LOGICAL_OPTIONAL = Symbol('logical optional');
type OptionalType = ShaderType & {
  readonly [LOGICAL_OPTIONAL]?: { readonly inner: ShaderType; readonly absence: Absence };
};

export function optionalAbsence(t: ShaderType | undefined): Absence | undefined {
  if (t === undefined) return undefined;
  return (
    (t as OptionalType)[LOGICAL_OPTIONAL]?.absence ??
    (t.kind === 'struct' && OPTIONALS.has(t.name)
      ? t.name.startsWith('__opt3_')
        ? 3
        : 1
      : undefined)
  );
}

export function logicalTypeKey(t: ShaderType): string {
  const logical = (t as OptionalType)[LOGICAL_OPTIONAL];
  if (logical !== undefined) {
    const base = typeKey(t);
    return logical.absence === 1 && logicalTypeKey(logical.inner) === typeKey(logical.inner)
      ? base
      : `${base}:${logical.absence}:${logicalTypeKey(logical.inner)}`;
  }
  if (t.kind === 'array')
    return t.size === undefined
      ? `array<${logicalTypeKey(t.elem)}>`
      : `array<${logicalTypeKey(t.elem)},${t.sizeOverride ?? t.size}>`;
  return typeKey(t);
}

const OPTIONALS = new Map<string, { readonly inner: ShaderType; readonly decl: StructDecl }>();

export function optionalStructName(inner: ShaderType): string {
  const key = inner.kind === 'struct' ? inner.name : typeKey(inner);
  return `${PREFIX}${key.replace(/[^A-Za-z0-9_]+/g, '_').replace(/_+$/, '')}`;
}

function physicalPayload(type: ShaderType): ShaderType {
  if (type.kind === 'array') return { ...type, elem: physicalPayload(type.elem) };
  if (type.kind === 'struct' && isOptional(type)) return { kind: 'struct', name: type.name };
  return type;
}

export function optionalT(inner: ShaderType, absence: Absence = 1): ShaderType {
  const name = optionalStructName(inner).replace(PREFIX, absence === 3 ? '__opt3_' : PREFIX);
  if (!OPTIONALS.has(name)) {
    OPTIONALS.set(name, {
      inner: physicalPayload(inner),
      decl: {
        name,
        fields: [
          { name: 'value', type: physicalPayload(inner) },
          { name: 'present', type: boolT },
          ...(absence === 3 ? [{ name: 'isNull', type: boolT }] : []),
        ],
      },
    });
  }
  if (absence === 1 && logicalTypeKey(inner) === typeKey(inner)) return { kind: 'struct', name };
  return { kind: 'struct', name, [LOGICAL_OPTIONAL]: { inner, absence } } as OptionalType;
}

export function optionalInner(t: ShaderType | undefined): ShaderType | undefined {
  if (t === undefined || t.kind !== 'struct') return undefined;
  return (t as OptionalType)[LOGICAL_OPTIONAL]?.inner ?? OPTIONALS.get(t.name)?.inner;
}

export const isOptional = (t: ShaderType | undefined): boolean => optionalInner(t) !== undefined;

export function optionalDeclOf(name: string): StructDecl | undefined {
  return OPTIONALS.get(name)?.decl;
}

export function mayBeOptional(inner: ShaderType): boolean {
  switch (inner.kind) {
    case 'scalar':
    case 'f64':
    case 'vec64':
    case 'vec':
    case 'mat':
      return true;
    case 'array':
      return inner.size !== undefined && (isOptional(inner.elem) || mayBeOptional(inner.elem));
    case 'struct':
      return !isOptional(inner);
    default:
      return false;
  }
}

export function collectOptionalNames(t: ShaderType, out: Set<string>): void {
  if (t.kind === 'struct' && OPTIONALS.has(t.name)) {
    collectOptionalNames(optionalInner(t)!, out);
    out.add(t.name);
  } else if (t.kind === 'array') collectOptionalNames(t.elem, out);
}
