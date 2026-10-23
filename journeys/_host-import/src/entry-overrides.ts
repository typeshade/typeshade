// The shipped entry-call API, with no program runtime as a shortcut (0084).
import { configure, createDevice, recommendFp64Flavor } from 'typeshade/runtime';
import 'typeshade/fuse';
import { overrideCopy, overrideMark } from './overrides.shade.ts';
import { overrideDouble } from './override-double.shade.ts';

export async function entryOverrides(): Promise<number[]> {
  const src = Float32Array.from({ length: 131 }, (_, i) => i - 65);
  const dst = new Float32Array(src.length);
  const out: number[] = [];
  configure({ prefer: ['webgpu'] });
  try {
    // Direct calls cover tails and changing a default without a Resident or a plan.
    for (const width of [32, 64, 128]) {
      await overrideCopy({ src, dst }, Math.ceil(src.length / width), {
        constants: { WIDTH: width, GAIN: 3 },
      });
      out.push(...dst);
    }
  } finally {
    configure({});
  }
  const dev = await createDevice({ prefer: ['webgpu'] });
  try {
    const input = dev.array(src),
      tmp = dev.array(src.length, 'f32'),
      output = dev.array(src.length, 'f32');
    const counts = dev.array(Uint32Array.of(0, 2, 1, 1));
    const report = await dev.fuse(() => {
      overrideCopy({ src: input, dst: tmp }, 3, { constants: { WIDTH: 64, GAIN: 2 } });
      overrideCopy(
        { src: tmp, dst: output },
        { indirect: counts, offset: 1 },
        { constants: { GAIN: 3, WIDTH: 128 } },
      );
    });
    if (
      report.submissions !== 1 ||
      report.dispatches !== 2 ||
      report.groups.length !== 2 ||
      report.groups[1]?.indirect !== true
    )
      throw new Error(`override calls changed plan accounting: ${JSON.stringify(report)}`);
    if (
      report.groups[0]?.workgroupShapes?.[0]?.[0] !== 64 ||
      report.groups[1]?.workgroupShapes?.[0]?.[0] !== 128
    )
      throw new Error(`override calls reported default shapes: ${JSON.stringify(report)}`);
    out.push(...(await output.read()));
  } finally {
    await dev.dispose();
  }
  // Automatic selection and both explicit flavors run the same reference on real WebGPU (0085).
  for (const flavor of ['auto', 'float', 'integer'] as const) {
    const owner = await createDevice({ prefer: ['webgpu'], fp64Flavor: flavor });
    try {
      const expected =
        flavor === 'auto'
          ? recommendFp64Flavor({
              adapterInfo: {
                vendor: owner.info.webgpu?.vendor ?? undefined,
                architecture: owner.info.webgpu?.architecture ?? undefined,
              },
              userAgent: navigator.userAgent,
            })
          : flavor;
      if (owner.fp64Flavor !== expected)
        throw new Error('fp64 selection disagrees with the actual device');
      const input = owner.array(Float64Array.from(src)),
        output = owner.array(new Float64Array(src.length));
      await owner.fuse(() => {
        overrideDouble({ gain: 2, src: input, dst: output }, 2, { constants: { WIDTH: 128 } });
      });
      out.push(...(await output.read()));
    } finally {
      await owner.dispose();
    }
  }
  configure({ prefer: ['cpu'] });
  try {
    await overrideMark({ src, dst }, 3, { constants: { WIDTH: 64, GAIN: 4 } });
    out.push(...dst);
  } finally {
    configure({});
  }
  configure({ prefer: ['webgl2'] });
  try {
    await overrideCopy({ src, dst }, 5, { constants: { WIDTH: 32, GAIN: 3 } });
    out.push(...dst);
    let refused = false;
    try {
      await overrideCopy({ src, dst }, 3, { constants: { WIDTH: 64 } });
    } catch (err) {
      refused = String(err).includes('WebGL2 supports only the declared default');
    }
    if (!refused) throw new Error('WebGL2 did not refuse a non-default entry-call shape');
  } finally {
    configure({});
  }
  return out;
}
