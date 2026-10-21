// ═══ The host examples' curated order, and the tiers each runs on (change 0061) ═══
//
// The hand-written half of `hostExamples`, as `_order.ts` is of `examples`: a directory scan
// finds the host examples, and cannot know that a reader meets the draw first and the program
// runtime last, or which tiers a host runs on. `_registry.ts` reads this list, and fails when it
// and the directories under `examples/hosts/` disagree.
//
// The order goes from the shortest host to the engine's: a draw, a dispatch, a kernel call, a
// chain kept on the device, a helper called on the CPU, the program runtime, a chain of kernel
// calls fused into one dispatch, and a Set and a Map the kernel functions collect into.
//
// The tiers are checked, not believed: a host lists a tier exactly when its whole `run()` gives
// the reference with that tier alone. `bun run gate:journeys` runs every host on WebGPU and on
// WebGL2, and `examples/host-examples.test.ts` on the CPU tier; each fails on a listed tier that
// does not pass and on an unlisted tier that does.

/** Every host example id, in the order a reader meets them, with the tiers its host runs on. */
export const HOST_ORDER: readonly {
  readonly id: string;
  readonly tiers: readonly ('webgpu' | 'webgl2' | 'cpu')[];
}[] = [
  { id: 'host-draw', tiers: ['webgpu', 'webgl2', 'cpu'] },
  { id: 'host-compute', tiers: ['webgpu', 'webgl2', 'cpu'] },
  // Not WebGL2: `peak` reduces, and WebGL2 has no workgroup memory for a reduction, so with
  // WebGL2 alone the call is refused ("loop 1 reduces, which WebGL2 has no workgroup memory
  // for"). Where WebGPU is absent, `exposure` runs on WebGL2 and `peak` on the CPU tier.
  { id: 'host-kernel', tiers: ['webgpu', 'cpu'] },
  // Not WebGL2, for the same reason: `sum` reduces.
  { id: 'host-resident', tiers: ['webgpu', 'cpu'] },
  { id: 'host-helper', tiers: ['webgpu', 'webgl2', 'cpu'] },
  // The program runtime runs on WebGPU and WebGL2; the CPU tier is the call layer's (surface §69).
  { id: 'host-program', tiers: ['webgpu', 'webgl2'] },
  // Fuses on WebGPU alone; on the CPU tier each call runs on its own, with the same result
  // (change 0058). Not WebGL2, for the reason `host-kernel` gives: the third scope ends in
  // `total`, which reduces, and with WebGL2 alone that call is refused.
  { id: 'loop-fuse', tiers: ['webgpu', 'cpu'] },
  // Not WebGL2: it has no atomics, and runs no kernel function that takes a Map or a Set
  // (change 0080).
  { id: 'host-set-unique', tiers: ['webgpu', 'cpu'] },
];
