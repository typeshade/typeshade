import type { FuncDecl, Stmt, StructDecl } from '../../../core/ir/nodes.js';
import type { ShaderType } from '../../../core/ir/types.js';
import { eachExpr, eachStmtExpr } from '../../../core/ir/visit.js';

const isVec4F32 = (t: ShaderType): boolean => t.kind === 'vec' && t.n === 4 && t.elem === 'f32';

export function colourOf(
  f: FuncDecl,
  structs: ReadonlyMap<string, StructDecl>,
): string | null | undefined {
  if (isVec4F32(f.ret)) return f.retAttr === '@location(0)' ? null : undefined;
  if (f.ret.kind !== 'struct') return undefined;
  const fields = structs.get(f.ret.name)?.fields ?? [];
  if (fields.length !== 1) return undefined;
  const [only] = fields;
  return only!.location === 0 && only!.builtin === undefined && isVec4F32(only!.type)
    ? only!.name
    : undefined;
}

export function addsTo(f: FuncDecl, name: string): boolean {
  let found = false;
  const visit = (s: Stmt): void =>
    eachStmtExpr(
      s,
      (e) =>
        eachExpr(e, (x) => {
          if (
            x.op === 'call' &&
            (x.fn === 'collectionAdd' || x.fn === 'collectionSet') &&
            x.args[0]?.op === 'param' &&
            x.args[0].name === name
          )
            found = true;
        }),
      visit,
    );
  f.body.forEach(visit);
  return found;
}
