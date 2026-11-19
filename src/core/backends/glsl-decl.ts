import { UnsupportedFeatureError } from '../backend.js';

export function glslArraySize(size: number | undefined): number {
  if (size === undefined)
    throw new UnsupportedFeatureError('glsl-es300: runtime-sized array');
  return size;
}
