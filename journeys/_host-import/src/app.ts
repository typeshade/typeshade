// Ordinary TypeScript under the project's own tsconfig (lib es2022 and dom): it imports the
// shader module and calls what it exports. `tsc` reads the host view `tshc sync` wrote for
// the import; Vite reads the module the plugin generates. Run as a bundle, it prints what each
// call returned, which the journey compares with `reference.mjs`.
import { EPS, height, normal, ridged } from './terrain.shade.ts';
import { relief } from './relief.shade.ts';

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

console.log(JSON.stringify({ eps: EPS, heights, normals, ridges, reliefs }));
