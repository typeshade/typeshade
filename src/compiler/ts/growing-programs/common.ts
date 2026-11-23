export const HEADER = `"use typeshade";\n`;

export const f32 = Math.fround;

export interface Program {
  readonly name: string;
  readonly source: string;
  readonly runs: readonly (readonly [readonly unknown[], readonly number[]])[];
}

export const u32s = (...v: number[]): Uint32Array => new Uint32Array(v);
export const f32s = (...v: number[]): Float32Array => new Float32Array(v);
