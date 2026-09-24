// === A builtin call's result type, read off Tint's overload table (0017) ===
//
// The compiler used to type a math builtin's result by hand (`mathResultType`), a condition
// added per bug (#57's integer `dot`, #151's emulated-double reductions). For a SUPPORTED row
// the table says it instead: the call's argument types are matched against each row of the
// name, binding the row's type parameters, and the first row that takes them gives the result.
// The editor's declarations are generated from the same rows (`builtin-signatures.ts`), which is
// what makes the two halves one vocabulary rather than two copies of it (Rule 12.7).
//
// Only concrete scalars and vectors are matched here, the forms `row-types.ts` reads; an
// emulated double, a matrix or a struct has no row form yet, and its caller keeps its own rule.
import type { ShaderType } from '../ir/types.js';
import { COREDEF } from './coredef.js';
import type { CoreDefRow } from './coredef-types.js';
import { claimOf } from './overlay.js';
import { rowTypes, scalarDomain, type RowType, type TypeshadeScalar } from './row-types.js';

/** Every SUPPORTED builtin function row, by name. */
const SUPPORTED_ROWS: ReadonlyMap<string, readonly CoreDefRow[]> = (() => {
  const out = new Map<string, CoreDefRow[]>();
  for (const row of COREDEF.rows) {
    if (row.kind !== 'fn' || claimOf(row, COREDEF.matchers)?.status !== 'SUPPORTED') continue;
    out.set(row.name, [...(out.get(row.name) ?? []), row]);
  }
  return out;
})();

/** The SUPPORTED rows of the builtin `name`, empty for a name the table does not type. */
export function supportedRows(name: string): readonly CoreDefRow[] {
  return SUPPORTED_ROWS.get(name) ?? [];
}

type Shape = { readonly s: TypeshadeScalar; readonly n: 1 | 2 | 3 | 4 };

function shapeOf(t: ShaderType): Shape | undefined {
  if (t.kind === 'scalar') return { s: t.scalar, n: 1 };
  if (t.kind === 'vec') return { s: t.elem, n: t.n };
  return undefined;
}

/** Bind `param` to `arg`, extending `bind`; false when the row does not take the argument. */
function bindParam(
  row: CoreDefRow,
  param: RowType,
  arg: Shape,
  bind: Record<string, string>,
): boolean {
  const bindOne = (name: string, value: string, admits: (v: string) => boolean): boolean => {
    if (!(name in row.implicit)) return name === value;
    const seen = bind[name];
    if (seen !== undefined) return seen === value;
    if (!admits(value)) return false;
    bind[name] = value;
    return true;
  };
  const admitsScalar = (name: string) => (v: string) =>
    (scalarDomain(row.implicit[name] ?? '', COREDEF.matchers) as string[]).includes(v);
  if (param.k === 'scalar') {
    return arg.n === 1 && bindOne(param.s, arg.s, admitsScalar(param.s));
  }
  return (
    arg.n !== 1 &&
    bindOne(param.n, String(arg.n), (v) => row.implicit[param.n] === 'num' && /^[234]$/.test(v)) &&
    bindOne(param.s, arg.s, admitsScalar(param.s))
  );
}

function instantiate(t: RowType, bind: Readonly<Record<string, string>>): ShaderType {
  const s = (bind[t.s] ?? t.s) as TypeshadeScalar;
  if (t.k === 'scalar') return { kind: 'scalar', scalar: s };
  return { kind: 'vec', n: Number(bind[t.n] ?? t.n) as 2 | 3 | 4, elem: s };
}

/**
 * The result type of the builtin `name` called with `args`, by the first SUPPORTED row that
 * takes them; undefined when no row does, or the name has none, and the caller's own rule
 * applies (an emulated double, a matrix).
 */
export function builtinResultType(
  name: string,
  args: readonly ShaderType[],
): ShaderType | undefined {
  const shapes = args.map(shapeOf);
  if (shapes.some((s) => s === undefined)) return undefined;
  for (const row of supportedRows(name)) {
    const types = rowTypes(row);
    if (types === undefined || types.params.length !== args.length) continue;
    const bind: Record<string, string> = {};
    if (types.params.every((p, i) => bindParam(row, p, shapes[i]!, bind))) {
      return instantiate(types.ret, bind);
    }
  }
  return undefined;
}
