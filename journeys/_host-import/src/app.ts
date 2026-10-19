// Ordinary TypeScript under the project's own tsconfig (lib es2022 and dom): it imports the
// shader module and calls what it exports. `tsc` reads the host view `tshc sync` wrote for
// the import; Vite reads the module the plugin generates. Run as a bundle, it prints what each
// call returned, which the journey compares with `reference.mjs`.
import { EPS, height, normal, ridged } from './terrain.shade.ts';
import { relief } from './relief.shade.ts';
import { jitter } from './jitter.shade.ts';
// The host face of a common module (change 0072): a kernel function and the host generator, from
// the same specifier a shader file imports the device face by.
import { fillUniform, generator } from 'typeshade/random';

const k = [1, 0.5, 2, 0.25] as const;
const points: [number, number][] = [
  [0, 0],
  [0.5, 0.5],
  [1.25, -3.5],
  [10, 7.75],
];

const heights: number[] = points.map((p) => height(p, k));
const normals: [number, number, number][] = points.map((p) => normal(p, k));
// `ridged` reaches a function of another shader file, which the host never imports itself.
const ridges: number[] = points.map((p) => ridged(p, k));
// `relief` reaches the functions of a package npm installed, imported by its name (change 0024).
const reliefs: number[] = points.map((p) => relief(p, k));
// `jitter` reaches `typeshade/random`'s device face through the import; `fillUniform` is the
// module's own kernel function, run on the CPU tier here (no WebGPU in Node), and `generator`
// gives the same numbers on the host.
const jitters: number[] = [0, 1, 2, 3].map((i) => jitter(12345, i));
const draws = new Float32Array(8);
await fillUniform(draws, 12345);
const uniforms: number[] = Array.from(draws);
const next = generator(12345);
const generated: number[] = Array.from({ length: 8 }, () => next());

console.log(
  JSON.stringify({ eps: EPS, heights, normals, ridges, reliefs, jitters, uniforms, generated }),
);
