import type { BinOp } from '../../../../core/ir/nodes.js';
import type { ShaderType } from '../../../../core/ir/types.js';
import { isF64, isVec64 } from '../../../../core/ir/types.js';
import { authorTypeText } from '../../context.js';
import { logicalTypeKey as typeKey } from '../../optional.js';

export function isFloatBitOperand(t: ShaderType): boolean {
  if (t.kind === 'vec') return t.elem === 'f32';
  return typeKey(t) === 'f32' || isF64(t) || isVec64(t);
}

export function bitwiseFloatMessage(bit: BinOp, t: ShaderType): string {
  const fix =
    t.kind === 'vec'
      ? `Convert first, e.g. vec${String(t.n)}u(a) ${bit} vec${String(t.n)}u(b).`
      : t.kind === 'vec64'
        ? `Narrow and convert first, e.g. vec${String(t.n)}u(vec${String(t.n)}(a)) ${bit} ` +
          `vec${String(t.n)}u(vec${String(t.n)}(b)).`
        : isF64(t)
          ? `Narrow and convert first, e.g. u32(f32(a)) ${bit} u32(f32(b)).`
          : `Convert first, e.g. u32(a) ${bit} u32(b), or reinterpret the bits with bitcast<u32>(a).`;
  return `Bitwise "${bit}" needs i32 or u32 operands, got ${authorTypeText(t)}. ${fix}`;
}
