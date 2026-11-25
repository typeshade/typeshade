import { describe, expect, it } from 'vitest';
import { packModule } from '../compiler/ts/pack.js';
import { webgl2Device } from '../rhi/webgl2.js';
import { GlDrawing, GlRenderPrograms } from './gl-draw.js';
import { graphicsWithBinding, recordingGl } from './testing/gl-names-fixtures.js';

describe('the bind layout names each texture and data entry by the GLSL spelling of its binding', () => {
  const layoutEntries = (
    pack: ReturnType<typeof packModule>,
  ): readonly { label?: string; name?: string }[] => {
    const { gl } = recordingGl();
    const device = webgl2Device(gl);
    const seen: { label?: string; name?: string }[][] = [];
    const create = device.createBindGroupLayout.bind(device);
    device.createBindGroupLayout = (entries) => {
      seen.push([...entries]);
      return create(entries);
    };
    new GlRenderPrograms(new GlDrawing(device), pack).render({ vertex: 'e', fragment: 'fe' });
    return seen.flat();
  };
  const withData = (pack: ReturnType<typeof packModule>) => {
    const fe = pack.gl!.draws!.fe as { data?: string[] };
    return {
      ...pack,
      gl: { ...pack.gl, draws: { ...pack.gl!.draws, fe: { ...fe, data: ['buffer'] } } },
    } as unknown as ReturnType<typeof packModule>;
  };
  const pack = packModule(graphicsWithBinding('buffer'));

  it('uses the GLSL spelling of a texture and of a data binding', () => {
    const entries = layoutEntries(withData(pack));
    const glslOf = (n: string) => pack.bindings.find((b) => b.name === n)!;
    expect(glslOf('texture').emittedGlsl).toBe('texture_');
    expect(entries.find((e) => e.label === 'texture')?.name).toBe('texture_');
    expect(glslOf('buffer').emittedGlsl).toBe('buffer_');
    expect(entries.filter((e) => e.label === 'buffer').map((e) => e.name)).toContain('buffer_');
  });
});
