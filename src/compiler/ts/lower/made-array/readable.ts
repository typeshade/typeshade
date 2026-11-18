// Implements: Rule 8.23 (docs/language-design.md; traced in reqs/).
import type { Expr, FuncDecl } from '../../../../core/ir/nodes.js';

const ARITHMETIC: ReadonlySet<string> = new Set(['+', '-', '*', '/', '%']);
const CASTS: ReadonlySet<string> = new Set(['u32', 'i32', 'f32']);

export interface Readable {
  readonly values: ReadonlySet<string>;
  readonly arrays: ReadonlySet<string>;
  readonly lets: ReadonlyMap<string, Expr>;
  readonly needed: Set<string>;
}

export function hostReadable(e: Expr, r: Readable): boolean {
  switch (e.op) {
    case 'lit':
    case 'constref':
      return true;
    case 'param':
      return r.values.has(e.name);
    case 'member':
      return hostReadable(e.base, r);
    case 'varref': {
      const init = r.lets.get(e.name);
      if (init === undefined) return false;
      r.needed.add(e.name);
      return hostReadable(init, r);
    }
    case 'unop':
      return hostReadable(e.a, r);
    case 'binop':
      return ARITHMETIC.has(e.bop) && hostReadable(e.a, r) && hostReadable(e.b, r);
    case 'construct':
      return e.type.kind === 'scalar' && e.args.length === 1 && hostReadable(e.args[0]!, r);
    case 'call': {
      if (e.fn === 'arrayLength')
        return e.args.length === 1 && e.args[0]!.op === 'param' && r.arrays.has(e.args[0]!.name);
      if (CASTS.has(e.fn)) return e.args.length === 1 && hostReadable(e.args[0]!, r);
      if (e.fn === 'min' || e.fn === 'max') return e.args.every((a) => hostReadable(a, r));
      return false;
    }
    default:
      return false;
  }
}

export function readersOf(stub: FuncDecl, param: string): Readable {
  const values = new Set<string>();
  const arrays = new Set<string>();
  for (const p of stub.params) {
    if (p.name === param) continue;
    if (p.type.kind === 'array' && p.type.size === undefined) arrays.add(p.name);
    else if (p.type.kind !== 'texture' && p.type.kind !== 'collection') values.add(p.name);
  }
  const lets = new Map<string, Expr>();
  for (const st of stub.body) if (st.s === 'let') lets.set(st.name, st.expr);
  return { values, arrays, lets, needed: new Set() };
}

export const notKnown = (what: string): string =>
  `${what} reads a value the call does not know before it runs. It reads the value parameters, ` +
  `their components and fields, module constants, the length of an array parameter, number ` +
  `literals, u32, i32 and f32 of these, and top-level consts of these, with +, -, *, /, %, min ` +
  `and max; any other operand is not supported yet.`;
