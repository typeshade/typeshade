import type { ShaderType } from '../ir/index.js';

const isFloat = (type: ShaderType): boolean =>
  type.kind === 'vec' ? type.elem === 'f32' : type.kind === 'scalar' && type.scalar === 'f32';

export const glslSelect =
  (typeName: (t: ShaderType) => string) =>
  (
    ifFalse: string,
    ifTrue: string,
    cond: string,
    type: ShaderType,
    perComponent: boolean,
  ): string => {
    if (isFloat(type)) {
      const mask = perComponent || type.kind !== 'vec' ? cond : `bvec${String(type.n)}(${cond})`;
      return `mix(${ifFalse}, ${ifTrue}, ${mask})`;
    }
    if (!perComponent) return `(${cond} ? ${ifTrue} : ${ifFalse})`;
    const n = type.kind === 'vec' ? type.n : 1;
    const comps = ['x', 'y', 'z', 'w']
      .slice(0, n)
      .map((k) => `((${cond}).${k} ? (${ifTrue}).${k} : (${ifFalse}).${k})`);
    return `${typeName(type)}(${comps.join(', ')})`;
  };
