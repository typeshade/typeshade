import ts from 'typescript';
import { logicalTypeKey as typeKey } from '../../optional.js';
import type { Expr } from '../../../../core/ir/nodes.js';
import type { ShaderType } from '../../../../core/ir/types.js';
import { i32T, vec4fT } from '../../../../core/ir/types.js';
import type { TsCompilerDiagnostic } from '../../source-file.js';
import { authorTypeText, type LoweringScope } from '../../context.js';
import { TS_CODES } from '../../codes.js';
import {
  arraySuffix,
  foldConstComponent,
  vecArg,
  floatArg,
  intArg,
  arity,
  pushDiag,
} from '../expression-call.js';

export function lowerGatherCall(
  id: string,
  args: readonly Expr[],
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const at = args.findIndex((a) => a.type.kind === 'texture' || a.type.kind === 'depth-texture');
  const tex = at === 0 || at === 1 ? args[at]! : undefined;
  if (tex === undefined || (tex.type.kind !== 'texture' && tex.type.kind !== 'depth-texture')) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `${id} takes a texture as its first argument, or as its second after the component on a ` +
        `colour texture: textureGather(0, tex, smp, uv).`,
      TS_CODES.TYPE_MISMATCH,
    );
    return undefined;
  }
  const shown = authorTypeText(tex.type);
  const compare = id === 'textureGatherCompare';
  if (tex.type.dim === '1d' || tex.type.dim === '3d' || tex.type.dim === '2d-ms') {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `${id} gathers a 2d, 2d-array, cube or cube-array texture; a ${shown} has no gather form ` +
        `on WGSL.`,
      TS_CODES.UNSUPPORTED,
    );
    return undefined;
  }
  if (compare && tex.type.kind !== 'depth-texture') {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `textureGatherCompare compares against a depth texture; "${shown}" is a sampled colour ` +
        `texture with no depth to compare. textureGather reads its channels.`,
      TS_CODES.TYPE_MISMATCH,
    );
    return undefined;
  }
  const out = [...args];
  if (tex.type.kind === 'texture') {
    if (at !== 1) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `textureGather on a ${shown} takes the component first: textureGather(0, tex, smp, ` +
          `coords) reads the red channel of the four texels.`,
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    }
    const lit = foldConstComponent(args[0]!, scope);
    if (
      lit.op !== 'lit' ||
      typeof lit.value !== 'number' ||
      !Number.isInteger(lit.value) ||
      lit.value < 0 ||
      lit.value > 3
    ) {
      pushDiag(
        diagnostics,
        sourceFile,
        node.arguments[0]!,
        `textureGather's component must be a whole number from 0 to 3 known at compile time ` +
          `(0 is red, 3 is alpha): a literal, or a module const. WGSL requires a ` +
          `const-expression there and refuses any other value.`,
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    }
    out[0] =
      typeKey(lit.type) === 'i32' || typeKey(lit.type) === 'u32'
        ? lit
        : { op: 'lit', type: i32T, value: lit.value };
  } else if (at !== 0) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `${id} on a ${shown} takes no component: a depth texture has one channel. Write ` +
        `${id}(tex, smp, coords${compare ? ', ref' : ''}).`,
      TS_CODES.TYPE_MISMATCH,
    );
    return undefined;
  }
  const smp = args[at + 1];
  const wantSmp = compare ? 'sampler-comparison' : 'sampler';
  if (smp === undefined || smp.type.kind !== wantSmp) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      compare
        ? `textureGatherCompare compares through a sampler_comparison; got ` +
            `${smp === undefined ? 'nothing' : authorTypeText(smp.type)}.`
        : `textureGather reads through an ordinary sampler; got ` +
            `${smp === undefined ? 'nothing' : authorTypeText(smp.type)}. A sampler_comparison ` +
            `compares instead, with textureGatherCompare.`,
      TS_CODES.TYPE_MISMATCH,
    );
    return undefined;
  }
  const suffix = arraySuffix(tex.type.dim);
  const isArray = suffix !== '';
  const want = at + 3 + (isArray ? 1 : 0) + (compare ? 1 : 0);
  if (!arity(id, args, want, node, sourceFile, diagnostics)) return undefined;
  if (
    !vecArg(
      id,
      tex.type,
      args[at + 2]!,
      node.arguments[at + 2]!,
      'coordinate',
      sourceFile,
      diagnostics,
    )
  )
    return undefined;
  if (isArray) {
    const k = at + 3;
    const layer = intArg(id, out[k]!, node.arguments[k]!, i32T, 'layer', sourceFile, diagnostics);
    if (!layer) return undefined;
    out[k] = layer;
  }
  if (compare) {
    const k = want - 1;
    const ref = floatArg(id, out[k]!, node.arguments[k]!, 'depth_ref', sourceFile, diagnostics);
    if (!ref) return undefined;
    out[k] = ref;
  }
  const fn =
    tex.type.kind === 'texture'
      ? isArray
        ? 'textureGatherArray'
        : 'textureGather'
      : compare
        ? isArray
          ? 'textureGatherCompareArray'
          : 'textureGatherCompare'
        : isArray
          ? 'textureGatherDepthArray'
          : 'textureGatherDepth';
  const type: ShaderType =
    tex.type.kind === 'texture' ? { kind: 'vec', n: 4, elem: tex.type.elem } : vec4fT;
  return { op: 'call', type, fn, args: out };
}
