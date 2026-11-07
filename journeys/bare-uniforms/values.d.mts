export interface UniformSpec {
  readonly name: string;
  readonly type: string;
  readonly kind: 'float' | 'int' | 'uint' | 'matrix' | 'double';
  readonly lanes: number;
  readonly dead?: boolean;
  readonly wrapped?: boolean;
}
export const uniforms: readonly UniformSpec[];
export function valueOf(
  spec: UniformSpec,
  changed?: boolean,
): number | number[] | { value: number };
export function expectedOf(spec: UniformSpec, changed?: boolean): number[];
