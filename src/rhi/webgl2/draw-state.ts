import type { RhiCompareFunction, RhiRenderPipelineDesc, RhiStencilOperation } from '../rhi.js';
import type { GL } from './types.js';
import type { PolygonOffsetClamp } from './state.js';

interface DrawFace {
  readonly func: number;
  readonly fail: number;
  readonly zfail: number;
  readonly zpass: number;
}

export interface DrawState {
  readonly mode: number;
  readonly depth?: { readonly func: number; readonly write: boolean };
  readonly cull?: number;
  readonly frontFace: number;
  readonly blend?: {
    readonly src: [number, number];
    readonly dst: [number, number];
    readonly op: [number, number];
  };
  readonly mask: readonly [boolean, boolean, boolean, boolean];
  readonly stencil?: {
    readonly front: DrawFace;
    readonly back: DrawFace;
    readonly readMask: number;
    readonly writeMask: number;
  };
  readonly offset?: { readonly factor: number; readonly units: number; readonly clamp: number };
}

export const GL_TOPOLOGY: Readonly<
  Record<string, 'TRIANGLES' | 'TRIANGLE_STRIP' | 'LINES' | 'LINE_STRIP' | 'POINTS'>
> = {
  'triangle-list': 'TRIANGLES',
  'triangle-strip': 'TRIANGLE_STRIP',
  'line-list': 'LINES',
  'line-strip': 'LINE_STRIP',
  'point-list': 'POINTS',
};

export const GL_BLEND_FACTOR: Readonly<Record<string, string>> = {
  zero: 'ZERO',
  one: 'ONE',
  src: 'SRC_COLOR',
  'one-minus-src': 'ONE_MINUS_SRC_COLOR',
  'src-alpha': 'SRC_ALPHA',
  'one-minus-src-alpha': 'ONE_MINUS_SRC_ALPHA',
  dst: 'DST_COLOR',
  'one-minus-dst': 'ONE_MINUS_DST_COLOR',
  'dst-alpha': 'DST_ALPHA',
  'one-minus-dst-alpha': 'ONE_MINUS_DST_ALPHA',
  'src-alpha-saturated': 'SRC_ALPHA_SATURATE',
  constant: 'CONSTANT_COLOR',
  'one-minus-constant': 'ONE_MINUS_CONSTANT_COLOR',
};

export const GL_BLEND_OPERATION: Readonly<Record<string, string>> = {
  add: 'FUNC_ADD',
  subtract: 'FUNC_SUBTRACT',
  'reverse-subtract': 'FUNC_REVERSE_SUBTRACT',
  min: 'MIN',
  max: 'MAX',
};

interface BlendComponent {
  readonly srcFactor?: string;
  readonly dstFactor?: string;
  readonly operation?: string;
}

export function compareOf(gl: GL, c: RhiCompareFunction): number {
  const table: Record<RhiCompareFunction, number> = {
    never: gl.NEVER,
    less: gl.LESS,
    equal: gl.EQUAL,
    'less-equal': gl.LEQUAL,
    greater: gl.GREATER,
    'not-equal': gl.NOTEQUAL,
    'greater-equal': gl.GEQUAL,
    always: gl.ALWAYS,
  };
  return table[c];
}

function stencilOpOf(gl: GL, op: RhiStencilOperation): number {
  const table: Record<RhiStencilOperation, number> = {
    keep: gl.KEEP,
    zero: gl.ZERO,
    replace: gl.REPLACE,
    invert: gl.INVERT,
    'increment-clamp': gl.INCR,
    'decrement-clamp': gl.DECR,
    'increment-wrap': gl.INCR_WRAP,
    'decrement-wrap': gl.DECR_WRAP,
  };
  return table[op];
}

export function drawStateOf(gl: GL, desc: RhiRenderPipelineDesc): DrawState {
  const g = gl as unknown as Record<string, number>;
  // Why: WebGL2 has one blend state and one write mask for every target, so the first target's are used.
  const first = desc.fragment?.targets[0];
  const blend = first?.blend as { color?: BlendComponent; alpha?: BlendComponent } | undefined;
  const factor = (f: string | undefined, d: string): number => g[GL_BLEND_FACTOR[f ?? d]!]!;
  const op = (o: string | undefined): number => g[GL_BLEND_OPERATION[o ?? 'add']!]!;
  const mask = first?.writeMask ?? 15;
  const cull = desc.primitive.cullMode;
  const face = (f: {
    compare: RhiCompareFunction;
    failOp: RhiStencilOperation;
    depthFailOp: RhiStencilOperation;
    passOp: RhiStencilOperation;
  }): DrawFace => ({
    func: compareOf(gl, f.compare),
    fail: stencilOpOf(gl, f.failOp),
    zfail: stencilOpOf(gl, f.depthFailOp),
    zpass: stencilOpOf(gl, f.passOp),
  });
  const ds = desc.depthStencil;
  const stencil = ds?.stencil;
  const bias = ds?.bias;
  return {
    mode: g[GL_TOPOLOGY[desc.primitive.topology]!]!,
    ...(ds !== undefined ? { depth: { func: compareOf(gl, ds.compare), write: ds.write } } : {}),
    ...(stencil !== undefined
      ? {
          stencil: {
            front: face(stencil.front),
            back: face(stencil.back),
            readMask: stencil.readMask,
            writeMask: stencil.writeMask,
          },
        }
      : {}),
    ...(bias !== undefined && (bias.constant !== 0 || bias.slopeScale !== 0)
      ? { offset: { factor: bias.slopeScale, units: bias.constant, clamp: bias.clamp } }
      : {}),
    ...(cull === 'none' ? {} : { cull: cull === 'front' ? gl.FRONT : gl.BACK }),
    frontFace: desc.primitive.frontFace === 'ccw' ? gl.CW : gl.CCW,
    ...(blend !== undefined
      ? {
          blend: {
            src: [factor(blend.color?.srcFactor, 'one'), factor(blend.alpha?.srcFactor, 'one')],
            dst: [factor(blend.color?.dstFactor, 'zero'), factor(blend.alpha?.dstFactor, 'zero')],
            op: [op(blend.color?.operation), op(blend.alpha?.operation)],
          },
        }
      : {}),
    mask: [(mask & 1) !== 0, (mask & 2) !== 0, (mask & 4) !== 0, (mask & 8) !== 0],
  };
}

export function setState(
  gl: GL,
  s: DrawState,
  reference: number,
  clampExtension: PolygonOffsetClamp | null,
): void {
  if (s.depth === undefined) gl.disable(gl.DEPTH_TEST);
  else {
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(s.depth.func);
    gl.depthMask(s.depth.write);
  }
  if (s.cull === undefined) gl.disable(gl.CULL_FACE);
  else {
    gl.enable(gl.CULL_FACE);
    gl.cullFace(s.cull);
  }
  gl.frontFace(s.frontFace);
  if (s.blend === undefined) gl.disable(gl.BLEND);
  else {
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(s.blend.src[0], s.blend.dst[0], s.blend.src[1], s.blend.dst[1]);
    gl.blendEquationSeparate(s.blend.op[0], s.blend.op[1]);
  }
  gl.colorMask(...s.mask);
  if (s.stencil === undefined) gl.disable(gl.STENCIL_TEST);
  else {
    const t = s.stencil;
    gl.enable(gl.STENCIL_TEST);
    gl.stencilFuncSeparate(gl.FRONT, t.front.func, reference, t.readMask);
    gl.stencilFuncSeparate(gl.BACK, t.back.func, reference, t.readMask);
    gl.stencilOpSeparate(gl.FRONT, t.front.fail, t.front.zfail, t.front.zpass);
    gl.stencilOpSeparate(gl.BACK, t.back.fail, t.back.zfail, t.back.zpass);
    gl.stencilMaskSeparate(gl.FRONT, t.writeMask);
    gl.stencilMaskSeparate(gl.BACK, t.writeMask);
  }
  if (s.offset === undefined) gl.disable(gl.POLYGON_OFFSET_FILL);
  else {
    gl.enable(gl.POLYGON_OFFSET_FILL);
    if (s.offset.clamp === 0) gl.polygonOffset(s.offset.factor, s.offset.units);
    else clampExtension!.polygonOffsetClampEXT(s.offset.factor, s.offset.units, s.offset.clamp);
  }
}
