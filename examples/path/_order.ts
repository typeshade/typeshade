// ═══ The learning path's reading order (change 0145, amendment A2) ═══
//
// The ids of the steps, in the order a reader meets them. A directory scan finds the steps and
// cannot know their order. Each step's `part`, `step`, tiers and text are in its `example.json`.
// `_registry.ts` reads this list, and fails when it and the directories under `examples/path/`
// disagree. `examples/path-examples.test.ts` checks that `step` rises along the list.
//
// A step uses only the concepts of the steps before it, so the order is the reader's progress,
// not the editor's taste. Steps 9 to 11 and 16 are written by a later milestone of change 0145,
// so a step number is the proposal's and the list has gaps.

export const PATH_ORDER: readonly string[] = [
  'first-color',
  'uv-gradient',
  'moving-wave',
  'sdf-shapes',
  'tile-pattern',
  'fractal',
  'palette',
  'bouncing-balls',
  'double-array',
  'image-blur',
  'parallel-sum',
  'histogram',
  'ray-tracer',
];
