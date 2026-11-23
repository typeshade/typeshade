import ts from 'typescript';
import { logicalTypeKey as typeKey } from './optional.js';
import type { AbstractConst, Carried } from './abstract-const.js';
import { isOpenCounter, type InferredValue } from './use-inference.js';

const origins = new WeakMap<object, { key: string; carried: Carried }>();
export function inferredOrigin(value: InferredValue | undefined): Carried | undefined {
  if (value === undefined) return undefined;
  const openCounter =
    value.type === undefined && isOpenCounter(value.decl.getSourceFile(), value.decl);
  const own = value.integerResult ?? value.type;
  if (own === undefined && !openCounter) return undefined;
  const key = own === undefined ? 'i32' : typeKey(own);
  if (key !== 'i32' && key !== 'u32') return undefined;
  const cacheKey = openCounter ? 'counter' : key;
  const cached = origins.get(value.key ?? value.decl);
  if (cached !== undefined && cached.key === cacheKey) return cached.carried;
  const decl = value.decl as ts.VariableDeclaration | ts.PropertyDeclaration;
  const keyword: AbstractConst['keyword'] =
    value.function !== undefined
      ? 'function'
      : ts.isPropertyDeclaration(decl)
        ? decl.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword) === true
          ? 'static'
          : ''
        : 'let';
  const nameNode = value.function ?? decl.name;
  const info: AbstractConst = {
    name:
      value.function !== undefined
        ? value.decl.getText(value.decl.getSourceFile()).replace(/\s+/g, ' ')
        : value.name,
    value: Number.NaN,
    integerWritten: true,
    keyword,
    nameNode,
    written: value.written ?? '',
    sources: [],
    integerReads: [{ type: key, node: nameNode as ts.Expression }],
    ...(openCounter ? { openCounter: true as const } : {}),
  };
  const carried: Carried = {
    reaches: [info],
    float: false,
    ...(keyword === 'function' || value.list !== undefined
      ? {}
      : {
          variable: {
            keyword,
            name: value.name,
            init: value.written ?? '',
            type: openCounter ? 'f32' : key,
          },
        }),
  };
  origins.set(value.key ?? value.decl, { key: cacheKey, carried });
  return carried;
}

export function carriedOf(
  carries: Carried | undefined,
  value: InferredValue | undefined,
): Carried | undefined {
  if (carries !== undefined && carries.reaches.length > 0) return carries;
  return inferredOrigin(value) ?? carries;
}
