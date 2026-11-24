import { describe, expect, it } from 'vitest';
import type { RhiCompareFunction } from './rhi.js';
import { webgl2Device } from './webgl2.js';
import { colourPass, fakeGl, pipelineOf, type FakeGlOptions } from './webgl2-fake-gl.js';

function setup(options?: FakeGlOptions) {
  const fake = fakeGl(options);
  return { ...fake, device: webgl2Device(fake.gl) };
}

const PROBED = [
  'EXT_color_buffer_float',
  'EXT_color_buffer_half_float',
  'OES_texture_float_linear',
  'EXT_polygon_offset_clamp',
  'WEBGL_provoking_vertex',
];

const everything = Object.fromEntries(
  PROBED.map((name) => [name, { FIRST_VERTEX_CONVENTION_WEBGL: 1, PROVOKING_VERTEX_WEBGL: 2 }]),
);

const extensionCalls = (calls: readonly string[]): string[] =>
  calls.filter((c) => c.startsWith('getExtension('));

const hostClass = async (name: string, body: (make: () => object) => void | Promise<void>) => {
  const holder = globalThis as unknown as Record<string, unknown>;
  const before = holder[name];
  const made = class {};
  holder[name] = made;
  try {
    await body(() => new made());
  } finally {
    holder[name] = before;
  }
};

describe('the state of one context of the WebGL2 backend', () => {
  it('asks the context for nothing until the first texture, pipeline, pass or feature question', async () => {
    const { device, calls } = setup();
    device.createBuffer({ size: 4, usage: ['vertex'] });
    device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
      addressModeU: 'repeat',
      addressModeV: 'repeat',
      addressModeW: 'repeat',
    });
    device.createShaderModule('x');
    expect(extensionCalls(calls)).toEqual([]);
    expect(calls.filter((c) => c === 'createFramebuffer()')).toEqual([]);
    device.createTexture({ size: [1, 1, 1], format: 'rgba8unorm', usage: [] });
    expect(extensionCalls(calls)).toHaveLength(PROBED.length);
  });

  it.each([
    [
      'a texture',
      (d: ReturnType<typeof setup>['device']) =>
        d.createTexture({ size: [1, 1, 1], format: 'rgba8unorm', usage: [] }),
    ],
    ['a pipeline', (d: ReturnType<typeof setup>['device']) => void pipelineOf(d)],
    ['a pass', (d: ReturnType<typeof setup>['device']) => colourPass(d)],
    ['a feature question', (d: ReturnType<typeof setup>['device']) => d.caps.hasFeature('x')],
  ])('makes the state at %s', (_name, act) => {
    const { device, calls } = setup();
    act(device);
    expect(extensionCalls(calls)).toHaveLength(PROBED.length);
  });

  it('requests each extension once, however many textures, pipelines and passes follow', async () => {
    const { device, calls } = setup({ extensions: everything });
    for (let i = 0; i < 3; i++) {
      device.createTexture({ size: [1, 1, 1], format: 'rgba8unorm', usage: [] });
      await pipelineOf(device);
      colourPass(device);
      device.caps.hasFeature('EXT_color_buffer_float');
    }
    expect(extensionCalls(calls).sort()).toEqual(PROBED.map((n) => `getExtension("${n}")`).sort());
    expect(calls.filter((c) => c === 'createFramebuffer()')).toHaveLength(2);
    expect(calls.filter((c) => c === 'createSampler()')).toHaveLength(1);
  });

  it('lists the extensions that the context gave, and no other', () => {
    const { device } = setup({
      extensions: {
        EXT_color_buffer_float: {},
        WEBGL_provoking_vertex: {},
        WEBGL_lose_context: {},
      },
    });
    const has = (n: string): boolean => device.caps.hasFeature(n);
    expect(PROBED.filter(has)).toEqual(['EXT_color_buffer_float', 'WEBGL_provoking_vertex']);
    expect(has('WEBGL_lose_context')).toBe(false);
    expect(has('nonsense')).toBe(false);
  });

  it('lists all five when the context has them', () => {
    const { device } = setup({ extensions: everything });
    expect(PROBED.every((n) => device.caps.hasFeature(n))).toBe(true);
  });
});

describe('the capabilities of the WebGL2 device', () => {
  it('runs commands as they are recorded, with GLSL ES 3.00 and emulated compute', () => {
    const { device } = setup();
    expect(device.backend).toBe('webgl2');
    expect(device.caps.immediate).toBe(true);
    expect(device.caps.shaderLanguage).toBe('glsl-es300');
    expect(device.caps.compute).toBe('fragment-emulated');
  });

  it('gives the smaller viewport dimension as a limit, read once, and frozen', () => {
    const { device, calls } = setup({
      parameters: { MAX_VIEWPORT_DIMS: new Int32Array([4096, 2048]) },
    });
    expect(calls).toEqual([]);
    expect(device.caps.limits).toEqual({ maxViewportDimension: 2048 });
    expect(Object.isFrozen(device.caps.limits)).toBe(true);
    void device.caps.limits;
    expect(calls.filter((c) => c === 'getParameter(MAX_VIEWPORT_DIMS)')).toHaveLength(1);
    const wide = setup({ parameters: { MAX_VIEWPORT_DIMS: new Int32Array([1000, 3000]) } });
    expect(wide.device.caps.limits.maxViewportDimension).toBe(1000);
  });

  it('refuses a compute pass and a compute pipeline, and names the pass program that runs a dispatch', async () => {
    const { device } = setup();
    expect(() => device.createCommandEncoder().beginComputePass()).toThrow(
      /no compute pass.*fragment-emulated/,
    );
    await expect(
      device.createComputePipeline({
        layouts: [],
        module: device.createShaderModule('x'),
        entryPoint: 'main',
      }),
    ).rejects.toThrow(TypeError);
  });

  it('refuses a module that is not GLSL text', () => {
    const { device } = setup();
    expect(() => device.createShaderModule({} as never)).toThrow(
      "The WebGL2 backend runs a GLSL ES 3.00 program's text",
    );
  });

  it('runs each command when it is recorded, and has nothing left to run at submit', async () => {
    const { device, calls } = setup();
    const encoder = device.createCommandEncoder();
    const texture = device.createTexture({ size: [2, 2, 1], format: 'rgba8unorm', usage: [] });
    const before = calls.length;
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: device.createView(texture),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: [1, 0, 0, 1],
        },
      ],
    });
    expect(calls.slice(before)).toContain('clearBufferfv(COLOR,0,[1,0,0,1])');
    pass.end();
    const mark = calls.length;
    await device.submit([encoder]);
    expect(calls.length).toBe(mark);
  });

  it('takes no call for a validation scope, and gives the first error of the context at the pop', async () => {
    let error = 0;
    const { device, calls, constant } = setup({
      returns: { getError: () => (error === 0 ? constant('NO_ERROR') : error) },
    });
    device.pushValidationScope();
    expect(calls).toEqual([]);
    expect(await device.popValidationScope()).toBeNull();
    error = 0x502;
    device.pushValidationScope();
    expect(await device.popValidationScope()).toBe('WebGL2 error 0x0502');
    error = 0x1ff0502;
    expect(await device.popValidationScope()).toBe('WebGL2 error 0x1ff0502');
    expect(calls.filter((c) => c === 'getError()')).toHaveLength(3);
  });
});

describe('a sampler of the WebGL2 backend', () => {
  const desc = (over: object = {}) => ({
    magFilter: 'nearest' as const,
    minFilter: 'nearest' as const,
    mipmapFilter: 'linear' as const,
    addressModeU: 'clamp-to-edge' as const,
    addressModeV: 'clamp-to-edge' as const,
    addressModeW: 'clamp-to-edge' as const,
    ...over,
  });
  const parameters = (calls: readonly string[]): string[] =>
    calls.filter((c) => c.startsWith('samplerParameteri(')).map((c) => c.replace(/^[^,]*,/, ''));

  it('sets the filters and the three wraps', () => {
    const { device, calls } = setup();
    device.createSampler(
      desc({
        magFilter: 'linear',
        addressModeU: 'repeat',
        addressModeV: 'mirror-repeat',
      }),
    );
    expect(parameters(calls)).toEqual([
      'TEXTURE_MIN_FILTER,NEAREST)',
      'TEXTURE_MAG_FILTER,LINEAR)',
      'TEXTURE_WRAP_S,REPEAT)',
      'TEXTURE_WRAP_T,MIRRORED_REPEAT)',
      'TEXTURE_WRAP_R,CLAMP_TO_EDGE)',
    ]);
  });

  it('takes no mipmap filter for the minification, whatever the mipmap filter says', () => {
    for (const mipmapFilter of ['nearest', 'linear'] as const)
      for (const minFilter of ['nearest', 'linear'] as const) {
        const { device, calls } = setup();
        device.createSampler(desc({ minFilter, mipmapFilter }));
        const min = parameters(calls)[0]!;
        expect(min).toBe(`TEXTURE_MIN_FILTER,${minFilter === 'linear' ? 'LINEAR' : 'NEAREST'})`);
        expect(calls.some((c) => c.includes('MIPMAP'))).toBe(false);
      }
  });

  it.each([
    ['never', 'NEVER'],
    ['less', 'LESS'],
    ['less-equal', 'LEQUAL'],
    ['greater-equal', 'GEQUAL'],
    ['always', 'ALWAYS'],
  ] as readonly (readonly [RhiCompareFunction, string])[])(
    'compares a comparison sampler with %s as %s',
    (compare, gl) => {
      const { device, calls } = setup();
      device.createSampler(desc({ compare }));
      expect(parameters(calls).slice(-2)).toEqual([
        'TEXTURE_COMPARE_MODE,COMPARE_REF_TO_TEXTURE)',
        `TEXTURE_COMPARE_FUNC,${gl})`,
      ]);
    },
  );

  it('sets no comparison for a sampler without one', () => {
    const { device, calls } = setup();
    device.createSampler(desc());
    expect(calls.some((c) => c.includes('COMPARE'))).toBe(false);
  });
});

describe('the native objects of the WebGL2 device', () => {
  it('gives the handle that the device made for each of its own objects, and the object of a handle', () => {
    const { device } = setup();
    const texture = device.createTexture({ size: [1, 1, 1], format: 'rgba8unorm', usage: [] });
    const native = device.toNative(texture);
    expect(device.fromNative('texture', native)).toBe(texture);
    const view = device.createView(texture);
    expect(device.createView(texture)).toBe(view);
    expect(device.toNative(view)).toBe(native);
    expect(device.fromNative('view', view)).toBe(view);
    const sampler = device.createSampler({
      magFilter: 'nearest',
      minFilter: 'nearest',
      mipmapFilter: 'nearest',
      addressModeU: 'repeat',
      addressModeV: 'repeat',
      addressModeW: 'repeat',
    });
    expect(device.fromNative('sampler', device.toNative(sampler))).toBe(sampler);
    const vertex = device.createBuffer({ size: 4, usage: ['vertex'] });
    expect(device.toNative(vertex)).not.toBe(vertex);
    const storage = device.createBuffer({ size: 4, usage: ['storage'] });
    expect(device.toNative(storage)).toBe(storage);
  });

  it('makes one handle for each object of the host, of the kind it is, and refuses the rest', async () => {
    const holder = globalThis as unknown as Record<string, unknown>;
    const before = ['WebGLBuffer', 'WebGLTexture', 'WebGLSampler'].map((n) => holder[n]);
    class WebGLBuffer {}
    class WebGLTexture {}
    class WebGLSampler {}
    Object.assign(holder, { WebGLBuffer, WebGLTexture, WebGLSampler });
    try {
      const { device } = setup();
      for (const [kind, host] of [
        ['buffer', new WebGLBuffer()],
        ['texture', new WebGLTexture()],
        ['sampler', new WebGLSampler()],
      ] as const) {
        const handle = device.fromNative(kind, host);
        expect(handle).toBeDefined();
        expect(device.fromNative(kind, host)).toBe(handle);
        expect(device.toNative(handle!)).toBe(host);
        expect(device.fromNative(kind, {})).toBeUndefined();
      }
      const texture = new WebGLTexture();
      const view = device.fromNative('view', texture)!;
      expect(device.toNative(view)).toBe(texture);
      expect(device.fromNative('view', {})).toBeUndefined();
      expect(device.fromNative('buffer', new WebGLTexture())).toBeUndefined();
    } finally {
      ['WebGLBuffer', 'WebGLTexture', 'WebGLSampler'].forEach((n, i) => (holder[n] = before[i]));
    }
  });

  it('gives the canvas handle for the context and its canvas, and has no native encoder or pass', () => {
    const { device, gl } = setup();
    const canvas = device.fromNative('canvas', gl)!;
    expect(canvas).toBeDefined();
    expect(device.fromNative('canvas', gl.canvas)).toBe(canvas);
    expect(device.toNative(canvas)).toBe(gl);
    expect(device.fromNative('canvas', {})).toBeUndefined();
    for (const kind of ['encoder', 'render-pass', 'compute-pass'] as const)
      expect(device.fromNative(kind, gl)).toBeUndefined();
    const other = {};
    expect(device.toNative(other)).toBe(other);
  });

  it('deletes the texture of the device on destroy, and not the texture of the host', async () => {
    await hostClass('WebGLTexture', (make) => {
      const { device, calls } = setup();
      device.destroyTexture(device.fromNative('texture', make())!);
      expect(calls.filter((c) => c.startsWith('deleteTexture('))).toEqual([]);
      device.destroyTexture(
        device.createTexture({ size: [1, 1, 1], format: 'rgba8unorm', usage: [] }),
      );
      expect(calls.filter((c) => c.startsWith('deleteTexture('))).toHaveLength(1);
    });
  });

  it('loses the context on destroy when the context has the extension, and does nothing otherwise', () => {
    const lost: string[] = [];
    const { device } = setup({
      extensions: { WEBGL_lose_context: { loseContext: () => lost.push('lost') } },
    });
    device.destroy();
    expect(lost).toEqual(['lost']);
    expect(() => setup().device.destroy()).not.toThrow();
  });
});
