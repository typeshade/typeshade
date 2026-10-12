// ═══ The host examples' curated order, and the tiers each runs on (change 0061) ═══
//
// The hand-written half of `hostExamples`, as `_order.ts` is of `examples`: a directory scan
// finds the host examples, and cannot know that a reader meets the draw first and the program
// runtime last, or which tiers a host runs on. `_registry.ts` reads this list, and fails when it
// and the directories under `examples/hosts/` disagree.
//
// The order goes from the shortest host to the engine's: a draw, a dispatch, a kernel call, a
// chain kept on the device, a helper called on the CPU, and the program runtime.

/** Every host example id, in the order a reader meets them, with the tiers its host runs on. */
export const HOST_ORDER: readonly {
  readonly id: string;
  readonly tiers: readonly ('webgpu' | 'webgl2' | 'cpu')[];
}[] = [
  { id: 'host-draw', tiers: ['webgpu', 'webgl2', 'cpu'] },
  { id: 'host-compute', tiers: ['webgpu', 'webgl2', 'cpu'] },
  { id: 'host-kernel', tiers: ['webgpu', 'webgl2', 'cpu'] },
  { id: 'host-resident', tiers: ['webgpu', 'webgl2', 'cpu'] },
  { id: 'host-helper', tiers: ['webgpu', 'webgl2', 'cpu'] },
  // The program runtime runs on WebGPU and WebGL2; the CPU tier is the call layer's (surface §69).
  { id: 'host-program', tiers: ['webgpu', 'webgl2'] },
];
