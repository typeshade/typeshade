// Implements: Rule 8.23 (docs/language-design.md; traced in reqs/).
import type { FuncDecl } from '../../../core/ir/nodes.js';
import type { KernelFace } from '../../../core/host-kernel.js';
import { madeOf, type KernelMade } from '../../../core/kernel-made-face.js';
import type { HostExport } from '../host-face-contracts.js';
import { madeArrayOf } from '../lower/made-array/registry.js';

export function madeFace(e: HostExport, f: FuncDecl): HostExport {
  const made = madeArrayOf(f);
  if (made === undefined || e.kind !== 'kernel') return e;
  const cpuFn = (suffix: string, expr: NonNullable<typeof made.fill>): FuncDecl => ({
    name: `${f.name}__${suffix}`,
    params: f.params,
    ret: expr.type,
    body: [...made.prelude, { s: 'return', expr }],
    kernel: true,
  });
  const length = cpuFn('length', made.length);
  const fill = made.fill === undefined ? undefined : cpuFn('fill', made.fill);
  const record: KernelMade = {
    param: made.param,
    shown: made.shown,
    array: made.element,
    length: length.name,
    ...(fill !== undefined ? { fill: fill.name } : {}),
  };
  const face: Record<string, unknown> = { ...e.face };
  delete face.gl;
  delete face.fuse;
  return {
    ...e,
    face: {
      ...(face as unknown as typeof e.face),
      noWebgl2: `it makes the array it returns, "${made.shown}", which the WebGL2 tier does not support yet`,
      made: record,
    } as typeof e.face,
    ranges: [...e.ranges, length, ...(fill !== undefined ? [fill] : [])],
  };
}

export const TYPED_NAME = {
  f32: 'Float32Array',
  i32: 'Int32Array',
  u32: 'Uint32Array',
  f64: 'Float64Array',
} as const;

export interface MadeView {
  readonly face: KernelFace;
  readonly result?: string;
  readonly note: string;
}

export function madeView(face: KernelFace): MadeView {
  const made = madeOf(face);
  if (made === undefined) return { face, note: '' };
  return {
    face: { ...face, params: face.params.filter((p) => p.name !== made.param) },
    result: TYPED_NAME[made.array],
    note: ` It makes the array it returns, "${made.shown}", a new ${TYPED_NAME[made.array]} whose length its arguments give, and the caller owns it; a call on a resource, or inside fuse(), is not supported yet (Rules 8.21 and 8.23).`,
  };
}
