import type { ShaderType } from '../ir/index.js';
import { UnsupportedFeatureError } from '../backend.js';

export function glslArraySize(size: number | undefined): number {
  if (size === undefined)
    throw new UnsupportedFeatureError(
      'glsl-es300: runtime-sized array (storage buffer) — needs a data-texture (later step)',
    );
  return size;
}

export function makeGlslDecl(type: (t: ShaderType) => string) {
  const decl = (t: ShaderType, name: string): string =>
    t.kind === 'array'
      ? decl(t.elem, name + '[' + glslArraySize(t.size) + ']')
      : type(t) + ' ' + name;
  return decl;
}
