import ts from 'typescript';
import { logicalTypeKey as typeKey } from '../../optional.js';
import type { Expr } from '../../../../core/ir/nodes.js';
import type { ShaderType } from '../../../../core/ir/types.js';
import { f32T, i32T, storageTexel, u32T, vec2uT, voidT } from '../../../../core/ir/types.js';
import type { TsCompilerDiagnostic } from '../../source-file.js';
import { authorTypeText } from '../../context.js';
import { TS_CODES } from '../../codes.js';
import {
  lowerMultisampledCall,
  vecArg,
  floatArg,
  intArg,
  dimsArgs,
  arity,
  pushDiag,
} from '../expression-call.js';
import { arraySuffix } from './array-suffix.js';

export function lowerStorageTextureCall(
  id: string,
  tex: Extract<ShaderType, { kind: 'storage-texture' }>,
  args: readonly Expr[],
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const isArray = tex.dim === '2d-array';
  const texel: ShaderType = { kind: 'vec', n: 4, elem: storageTexel(tex.format) };
  const shown = authorTypeText(tex);
  if (id === 'textureDimensions') {
    if (args.length > 1) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `textureDimensions on a ${shown} takes the texture alone: a storage texture has one ` +
          `mip level, so there is no level to ask for.`,
        TS_CODES.ARITY_MISMATCH,
      );
      return undefined;
    }
    return arity(id, args, 1, node, sourceFile, diagnostics)
      ? { op: 'call', type: vec2uT, fn: id, args: [...args] }
      : undefined;
  }
  if (id === 'textureNumLayers') {
    if (!isArray) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `textureNumLayers needs a texture_storage_2d_array; "${shown}" has no layers.`,
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    }
    return arity(id, args, 1, node, sourceFile, diagnostics)
      ? { op: 'call', type: u32T, fn: 'textureNumLayersStorage', args: [...args] }
      : undefined;
  }
  if (id === 'textureLoad') {
    if (tex.access === 'write') {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `"${shown}" is write-only, so textureLoad cannot read it. Declare it "read" to read ` +
          `it, or "read_write" to do both — which only "r32uint", "r32sint" and "r32float" ` +
          `allow, so a format outside those takes a second binding over the same texture.`,
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    }
    if (!arity(id, args, isArray ? 3 : 2, node, sourceFile, diagnostics)) return undefined;
    if (!vecArg(id, tex, args[1]!, node.arguments[1]!, 'coordinate', sourceFile, diagnostics))
      return undefined;
    const out = [...args];
    if (isArray) {
      const layer = intArg(id, out[2]!, node.arguments[2]!, i32T, 'layer', sourceFile, diagnostics);
      if (!layer) return undefined;
      out[2] = layer;
    }
    return { op: 'call', type: texel, fn: id, args: out };
  }
  if (id === 'textureStore') {
    if (tex.access === 'read') {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `"${shown}" is read-only, so textureStore cannot write it. Declare it "write" to ` +
          `write it, or "read_write" to do both — which only "r32uint", "r32sint" and ` +
          `"r32float" allow.`,
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    }
    if (!arity(id, args, isArray ? 4 : 3, node, sourceFile, diagnostics)) return undefined;
    if (!vecArg(id, tex, args[1]!, node.arguments[1]!, 'coordinate', sourceFile, diagnostics))
      return undefined;
    const out = [...args];
    if (isArray) {
      const layer = intArg(id, out[2]!, node.arguments[2]!, i32T, 'layer', sourceFile, diagnostics);
      if (!layer) return undefined;
      out[2] = layer;
    }
    const value = out[isArray ? 3 : 2]!;
    if (typeKey(value.type) !== typeKey(texel)) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `"${shown}" stores a ${authorTypeText(texel)}; got ${authorTypeText(value.type)}. The texel type is ` +
          `the format's own: a "…uint" format stores a vec4u, a "…sint" one a vec4i, and ` +
          `every other one — unorm, snorm and float — a vec4.`,
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    }
    return { op: 'call', type: voidT, fn: id, args: out };
  }
  pushDiag(
    diagnostics,
    sourceFile,
    node,
    `${id} takes a sampled texture; "${shown}" is a storage texture, which is read and ` +
      `written by texel coordinate with textureLoad and textureStore and has no sampler.`,
    TS_CODES.TYPE_MISMATCH,
  );
  return undefined;
}

export function lowerDepthTextureCall(
  id: string,
  tex: Extract<ShaderType, { kind: 'depth-texture' }>,
  args: readonly Expr[],
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  if (tex.dim === '2d-ms')
    return lowerMultisampledCall(id, tex, args, node, sourceFile, diagnostics);
  const suffix = arraySuffix(tex.dim);
  const isArray = suffix !== '';
  const shown = authorTypeText(tex);
  if (id === 'textureDimensions') {
    const out = dimsArgs(id, args, node, sourceFile, diagnostics);
    return out ? { op: 'call', type: vec2uT, fn: id, args: out } : undefined;
  }
  if (id === 'textureNumLayers') {
    if (!isArray) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        tex.dim === 'cube'
          ? `textureNumLayers needs a texture_depth_2d_array or a texture_depth_cube_array; a ` +
              `texture_depth_cube has six faces, not layers.`
          : `textureNumLayers needs a texture_depth_2d_array; a plain depth texture has no layers.`,
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    }
    return arity(id, args, 1, node, sourceFile, diagnostics)
      ? { op: 'call', type: u32T, fn: id, args: [...args] }
      : undefined;
  }
  if (id === 'textureSampleCompare' || id === 'textureSampleCompareLevel') {
    const smp = args[1];
    if (smp === undefined || smp.type.kind !== 'sampler-comparison') {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `${id} compares through a sampler_comparison; got ` +
          `${smp === undefined ? 'nothing' : authorTypeText(smp.type)}. An ordinary sampler ` +
          `filters a texel and has no reference to compare against. Declare the sampler ` +
          `"declare const smp: sampler_comparison".`,
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    }
    if (!arity(id, args, isArray ? 5 : 4, node, sourceFile, diagnostics)) return undefined;
    if (!vecArg(id, tex, args[2]!, node.arguments[2]!, 'coordinate', sourceFile, diagnostics))
      return undefined;
    const out = [...args];
    if (isArray) {
      const layer = intArg(id, out[3]!, node.arguments[3]!, i32T, 'layer', sourceFile, diagnostics);
      if (!layer) return undefined;
      out[3] = layer;
    }
    const refIndex = isArray ? 4 : 3;
    const ref = floatArg(
      id,
      out[refIndex]!,
      node.arguments[refIndex]!,
      'depth_ref',
      sourceFile,
      diagnostics,
    );
    if (!ref) return undefined;
    out[refIndex] = ref;
    const fn = isArray ? `${id}${suffix}` : tex.dim === 'cube' ? `${id}Cube` : id;
    return { op: 'call', type: f32T, fn, args: out };
  }
  if (id === 'textureSample' || id === 'textureSampleLevel' || id === 'textureLoad') {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `"${shown}" is read by comparison: textureSampleCompare(tex, smp, uv, ref) with a ` +
        `sampler_comparison yields how much of the footprint passed. A plain read of a depth ` +
        `texture — ${id} — is not here yet: on GLSL ES 3.00 the texture and its sampler are one ` +
        `object whose type the read decides, so a depth texture read both ways needs separate ` +
        `samplers, which a later item adds.`,
      TS_CODES.UNSUPPORTED,
    );
    return undefined;
  }
  pushDiag(
    diagnostics,
    sourceFile,
    node,
    `${id} does not take a depth texture; "${shown}" is read with textureSampleCompare.`,
    TS_CODES.TYPE_MISMATCH,
  );
  return undefined;
}
