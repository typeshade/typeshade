// ═══ The tiers a call may run on: one list (Rule 11.8; AGENTS.md "One authority") ═══
//
// The call layer (`resident.ts`, `configure({ prefer })`) and the compute runner
// (`compute/runner.ts`, `prefer`) each try the same tiers in the same default order. Both read
// this list, so a tier is added or renamed in one place and the two cannot disagree. Like the
// rest of `typeshade/runtime` it imports nothing.

/** The tiers, most capable first. This is the default `prefer` order of the call layer and
 *  of the compute runner, and the one place a tier's name is written. */
export const TIERS = ['webgpu', 'webgl2', 'cpu'] as const;

/** A tier a kernel call, an entry call or a portable kernel may run on (Rule 11.8): one of
 *  {@link TIERS}. `ComputeBackend` in `compute/runner.ts` is the same union under the name the
 *  runner's API has always exported; both are derived from the list. */
export type Tier = (typeof TIERS)[number];

/** The tiers spelled for a refusal: "webgpu, webgl2 and cpu". */
export function tierNames(): string {
  return `${TIERS.slice(0, -1).join(', ')} and ${TIERS[TIERS.length - 1]}`;
}
