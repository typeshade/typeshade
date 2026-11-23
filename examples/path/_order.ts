// ═══ The learning path's order, and the tiers each step runs on (change 0145) ═══
//
// The hand-written half of `pathExamples`, as `hosts/_order.ts` is of `hostExamples`: a directory
// scan finds the steps, and cannot know their order or which tiers a host runs on.
// `_registry.ts` reads this list, and fails when it and the directories under `examples/path/`
// disagree.
//
// A step uses only the concepts of the steps before it, so the order is the reader's progress,
// not the editor's taste. The tiers are checked, not believed: a step lists a tier exactly when
// its whole `run()` gives the reference with that tier alone (`examples/path-examples.test.ts`
// on the CPU tier).

/** The tiers a step's host can run on. */
export type PathTier = 'webgpu' | 'webgl2' | 'cpu';

/** Every step of the path built so far, in order, with its part and the tiers its host runs on.
 *  Part 1 is steps 1 to 4, part 2 steps 5 to 8, part 4 steps 12 to 15, and step 17 is part 5.
 *  Steps 9 to 11 and 16 are written by a later milestone of change 0145, so a step number is the
 *  proposal's and the list has gaps. */
export const PATH_ORDER: readonly {
  readonly id: string;
  readonly step: number;
  readonly part: string;
  readonly tiers: readonly PathTier[];
}[] = [
  { id: 'first-color', step: 1, part: 'First pixels', tiers: ['webgpu', 'webgl2', 'cpu'] },
  { id: 'uv-gradient', step: 2, part: 'First pixels', tiers: ['webgpu', 'webgl2', 'cpu'] },
  { id: 'moving-wave', step: 3, part: 'First pixels', tiers: ['webgpu', 'webgl2', 'cpu'] },
  { id: 'sdf-shapes', step: 4, part: 'First pixels', tiers: ['webgpu', 'webgl2', 'cpu'] },
  { id: 'tile-pattern', step: 5, part: 'The language', tiers: ['webgpu', 'webgl2', 'cpu'] },
  { id: 'fractal', step: 6, part: 'The language', tiers: ['webgpu', 'webgl2', 'cpu'] },
  { id: 'palette', step: 7, part: 'The language', tiers: ['webgpu', 'webgl2', 'cpu'] },
  { id: 'bouncing-balls', step: 8, part: 'The language', tiers: ['webgpu', 'webgl2', 'cpu'] },
  { id: 'double-array', step: 12, part: 'GPU compute', tiers: ['webgpu', 'webgl2', 'cpu'] },
  { id: 'image-blur', step: 13, part: 'GPU compute', tiers: ['webgpu', 'webgl2', 'cpu'] },
  // A barrier needs a GPU tier: with the CPU tier alone the call is refused (Rule 8.24), and
  // WebGL2 has no workgroup memory.
  { id: 'parallel-sum', step: 14, part: 'GPU compute', tiers: ['webgpu'] },
  // Not WebGL2: it has no atomics (change 0080).
  { id: 'histogram', step: 15, part: 'GPU compute', tiers: ['webgpu', 'cpu'] },
  { id: 'ray-tracer', step: 17, part: 'Putting it together', tiers: ['webgpu', 'webgl2', 'cpu'] },
];
