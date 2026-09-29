// The host half of the emit-options journey: two programs that compute in emulated doubles, each
// packed under several emit options (surface §69) and run on WebGPU through `typeshade/runtime`
// as the manifest it gives says: the WGSL it emits, the bindings it lists, the `_fp64` guard among
// them only where the `'float'` flavor of the emulation binds one. A manifest whose bindings leave
// out a guard its WGSL declares is a pipeline WebGPU refuses ("Binding doesn't exist"); a layout
// may hold a binding its shader never reads, so the guard a manifest lists and its WGSL does not
// declare is held by `src/core/manifest.test.ts`, not here. The reference is plain JavaScript,
// whose numbers are doubles, and the harness holds each result to it and to the CPU oracle's,
// which computes in `f64` itself.

/** Each way the program is packed: the defaults, then each option, then all of them. */
const packs = [
  undefined,
  { fp64Flavor: 'integer' },
  { level: 'O0' },
  { level: 'O1', parens: 'minimal' },
  { level: 'O0', parens: 'minimal', fp64Flavor: 'integer' },
];

// ── the compute entry ─────────────────────────────────────────────────────────────────────────

const N = 100;
// Near 1e7 the f32 grid is 1 wide: the eighth-unit steps and the shift exist only in the double.
const xs = Array.from({ length: N }, (_, i) => 1e7 + i / 8);
const affine = { k: 1 + 2 ** -30, shift: 0.25 };

const axpyRun = (emit) => ({
  kind: 'compute',
  shader: 'doubles.shade.ts',
  entry: 'axpy',
  workgroups: [2, 1, 1],
  bindings: { affine, xs, ys: new Array(128).fill(0) },
  read: 'ys',
  ...(emit !== undefined ? { emit } : {}),
  // The 28 elements past `xs`'s length are left as they were, which is 0.
  expected: () => [...xs.map((x) => x * affine.k + affine.shift), ...new Array(128 - N).fill(0)],
  tolerance: 1e-12,
});

// ── the fragment entry ────────────────────────────────────────────────────────────────────────

const W = 32;
const H = 4;
const zoom = { cx: 12345.6783, scale: 2e-5 };

/** The fraction of `x * 1000` at column `px`: 0.31 at the left and 0.93 at the right, in steps of
 *  0.02 that an `f32` at 12 345 cannot tell apart. */
const stripe = (px) => {
  const v = (zoom.cx + (px + 0.5) * zoom.scale) * 1000;
  return v - Math.floor(v);
};

const deepRun = (emit) => ({
  kind: 'render',
  shader: 'deep.shade.ts',
  vertex: 'vs',
  fragment: 'fs',
  size: [W, H],
  bindings: { zoom },
  ...(emit !== undefined ? { emit } : {}),
  fragmentArgs: (x, y) => [{ pos: [x + 0.5, y + 0.5, 0, 1] }],
  fragmentColor: (result) => result.color,
  expected: (x) => [stripe(x), 0, 0, 1],
  // An rgba8unorm target: one step of 1/255 either way is rounding, not a wrong program.
  tolerance: 1.5 / 255,
});

export default {
  title: 'Programs packed under emit options: the level, the parens and the f64 flavor',
  runs: [...packs.map(axpyRun), ...packs.map(deepRun)],
};
