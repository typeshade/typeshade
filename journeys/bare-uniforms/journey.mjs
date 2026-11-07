import { uniforms, valueOf, expectedOf } from './values.mjs';

export default {
  title: 'Bare uniforms keep scalar, vector and matrix host values on WebGL2',
  runs: uniforms.flatMap((spec) =>
    (spec.kind === 'double' ? ['float', 'integer'] : ['float']).flatMap((flavor) =>
      [false, true].map((changed) => ({
        kind: 'render',
        shader: `${spec.name}.shade.ts`,
        vertex: 'vs',
        fragment: 'fs',
        size: [2, 2],
        ...(flavor === 'integer' ? { emit: { fp64Flavor: flavor } } : {}),
        bindings: { [spec.name + 'Value']: valueOf(spec, changed) },
        fragmentArgs: () => [],
        fragmentColor: (color) => color,
        expected: () => expectedOf(spec, changed),
        tolerance: 1.5 / 255,
        webgl2Must: true,
      })),
    ),
  ),
};
