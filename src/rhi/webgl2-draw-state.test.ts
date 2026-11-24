import { describe, expect, it } from 'vitest';
import type { RhiCompareFunction, RhiDepthStencilState, RhiStencilOperation } from './rhi.js';
import { GL_BLEND_FACTOR, GL_BLEND_OPERATION, GL_TOPOLOGY, webgl2Device } from './webgl2.js';
import {
  NO_BIAS,
  colourPass,
  fakeGl,
  pipelineOf,
  type FakeGlOptions,
  type PipelineOptions,
} from './webgl2-fake-gl.js';

async function stateOf(
  options: PipelineOptions,
  gl: FakeGlOptions = {},
  reference?: number,
): Promise<string[]> {
  const fake = fakeGl(gl);
  const device = webgl2Device(fake.gl);
  const pipeline = await pipelineOf(device, options);
  colourPass(device, {}, (p) => {
    p.setPipeline(pipeline);
    if (reference !== undefined) p.setStencilReference(reference);
    p.draw(3);
  });
  const from = fake.calls.findIndex((c) => c.startsWith('bindVertexArray(vao'));
  const to = fake.calls.findIndex((c) => c.startsWith('drawArraysInstanced('));
  return fake.calls.slice(from, to);
}

const COMPARE: readonly (readonly [RhiCompareFunction, string])[] = [
  ['never', 'NEVER'],
  ['less', 'LESS'],
  ['equal', 'EQUAL'],
  ['less-equal', 'LEQUAL'],
  ['greater', 'GREATER'],
  ['not-equal', 'NOTEQUAL'],
  ['greater-equal', 'GEQUAL'],
  ['always', 'ALWAYS'],
];

const STENCIL: readonly (readonly [RhiStencilOperation, string])[] = [
  ['keep', 'KEEP'],
  ['zero', 'ZERO'],
  ['replace', 'REPLACE'],
  ['invert', 'INVERT'],
  ['increment-clamp', 'INCR'],
  ['decrement-clamp', 'DECR'],
  ['increment-wrap', 'INCR_WRAP'],
  ['decrement-wrap', 'DECR_WRAP'],
];

const depthStencil = (over: Partial<RhiDepthStencilState> = {}): RhiDepthStencilState => ({
  format: 'depth24plus-stencil8',
  compare: 'less',
  write: true,
  bias: NO_BIAS,
  ...over,
});

const face = (
  compare: RhiCompareFunction,
  failOp: RhiStencilOperation,
  depthFailOp: RhiStencilOperation,
  passOp: RhiStencilOperation,
) => ({ compare, failOp, depthFailOp, passOp });

describe('the names of WebGPU states as WebGL2 constants', () => {
  it('names the GL mode of each topology', () => {
    expect(GL_TOPOLOGY).toEqual({
      'triangle-list': 'TRIANGLES',
      'triangle-strip': 'TRIANGLE_STRIP',
      'line-list': 'LINES',
      'line-strip': 'LINE_STRIP',
      'point-list': 'POINTS',
    });
  });

  it('names the GL factor of each blend factor', () => {
    expect(GL_BLEND_FACTOR).toEqual({
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
    });
  });

  it('names the GL equation of each blend operation', () => {
    expect(GL_BLEND_OPERATION).toEqual({
      add: 'FUNC_ADD',
      subtract: 'FUNC_SUBTRACT',
      'reverse-subtract': 'FUNC_REVERSE_SUBTRACT',
      min: 'MIN',
      max: 'MAX',
    });
  });

  it.each(Object.entries(GL_TOPOLOGY))('draws a %s with the mode %s', async (topology, mode) => {
    const fake = fakeGl();
    const device = webgl2Device(fake.gl);
    const pipeline = await pipelineOf(device, { topology });
    colourPass(device, {}, (p) => {
      p.setPipeline(pipeline);
      p.draw(5);
    });
    expect(fake.calls).toContain(`drawArraysInstanced(${mode},0,5,1)`);
  });
});

describe('the state a pipeline sets before each draw', () => {
  it('turns off every test and blend, with all channels written, for a bare pipeline', async () => {
    expect(await stateOf({})).toEqual([
      expect.stringMatching(/^bindVertexArray\(vao/),
      'disable(DEPTH_TEST)',
      'disable(CULL_FACE)',
      'frontFace(CW)',
      'disable(BLEND)',
      'colorMask(true,true,true,true)',
      'disable(STENCIL_TEST)',
      'disable(POLYGON_OFFSET_FILL)',
    ]);
  });

  it('turns the winding round, because the position is flipped in y', async () => {
    expect(await stateOf({ frontFace: 'ccw' })).toContain('frontFace(CW)');
    expect(await stateOf({ frontFace: 'cw' })).toContain('frontFace(CCW)');
  });

  it('culls the face the pipeline names', async () => {
    expect(await stateOf({ cullMode: 'front' })).toEqual(
      expect.arrayContaining(['enable(CULL_FACE)', 'cullFace(FRONT)']),
    );
    expect(await stateOf({ cullMode: 'back' })).toEqual(
      expect.arrayContaining(['enable(CULL_FACE)', 'cullFace(BACK)']),
    );
  });

  it.each(Object.entries(GL_BLEND_FACTOR))(
    'blends with the factor %s as %s',
    async (factor, gl) => {
      const state = await stateOf({
        targets: [
          { format: 'rgba8unorm', blend: { color: { srcFactor: factor, dstFactor: factor } } },
        ],
      });
      expect(state).toContain(`blendFuncSeparate(${gl},${gl},ONE,ZERO)`);
    },
  );

  it.each(Object.entries(GL_BLEND_OPERATION))(
    'blends with the operation %s as %s',
    async (op, gl) => {
      const state = await stateOf({
        targets: [{ format: 'rgba8unorm', blend: { alpha: { operation: op } } }],
      });
      expect(state).toContain(`blendEquationSeparate(FUNC_ADD,${gl})`);
    },
  );

  it('blends with one, zero and add where the state names no factor or operation', async () => {
    const state = await stateOf({ targets: [{ format: 'rgba8unorm', blend: {} }] });
    expect(state).toEqual(
      expect.arrayContaining([
        'enable(BLEND)',
        'blendFuncSeparate(ONE,ZERO,ONE,ZERO)',
        'blendEquationSeparate(FUNC_ADD,FUNC_ADD)',
      ]),
    );
  });

  it('sets colour and alpha apart', async () => {
    const state = await stateOf({
      targets: [
        {
          format: 'rgba8unorm',
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'dst-alpha', operation: 'subtract' },
          },
        },
      ],
    });
    expect(state).toContain('blendFuncSeparate(SRC_ALPHA,ONE_MINUS_SRC_ALPHA,ONE,DST_ALPHA)');
    expect(state).toContain('blendEquationSeparate(FUNC_ADD,FUNC_SUBTRACT)');
  });

  it('takes the blend state and the write mask of the first target for every target', async () => {
    const state = await stateOf({
      targets: [
        { format: 'rgba8unorm', blend: { color: { srcFactor: 'dst' } }, writeMask: 0b0101 },
        { format: 'rgba8unorm', blend: { color: { srcFactor: 'src' } }, writeMask: 0 },
      ],
    });
    expect(state).toContain('blendFuncSeparate(DST_COLOR,ZERO,ONE,ZERO)');
    expect(state).toContain('colorMask(true,false,true,false)');
    expect(state.filter((c) => c.startsWith('colorMask('))).toHaveLength(1);
  });

  it('takes no blend from a first target with none, even when a later one has it', async () => {
    const state = await stateOf({
      targets: [
        { format: 'rgba8unorm' },
        { format: 'rgba8unorm', blend: { color: { srcFactor: 'src' } } },
      ],
    });
    expect(state).toContain('disable(BLEND)');
  });

  it.each([
    [0, 'false,false,false,false'],
    [1, 'true,false,false,false'],
    [2, 'false,true,false,false'],
    [4, 'false,false,true,false'],
    [8, 'false,false,false,true'],
    [15, 'true,true,true,true'],
  ])('writes the channels of the mask %i as colorMask(%s)', async (writeMask, shown) => {
    const state = await stateOf({ targets: [{ format: 'rgba8unorm', writeMask }] });
    expect(state).toContain(`colorMask(${shown})`);
  });

  it('writes every channel when the target has no mask, and for a pipeline with no target', async () => {
    expect(await stateOf({ targets: null })).toContain('colorMask(true,true,true,true)');
  });

  it('links a depth-only pipeline with a fragment program that writes no colour', async () => {
    const fake = fakeGl();
    const device = webgl2Device(fake.gl);
    await pipelineOf(device, { targets: null });
    const sources = fake.calls.filter((c) => c.startsWith('shaderSource('));
    expect(sources).toHaveLength(2);
    expect(sources[1]).toContain('void main() {}');
    expect(sources[1]).not.toContain('layout(location');
  });

  it.each(COMPARE)('tests depth with %s as %s', async (compare, gl) => {
    const state = await stateOf({ depthStencil: depthStencil({ compare }) });
    expect(state).toEqual(
      expect.arrayContaining(['enable(DEPTH_TEST)', `depthFunc(${gl})`, 'depthMask(true)']),
    );
  });

  it('masks the depth write off when the pipeline does not write depth', async () => {
    const state = await stateOf({ depthStencil: depthStencil({ write: false }) });
    expect(state).toContain('depthMask(false)');
  });

  it.each(COMPARE)(
    'tests the stencil with %s as %s, with the reference and read mask',
    async (compare, gl) => {
      const state = await stateOf(
        {
          depthStencil: depthStencil({
            stencil: {
              front: face(compare, 'keep', 'keep', 'keep'),
              back: face('always', 'keep', 'keep', 'keep'),
              readMask: 0x0f,
              writeMask: 0xf0,
            },
          }),
        },
        {},
        9,
      );
      expect(state).toContain('enable(STENCIL_TEST)');
      expect(state).toContain(`stencilFuncSeparate(FRONT,${gl},9,15)`);
      expect(state).toContain('stencilFuncSeparate(BACK,ALWAYS,9,15)');
      expect(state).toContain('stencilMaskSeparate(FRONT,240)');
      expect(state).toContain('stencilMaskSeparate(BACK,240)');
    },
  );

  it.each(STENCIL)(
    'maps the stencil operation %s to %s on each face and each outcome',
    async (op, gl) => {
      const state = await stateOf({
        depthStencil: depthStencil({
          stencil: {
            front: face('always', op, 'keep', 'zero'),
            back: face('always', 'keep', op, 'replace'),
            readMask: 255,
            writeMask: 255,
          },
        }),
      });
      expect(state).toContain(`stencilOpSeparate(FRONT,${gl},KEEP,ZERO)`);
      expect(state).toContain(`stencilOpSeparate(BACK,KEEP,${gl},REPLACE)`);
    },
  );

  it('turns the stencil test off for a pipeline with no stencil', async () => {
    const state = await stateOf({ depthStencil: depthStencil() });
    expect(state).toContain('disable(STENCIL_TEST)');
    expect(state.filter((c) => c.startsWith('stencil'))).toEqual([]);
  });

  it('passes the reference of each stencil draw to its own stencilFuncSeparate, with no call of its own', async () => {
    const fake = fakeGl();
    const device = webgl2Device(fake.gl);
    const stencil = {
      front: face('equal', 'keep', 'keep', 'keep'),
      back: face('equal', 'keep', 'keep', 'keep'),
      readMask: 255,
      writeMask: 255,
    };
    const pipeline = await pipelineOf(device, { depthStencil: depthStencil({ stencil }) });
    let before = 0;
    let after = 0;
    colourPass(device, {}, (p) => {
      p.setPipeline(pipeline);
      p.setStencilReference(1);
      before = fake.calls.length;
      p.setStencilReference(2);
      after = fake.calls.length;
      p.draw(3);
      p.setStencilReference(3);
      p.draw(3);
    });
    expect(after).toBe(before);
    const funcs = fake.calls.filter((c) => c.startsWith('stencilFuncSeparate(FRONT'));
    expect(funcs).toEqual([
      'stencilFuncSeparate(FRONT,EQUAL,2,255)',
      'stencilFuncSeparate(FRONT,EQUAL,3,255)',
    ]);
  });

  it('sets the polygon offset with the slope scale as the factor and the constant as the units', async () => {
    const bias = { constant: 2, slopeScale: 3, clamp: 0 };
    const state = await stateOf({ depthStencil: depthStencil({ bias }) });
    expect(state).toContain('enable(POLYGON_OFFSET_FILL)');
    expect(state).toContain('polygonOffset(3,2)');
  });

  it('sets the polygon offset through the clamp extension when the clamp is not 0', async () => {
    const seen: number[][] = [];
    const extension = {
      polygonOffsetClampEXT: (...a: number[]) => seen.push(a),
    };
    const bias = { constant: 2, slopeScale: 3, clamp: 0.5 };
    const state = await stateOf(
      { depthStencil: depthStencil({ bias }) },
      { extensions: { EXT_polygon_offset_clamp: extension } },
    );
    expect(seen).toEqual([[3, 2, 0.5]]);
    expect(state).toContain('enable(POLYGON_OFFSET_FILL)');
    expect(state.filter((c) => c.startsWith('polygonOffset('))).toEqual([]);
  });

  it.each([
    [{ constant: 0, slopeScale: 0, clamp: 0 }],
    [{ constant: 0, slopeScale: 0, clamp: 0.5 }],
  ])('sets no polygon offset when the constant and the slope are 0 (%j)', async (bias) => {
    const state = await stateOf({ depthStencil: depthStencil({ bias }) });
    expect(state).toContain('disable(POLYGON_OFFSET_FILL)');
  });

  it('sets a polygon offset for a slope alone and for a constant alone', async () => {
    const slope = await stateOf({
      depthStencil: depthStencil({ bias: { constant: 0, slopeScale: 1.5, clamp: 0 } }),
    });
    expect(slope).toContain('polygonOffset(1.5,0)');
    const constant = await stateOf({
      depthStencil: depthStencil({ bias: { constant: 4, slopeScale: 0, clamp: 0 } }),
    });
    expect(constant).toContain('polygonOffset(0,4)');
  });
});

describe('the vertex program of a pipeline', () => {
  it('turns the position to GL clip space after the program has run it', async () => {
    const fake = fakeGl();
    const device = webgl2Device(fake.gl);
    await pipelineOf(device);
    const vertex = fake.calls.find((c) => c.startsWith('shaderSource('))!;
    const source = JSON.parse(
      vertex.slice(vertex.indexOf('"'), vertex.lastIndexOf('"') + 1),
    ) as string;
    expect(source).toContain('void _ts_main()');
    expect(source).not.toMatch(/void main\(\) \{ gl_Position/);
    const body = source.slice(source.indexOf('void main() {\n  _ts_main();'));
    expect(body).toBe(
      'void main() {\n  _ts_main();\n  gl_Position.y = -gl_Position.y;\n  gl_Position.z = 2.0 * gl_Position.z - gl_Position.w;\n}\n',
    );
  });
});
