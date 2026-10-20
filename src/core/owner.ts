// ═══ The owner of a kernel call: whose device it runs on, and whose arrays it may take ═══
// ═══ (Rule 11.8, Rule 11.13, change 0071)                                               ═══
//
// Before change 0071 every call ran on one process-global configuration: the tier order of
// `configure({ prefer })`, the device of `configure({ runtime })` or the one the call layer
// requests, and a `Resident` that no object owned. A library built on the call layer wrote an
// owner over that state, and two libraries could not share a page. Change 0071 names the owner:
// a `Device` of `typeshade/runtime` (`src/runtime/device.ts`) is one, and the process-global
// configuration is the **default owner**, the one a bare call outside any `device.fuse()` body
// uses, which `configure()` and `resident()` describe as before.
//
// A call carries its owner: a `fuse` scope records the owner it was opened for, and the plan's
// calls take their tiers and their device from it (`core/fuse-plan.ts`, `core/host-kernel.ts`,
// `core/host-compute.ts`). A `Resident` belongs to one owner for its whole life: the device that
// made it (`device.array()`), or the default owner (`resident()`). A call takes the arrays of its
// own owner only, since a buffer lives on one device; the refusal names both owners.
//
// Like the rest of `typeshade/runtime` it imports no compiler.

import { gpuDevice, type GpuDevice } from './host-entry.js';
import type { Fp64Flavor } from './passes/fp64-lower.js';
import { configuredFp64Flavor, preferredTiers, type ResidentArrayState } from './resident.js';
import type { Tier } from './tiers.js';

/** Whose device a call runs on, and whose arrays it may take. */
export interface CallOwner {
  /** How the owner is named in a refusal: "the default owner", "Device #2". */
  readonly label: string;
  /** The tiers a call of this owner tries, in order (Rule 11.8). */
  tiers(): readonly Tier[];
  /** The owner's WebGPU device, or null where it has none. */
  device(): Promise<GpuDevice | null>;
  /** The flavor of the emulated double a call of this owner runs (change 0073): the WGSL it
   *  dispatches for a module that emulates `f64`, and the IR a plan of this owner fuses. */
  fp64Flavor(): Fp64Flavor;
}

/** The process-global configuration as an owner: `configure({ prefer })`'s tiers, the device
 *  `configure({ runtime })` names or the call layer requests, and `configure({ fp64Flavor })`'s
 *  flavor. A bare call uses it, and so does a
 *  `fuse()` scope opened by `fuse` from `typeshade/fuse`. */
export const defaultOwner: CallOwner = Object.freeze({
  label: 'the default owner (configure(), resident())',
  tiers: () => preferredTiers(),
  device: () => gpuDevice(),
  fp64Flavor: () => configuredFp64Flavor(),
});

/** The owner of each texture a device made (`device.texture()`, change 0077). A texture is on
 *  one device, as a buffer is, so a call takes the textures of its own owner only. A texture
 *  that is not in it (a program runtime's, or a host's image) has no owner of its own. */
export const textureOwners = new WeakMap<object, CallOwner>();

/** The owner of a handle's state: the device that made it, or the default owner. */
export function ownerOf(s: ResidentArrayState): CallOwner {
  return s.ownedBy ?? defaultOwner;
}

/**
 * The refusal of a call of `owner` that takes a `Resident` of another owner, or undefined when
 * `s` is the owner's. `at` names the call and the parameter or the binding, as a sentence starts:
 * `add(): parameter "out"`.
 */
export function foreignOwner(
  at: string,
  owner: CallOwner,
  s: ResidentArrayState | undefined,
): TypeError | undefined {
  if (s === undefined) return undefined;
  const theirs = ownerOf(s);
  if (theirs === owner) return undefined;
  return new TypeError(
    `${at} is a Resident of ${theirs.label}, and a call of ${owner.label} takes the arrays of ${owner.label} only. ${
      owner === defaultOwner
        ? 'Make the call inside that device’s fuse(), or make the array with resident().'
        : 'Make the array with device.array(), or make the call outside device.fuse().'
    }`,
  );
}
