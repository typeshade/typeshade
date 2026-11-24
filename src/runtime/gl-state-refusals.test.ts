import { describe, expect, it } from 'vitest';
import { compile as compileTs } from '../compiler/ts/compile.js';
import { packModule } from '../compiler/ts/pack.js';
import { fakeGl } from '../rhi/webgl2-fake-gl.js';
import { GlRuntimeImpl } from './gl.js';
import { createRuntime } from './runtime.js';

const DRAW = `"use typeshade";
interface VsIn { pos: location<0, vec2>; }
interface VsOut { p: builtin<"position">; }
interface Color { c: location<0, vec4>; }
class Tint { c: vec4; }
declare const tint: uniform<Tint>;
@vertex export function vs(v: VsIn): VsOut { return { p: vec4(v.pos, 0., 1.) }; }
@fragment export function fs(v: VsOut): Color { return { c: tint.c }; }
`;

const manifest = () => {
  const r = compileTs(DRAW);
  if (r.diagnostics.some((d) => d.category === 'error')) throw new Error('does not compile');
  return packModule(r.module, { console: false });
};

const target = (blend: object) => [{ format: 'rgba8unorm', blend }];

async function refusal(
  options: Record<string, unknown>,
): Promise<{ message: string; calls: string[] }> {
  const { gl, calls } = fakeGl();
  const rt = await createRuntime({ device: gl });
  try {
    const program = rt.load(manifest());
    calls.length = 0;
    const result = await program.render({ vertex: 'vs', fragment: 'fs', ...options }).then(
      () => 'no refusal',
      (e: unknown) => (e instanceof TypeError ? e.message : `not a TypeError: ${String(e)}`),
    );
    return { message: result, calls };
  } finally {
    rt.destroy();
  }
}

describe('the WebGL2 runtime refuses a state the backend has no name for before it asks for the pipeline', () => {
  const asked = (calls: readonly string[]): boolean =>
    calls.some((c) => /^(createShader|createProgram|linkProgram|createVertexArray)\(/.test(c));

  it('refuses a topology that WebGPU has no name for', async () => {
    const { message, calls } = await refusal({ primitive: { topology: 'line-loop' } });
    expect(message).toContain(
      '"line-loop" is not a topology; WebGPU\'s are triangle-list, triangle-strip, line-list, line-strip, point-list.',
    );
    expect(asked(calls)).toBe(false);
  });

  it.each([
    ['color', 'srcFactor'],
    ['color', 'dstFactor'],
    ['alpha', 'srcFactor'],
    ['alpha', 'dstFactor'],
  ])('refuses an unknown blend factor in %s.%s', async (part, field) => {
    const { message, calls } = await refusal({
      targets: target({ [part]: { [field]: 'half' } }),
    });
    expect(message).toContain('"half" is not a blend factor.');
    expect(asked(calls)).toBe(false);
  });

  it.each(['color', 'alpha'])('refuses an unknown blend operation in %s', async (part) => {
    const { message, calls } = await refusal({
      targets: target({ [part]: { operation: 'multiply' } }),
    });
    expect(message).toContain('"multiply" is not a blend operation.');
    expect(asked(calls)).toBe(false);
  });

  it('draws a state it has a name for', async () => {
    const { message } = await refusal({
      primitive: { topology: 'line-strip' },
      targets: target({ color: { srcFactor: 'src-alpha', operation: 'max' } }),
    });
    expect(message).toBe('no refusal');
  });
});

describe('the WebGL2 runtime destroys the device of its context only for a context it made', () => {
  const lose = () => {
    const lost: string[] = [];
    const fake = fakeGl({
      extensions: { WEBGL_lose_context: { loseContext: () => lost.push('lost') } },
    });
    return { ...fake, lost };
  };

  it('does not lose a context the host gave', () => {
    const { gl, lost } = lose();
    new GlRuntimeImpl(gl, false).destroy();
    expect(lost).toEqual([]);
  });

  it('loses a context the runtime made', () => {
    const { gl, lost } = lose();
    new GlRuntimeImpl(gl, true).destroy();
    expect(lost).toEqual(['lost']);
  });
});
