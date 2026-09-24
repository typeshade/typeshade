// Ordinary TypeScript under the project's own tsconfig (lib es2022 and dom): it imports the
// shader module and calls what it exports. `tsc` reads the host view `typeshade sync` wrote for
// the import; Vite reads the module the plugin generates. Run as a bundle, it prints what each
// call returned, which the journey compares with `reference.mjs`.
import { EPS, height, normal } from './terrain.shade.ts';

const k = [1, 0.5, 2, 0.25] as const;
const points: [number, number][] = [
  [0, 0],
  [0.5, 0.5],
  [1.25, -3.5],
  [10, 7.75],
];

const heights: number[] = points.map((p) => height(p, k));
const normals: [number, number, number][] = points.map((p) => normal(p, k));

console.log(JSON.stringify({ eps: EPS, heights, normals }));
