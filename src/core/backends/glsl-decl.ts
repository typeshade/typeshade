import { UnsupportedFeatureError } from '../backend.js';
import type { ShaderType } from '../ir/index.js';

export function glslArraySize(size: number | undefined): number {
  if (size === undefined)
    throw new UnsupportedFeatureError('glsl-es300: runtime-sized array');
  return size;
}

export function makeGlslDecl(
  glslType: (type: ShaderType) => string,
): (type: ShaderType, name: string) => string {
  return (type, name) => {
    const dimensions: number[] = [];
    let element = type;

    while (element.kind === 'array') {
      dimensions.push(glslArraySize(element.size));
      element = element.elem;
    }

    return `${glslType(element)} ${name}${dimensions.map((size) => `[${size}]`).join('')}`;
  };
}
