import type { LibmInputSet } from '../libm-gate.js';

export interface LibmCaseSet extends LibmInputSet {
  readonly second?: Float32Array | Float64Array | Int32Array;
}

export interface LibmCase {
  readonly routine: string;
  readonly format: 'f32' | 'f64';
  readonly f: (x: number, y: number) => number;
  readonly sets: (count?: number) => LibmCaseSet[];
}
