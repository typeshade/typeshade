import { describe, expect, it, vi } from 'vitest';
import { compile } from '../compiler/ts/compile.js';
import { packModule } from '../compiler/ts/pack.js';
import { residentState } from '../core/resident.js';
import { fakeGl } from '../rhi/webgl2-fake-gl.js';
import { array } from '../runtime.js';
import { GlRuntimeImpl } from './gl.js';
import type { RenderPipeline } from './program.js';

const SOURCE = `"use typeshade";
interface VsOut { p: builtin<"position">; }
interface Color { c: location<0, vec4>; }
declare const ids: storage<array<u32>>;
@vertex export function vs(vi: builtin<"vertex_index">): VsOut { return { p: vec4(f32(ids[vi]), 0., 0., 1.) }; }
@fragment export function fs(v: VsOut): Color { return { c: vec4(1., 0., 0., 1.) }; }
`;

const setup = async () => {
  const r = compile(SOURCE);
  expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  const rt = new GlRuntimeImpl(fakeGl().gl, false);
  const pipeline = (await rt
    .load(packModule(r.module, { console: false }))
    .render({ vertex: 'vs', fragment: 'fs' })) as RenderPipeline;
  const target = rt.texture({ size: [1, 1], format: 'rgba8unorm' });
  const ids = array(new Uint32Array(3));
  const uploaded = vi.spyOn(rt.drawing, 'uploaded');
  const encoders = vi.spyOn(rt.rhi, 'createCommandEncoder');
  const draw = (pass: { draw: (...a: never[]) => void }) =>
    (pass.draw as (...a: unknown[]) => void)(pipeline, { ids }, { count: 3 });
  return { rt, target, uploaded, encoders, draw, ids };
};

describe('a program of a WebGL2 runtime uploads through the one GlDrawing of the runtime', () => {
  it('in a pass of rt.runPass', async () => {
    const { rt, target, uploaded, draw } = await setup();
    await rt.runPass({ color: [target] }, draw);
    expect(uploaded).toHaveBeenCalledTimes(1);
  });

  it('once for a Resident drawn in a pass of the runtime and in a pass of a frame', async () => {
    const { rt, target, uploaded, draw, ids } = await setup();
    await rt.runPass({ color: [target] }, draw);
    const frame = rt.frame();
    frame.pass({ color: [target] }, draw);
    await frame.submit();
    expect(uploaded).toHaveBeenCalledTimes(2);
    expect(rt.drawing.uploads.get(residentState(ids)!)?.size).toBe(1);
  });
});

describe('a frame of a WebGL2 runtime runs on the device of the drawing of the runtime', () => {
  it('in rt.frame()', async () => {
    const { rt, target, encoders, draw } = await setup();
    const frame = rt.frame();
    frame.pass({ color: [target] }, draw);
    await frame.submit();
    expect(encoders).toHaveBeenCalledTimes(1);
  });

  it('in rt.runFrame', async () => {
    const { rt, target, encoders, draw } = await setup();
    await rt.runFrame((f) => f.pass({ color: [target] }, draw));
    expect(encoders).toHaveBeenCalledTimes(1);
  });
});
