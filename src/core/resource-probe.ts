// The probes that name a resource the runtime made, for a refusal of a call with plain data
// (Rule 12.5). `core/resident.ts` and `runtime/resource.ts` add one each, and `toShader` in
// `host-values.ts` reads them. It imports nothing, so no chunk of a bundle moves for it. Not API.

/** A probe: `'Buffer'` or `'Uniform'` for a resource it knows, undefined for any other value. */
export type ResourceProbe = (v: unknown) => 'Buffer' | 'Uniform' | undefined;

export const resourceProbes: ResourceProbe[] = [];
