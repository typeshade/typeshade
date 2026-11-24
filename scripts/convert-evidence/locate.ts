import type { Decl } from './source-index.js';

export type Located =
  | { readonly kind: 'one'; readonly decl: Decl }
  | { readonly kind: 'many'; readonly decls: readonly Decl[] }
  | { readonly kind: 'none' };

const overlaps = (decl: Decl, from: number, to: number): boolean =>
  decl.from <= to && decl.to >= from;
const contains = (decl: Decl, from: number, to: number): boolean =>
  decl.from <= from && decl.to >= to;

export function locate(decls: readonly Decl[], from: number, to: number): Located {
  const top = decls.find((decl) => contains(decl, from, to));
  if (top) {
    return { kind: 'one', decl: top.members.find((one) => contains(one, from, to)) ?? top };
  }
  const hit = decls.filter((decl) => overlaps(decl, from, to));
  if (hit.length === 0) return { kind: 'none' };
  const pieces = hit.flatMap((decl) => {
    if (from <= decl.from && to >= decl.to) return [decl];
    const inside = decl.members.filter((one) => overlaps(one, from, to));
    return inside.length > 0 ? inside : [decl];
  });
  return pieces.length === 1 ? { kind: 'one', decl: pieces[0]! } : { kind: 'many', decls: pieces };
}
