// The WebGL2 backend takes a `flat` interstage value from the first vertex of a primitive, as
// WebGPU does (Rule 1.6). GLSL ES 3.00 takes it from the last. The compile gate holds the pixels on
// a real context (`rhi-conformance.ts`, the three flat cases), and a real context goes one of two
// ways. This suite holds both to the calls a context receives: one that has
// `WEBGL_provoking_vertex`, and one that lacks it, where the backend draws each triangle with its
// first vertex last and refuses a line.

import { describe, expect, it } from 'vitest';
import type { RhiDevice, RhiRenderPass } from './rhi.js';
import { firstVertexLast, webgl2Device } from './webgl2.js';

const FIRST = 0x8e4d;
const LAST = 0x8e4e;
const PROVOKING = 0x8e4f;

/** A WebGL2 context that draws nothing and logs every call as `name(args)`, each constant by its
 *  name. `extension` says whether it has `WEBGL_provoking_vertex`, whose convention starts as the
 *  last vertex. `uploads` holds the data of each `bufferData`, and `hostIndices` is what
 *  `getBufferSubData` reads back. */
function fakeGl(extension: boolean, hostIndices: readonly number[] = []) {
  const calls: string[] = [];
  const uploads: number[][] = [];
  const names = new Map<number, string>([[PROVOKING, 'PROVOKING_VERTEX_WEBGL']]);
  const values: Record<string, number> = {};
  let next = 0x4000;
  const valueOf = (name: string): number => {
    if (!(name in values)) {
      values[name] = next++;
      names.set(values[name], name);
    }
    return values[name];
  };
  let made = 0;
  let convention = LAST;
  const show = (v: unknown): string =>
    typeof v === 'number'
      ? (names.get(v) ?? String(v))
      : v !== null && typeof v === 'object' && '__name' in v
        ? (v as { __name: string }).__name
        : ArrayBuffer.isView(v)
          ? `[${Array.from(v as unknown as ArrayLike<number>).join(',')}]`
          : String(v);
  const host: Record<string, (...a: unknown[]) => unknown> = {
    getParameter: (p) => (p === PROVOKING ? convention : 4),
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    isProgram: () => true,
    createShader: () => ({ __name: 'shader' }),
    createProgram: () => ({ __name: 'program' }),
    createVertexArray: () => ({ __name: 'vao' }),
    createFramebuffer: () => ({ __name: 'fbo' }),
    createSampler: () => ({ __name: 'sampler' }),
    createTexture: () => ({ __name: 'texture' }),
    createBuffer: () => ({ __name: `buffer${String(made++)}` }),
    bufferData: (_target, data) => {
      if (ArrayBuffer.isView(data)) uploads.push(Array.from(data as unknown as ArrayLike<number>));
    },
    getBufferParameter: () => hostIndices.length * 2,
    getBufferSubData: (_target, _offset, into) => {
      (into as Uint16Array).set(hostIndices.slice(0, (into as Uint16Array).length));
    },
    getExtension: (name) =>
      extension && name === 'WEBGL_provoking_vertex'
        ? {
            FIRST_VERTEX_CONVENTION_WEBGL: FIRST,
            PROVOKING_VERTEX_WEBGL: PROVOKING,
            provokingVertexWEBGL: (mode: number) => {
              convention = mode;
              calls.push(`provokingVertexWEBGL(${mode === FIRST ? 'FIRST' : 'LAST'})`);
            },
          }
        : null,
  };
  const gl = new Proxy(
    {},
    {
      get: (_t, key) => {
        if (typeof key !== 'string') return undefined;
        if (key === 'drawingBufferWidth' || key === 'drawingBufferHeight') return 8;
        if (/^[A-Z][A-Z0-9_]*$/.test(key)) return valueOf(key);
        const fn = host[key] ?? (() => undefined);
        return (...a: unknown[]) => {
          calls.push(`${key}(${a.map(show).join(',')})`);
          return fn(...a);
        };
      },
    },
  ) as unknown as WebGL2RenderingContext;
  return { gl, calls, uploads, convention: () => convention };
}

const VERTEX = (varying: string): string => `#version 300 es
${varying}
void main() { gl_Position = vec4(0.0); v = 1.0; }
`;
const FRAGMENT = `#version 300 es
precision highp float;
layout(location = 0) out vec4 o;
void main() { o = vec4(1.0); }
`;

/** A pipeline of `topology` whose vertex program declares `varying`. */
const pipelineOf = (device: RhiDevice, varying: string, topology = 'triangle-list') =>
  device.createRenderPipeline({
    label: 'the pipeline of the test',
    layouts: [],
    module: device.createShaderModule(VERTEX(varying)),
    vertex: { entryPoint: 'main', buffers: [] },
    fragment: {
      entryPoint: 'main',
      targets: [{ format: 'rgba8unorm' }],
      module: device.createShaderModule(FRAGMENT),
    },
    primitive: { topology, cullMode: 'none', frontFace: 'ccw' },
    multisample: { count: 1, mask: 0xffffffff },
  });

/** A pass of `device` into a texture of its own, run by `draws` and ended. */
function pass(device: RhiDevice, draws: (pass: RhiRenderPass) => void): void {
  const t = device.createTexture({ size: [8, 8, 1], format: 'rgba8unorm', usage: ['render'] });
  const p = device.createCommandEncoder().beginRenderPass({
    colorAttachments: [
      { view: device.createView(t), loadOp: 'load', storeOp: 'store', clearValue: [0, 0, 0, 0] },
    ],
  });
  draws(p);
  p.end();
}

/** The draw calls and the provoking vertex calls among `calls`. */
const drawn = (calls: readonly string[]): string[] =>
  calls.filter((c) => /^(draw(Arrays|Elements)Instanced|provokingVertexWEBGL)\(/.test(c));

describe('firstVertexLast: the triangles of a draw, each with its first vertex last', () => {
  it('turns each triangle of a list round, and drops what makes no triangle', () => {
    expect([...firstVertexLast(6, false)]).toEqual([1, 2, 0, 4, 5, 3]);
    expect([...firstVertexLast(5, false)]).toEqual([1, 2, 0]);
    expect([...firstVertexLast(2, false)]).toEqual([]);
  });

  it('makes a list of a strip, an odd triangle wound as the strip winds it', () => {
    // Triangle 1 of a strip is vertices 1, 2 and 3, wound 2 1 3: with vertex 1 last, 3 2 1.
    expect([...firstVertexLast(5, true)]).toEqual([1, 2, 0, 3, 2, 1, 3, 4, 2]);
    expect([...firstVertexLast(2, true)]).toEqual([]);
  });

  it('reads the indices of an index buffer', () => {
    expect([...firstVertexLast(6, false, [7, 8, 9, 9, 8, 4])]).toEqual([8, 9, 7, 8, 4, 9]);
    expect([...firstVertexLast(4, true, [7, 8, 9, 4])]).toEqual([8, 9, 7, 4, 9, 8]);
  });

  it('starts a new primitive at the restart index, as WebGL2 does', () => {
    expect([...firstVertexLast(7, true, [0, 1, 2, 0xffff, 3, 4, 5], 0xffff)]).toEqual([
      1, 2, 0, 4, 5, 3,
    ]);
    expect([...firstVertexLast(7, false, [0, 1, 0xffff, 3, 4, 5, 6], 0xffff)]).toEqual([4, 5, 3]);
  });
});

describe('a flat value on a context without WEBGL_provoking_vertex', () => {
  it('draws a list with no index buffer through indices that name each first vertex last', async () => {
    const { gl, calls, uploads } = fakeGl(false);
    const device = webgl2Device(gl);
    const pipeline = await pipelineOf(device, 'flat out float v;');
    pass(device, (p) => {
      p.setPipeline(pipeline);
      p.draw(6, 2);
      // A second draw of no more vertices reuses the buffer.
      p.draw(3);
    });
    expect(drawn(calls)).toEqual([
      'drawElementsInstanced(TRIANGLES,6,UNSIGNED_INT,0,2)',
      'drawElementsInstanced(TRIANGLES,3,UNSIGNED_INT,0,1)',
    ]);
    expect(uploads).toEqual([[1, 2, 0, 4, 5, 3]]);
  });

  it('draws a strip as the list of its triangles', async () => {
    const { gl, calls, uploads } = fakeGl(false);
    const device = webgl2Device(gl);
    const pipeline = await pipelineOf(device, 'flat out float v;', 'triangle-strip');
    pass(device, (p) => {
      p.setPipeline(pipeline);
      p.draw(4);
    });
    expect(drawn(calls)).toEqual(['drawElementsInstanced(TRIANGLES,6,UNSIGNED_INT,0,1)']);
    expect(uploads).toEqual([[1, 2, 0, 3, 2, 1]]);
  });

  it('draws an index buffer through its indices turned round, made again when it is written', async () => {
    const { gl, calls, uploads } = fakeGl(false);
    const device = webgl2Device(gl);
    const pipeline = await pipelineOf(device, 'flat out float v;');
    const indices = device.createBuffer({ size: 12, usage: ['index', 'copy-dst'] });
    device.writeBuffer(indices, 0, new Uint16Array([0, 1, 2, 2, 1, 3]));
    const draw = (): void =>
      pass(device, (p) => {
        p.setPipeline(pipeline);
        p.setIndexBuffer(indices, 'uint16');
        p.drawIndexed(6);
      });
    draw();
    draw();
    const turned = (): number[][] => uploads.filter((u) => u.length === 6);
    expect(turned()).toEqual([[1, 2, 0, 1, 3, 2]]);
    device.writeBuffer(indices, 0, new Uint16Array([3, 2, 1]));
    draw();
    expect(turned()).toEqual([
      [1, 2, 0, 1, 3, 2],
      [2, 1, 3, 1, 3, 2],
    ]);
    expect(drawn(calls)).toEqual(
      Array(3).fill('drawElementsInstanced(TRIANGLES,6,UNSIGNED_INT,0,1)'),
    );
  });

  it("reads a host's own index buffer back for each draw", async () => {
    const { gl, calls, uploads } = fakeGl(false, [0, 1, 2, 2, 1, 3]);
    const device = webgl2Device(gl);
    const pipeline = await pipelineOf(device, 'flat out float v;');
    class WebGLBuffer {}
    const scope = globalThis as { WebGLBuffer?: unknown };
    const before = scope.WebGLBuffer;
    scope.WebGLBuffer = WebGLBuffer;
    try {
      const indices = device.fromNative('buffer', new WebGLBuffer())!;
      pass(device, (p) => {
        p.setPipeline(pipeline);
        p.setIndexBuffer(indices, 'uint16');
        p.drawIndexed(6);
        p.drawIndexed(3);
      });
    } finally {
      scope.WebGLBuffer = before;
    }
    expect(uploads).toEqual([
      [1, 2, 0, 1, 3, 2],
      [1, 2, 0],
    ]);
    expect(drawn(calls)).toEqual([
      'drawElementsInstanced(TRIANGLES,6,UNSIGNED_INT,0,1)',
      'drawElementsInstanced(TRIANGLES,3,UNSIGNED_INT,0,1)',
    ]);
  });

  it('draws a pipeline with no flat value, and a point list with one, as before', async () => {
    const { gl, calls, uploads } = fakeGl(false);
    const device = webgl2Device(gl);
    const smooth = await pipelineOf(device, 'out float v;');
    const points = await pipelineOf(device, 'flat out float v;', 'point-list');
    pass(device, (p) => {
      p.setPipeline(smooth);
      p.draw(3);
      p.setPipeline(points);
      p.draw(3);
    });
    expect(drawn(calls)).toEqual([
      'drawArraysInstanced(TRIANGLES,0,3,1)',
      'drawArraysInstanced(POINTS,0,3,1)',
    ]);
    expect(uploads).toEqual([]);
  });

  it('refuses a line pipeline with a flat value, and names the extension', async () => {
    const device = webgl2Device(fakeGl(false).gl);
    for (const topology of ['line-list', 'line-strip'])
      await expect(pipelineOf(device, 'flat out float v;', topology)).rejects.toThrow(
        new TypeError(
          `the pipeline of the test: a flat interstage value on a ${topology} needs WEBGL_provoking_vertex on WebGL2, and this context lacks it. WebGPU takes a flat value from the first vertex of a line and GLSL ES 3.00 from the last, and a line turned round covers other pixels at its ends.`,
        ),
      );
    // A line with no flat value has no first vertex to take.
    await expect(pipelineOf(device, 'out float v;', 'line-list')).resolves.toBeDefined();
    expect(device.caps.hasFeature('WEBGL_provoking_vertex')).toBe(false);
  });
});

describe('a flat value on a context with WEBGL_provoking_vertex', () => {
  it('sets the first vertex once for the pass, and gives the host its convention back', async () => {
    const { gl, calls, uploads, convention } = fakeGl(true);
    const device = webgl2Device(gl);
    const flat = await pipelineOf(device, 'flat out float v;');
    const lines = await pipelineOf(device, 'flat out float v;', 'line-list');
    pass(device, (p) => {
      p.setPipeline(flat);
      p.draw(6);
      p.setPipeline(lines);
      p.draw(4);
    });
    expect(drawn(calls)).toEqual([
      'provokingVertexWEBGL(FIRST)',
      'drawArraysInstanced(TRIANGLES,0,6,1)',
      'drawArraysInstanced(LINES,0,4,1)',
      'provokingVertexWEBGL(LAST)',
    ]);
    expect(calls.filter((c) => c === 'getParameter(PROVOKING_VERTEX_WEBGL)')).toHaveLength(1);
    expect(convention()).toBe(LAST);
    expect(uploads).toEqual([]);
    expect(device.caps.hasFeature('WEBGL_provoking_vertex')).toBe(true);
  });

  it('leaves the convention alone in a pass that draws no flat value', async () => {
    const { gl, calls } = fakeGl(true);
    const device = webgl2Device(gl);
    const smooth = await pipelineOf(device, 'out float v;');
    pass(device, (p) => {
      p.setPipeline(smooth);
      p.draw(3);
    });
    expect(drawn(calls)).toEqual(['drawArraysInstanced(TRIANGLES,0,3,1)']);
    expect(calls).not.toContain('getParameter(PROVOKING_VERTEX_WEBGL)');
  });
});
