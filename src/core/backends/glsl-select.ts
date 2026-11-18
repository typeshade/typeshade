import type { Expr, ModuleDecl, ShaderType } from '../ir/index.js';
import { mapModuleExprs } from '../passes/opt/ir-transform.js';

const isFloat = (type: ShaderType): boolean =>
  type.kind === 'vec' ? type.elem === 'f32' : type.kind === 'scalar' && type.scalar === 'f32';

export const glslSelect =
  (typeName: (t: ShaderType) => string) =>
  (ifFalse: string, ifTrue: string, cond: string, type: ShaderType): string => {
    if (type.kind === 'vec' && type.elem === 'f32') return `mix(${ifFalse}, ${ifTrue}, ${cond})`;
    const n = type.kind === 'vec' ? type.n : 1;
    const comps = ['x', 'y', 'z', 'w']
      .slice(0, n)
      .map((k) => `((${cond}).${k} ? (${ifTrue}).${k} : (${ifFalse}).${k})`);
    return `${typeName(type)}(${comps.join(', ')})`;
  };

function mixOf(e: Extract<Expr, { op: 'select' }>): Expr {
  const cond: Expr =
    e.type.kind === 'vec'
      ? { op: 'construct', type: { kind: 'vec', n: e.type.n, elem: 'bool' }, args: [e.cond] }
      : e.cond;
  return { op: 'call', type: e.type, fn: 'mix', args: [e.ifFalse, e.ifTrue, cond] };
}

export function selectAsMix(m: ModuleDecl): ModuleDecl {
  return mapModuleExprs(m, (e) =>
    e.op === 'select' && e.cond.type.kind !== 'vec' && isFloat(e.type) ? mixOf(e) : e,
  );
}
