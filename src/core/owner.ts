// ═══ The owner of a kernel call: whose device it runs on, and whose arrays it may take ═══
// ═══ (Rule 11.8, Rule 11.13, change 0071)                                               ═══
//
// Before change 0071 every call ran on one process-global configuration: the tier order of
// `configure({ prefer })`, the device of `configure({ runtime })` or the one the call layer
// requests, and a `Resident` that no object owned. A library built on the call layer wrote an
// owner over that state, and two libraries could not share a page. Change 0071 names the owner:
// a `Device` of `typeshade/runtime` (`src/runtime/device.ts`) is one, and the process-global
// configuration is the **default owner**, which `configure()` and `array()` describe as
// before. An ordinary call selects the unique owner of its resources (change 0085). A kernel call
// or an entry call with no owned resource runs on the device in use, or on the default owner when
// none is in use (change 0138, R3, `callDefault`); a draw with no owned resource and a `fuse()`
// scope of `typeshade/fuse` use the default owner (deviation D-h of change 0138).
//
// A call carries its owner: a `fuse` scope records the owner it was opened for, and the plan's
// calls take their tiers and their device from it (`core/fuse-plan.ts`, `core/host-kernel.ts`,
// `core/host-compute.ts`). A `Buffer` belongs to one owner for its whole life: the device that
// made it (`device.array()`), or the default owner (`array()`). A call takes the arrays of its
// own owner only, since a buffer lives on one device; the refusal names both owners.
//
// Like the rest of `typeshade/runtime` it imports no compiler.

import { gpuDevice, type GpuDevice, type Layout } from './host-entry.js';
import type { Fp64Flavor } from './passes/fp64-lower.js';
import {
  configuredFp64Flavor,
  preferredTiers,
  residentState,
  type ResidentArrayState,
  type ZeroedState,
} from './resident.js';
import type { Tier } from './tiers.js';
import { subgroupObservationOf } from './subgroup-probe.js';

/** Whose device a call runs on, and whose arrays it may take. */
export interface CallOwner {
  /** How the owner is named in a refusal: "the default owner", "Device #2". */
  readonly label: string;
  /** The tiers a call of this owner tries, in order (Rule 11.8). */
  tiers(): readonly Tier[];
  /** The owner's WebGPU device, or null where it has none. */
  device(): Promise<GpuDevice | null>;
  /** The flavor of the emulated double a call of this owner runs (change 0073): the WGSL it
   *  dispatches for a module that emulates `f64`, and the IR a plan of this owner fuses.
   *  `native` is the actual GPU executing the call, used by the default owner's auto policy. */
  fp64Flavor(native?: object): Fp64Flavor;
  /** Whether a kernel call of this owner dispatches the subgroup variant of a face that has one
   *  (change 0119): on a device that has the `subgroups` feature and passed the subgroup probe
   *  when it opened. An owner without the method runs the tree. */
  subgroupFolds?(native?: object): boolean;
  /** Told which text a kernel call of this owner dispatched (change 0119), by the function's
   *  name, so that the owner's statistics can name it. */
  dispatched?(kernel: string, variant: 'tree' | 'subgroup'): void;
  /** Refuse a new ordinary call after disposal starts. Captured calls already in the queue remain valid. */
  assertCall?(): void;
  /** Lend a compatible pooled buffer to a scratch array at its first device use. This runs
   *  inside the captured plan, not as another item of the call queue. */
  scratchBuffer?(state: ZeroedState, device: GpuDevice, layout: Layout): void;
  /** Return a scratch lease after its plan. False means the owner holds no such lease. */
  releaseScratch?(state: ZeroedState): boolean;
  /** The handle of a `Buffer` that a kernel called on a resource gives as its result (change
   *  0138, Amendment A10, Q-C): the owner keeps it as one of its arrays. An owner without the
   *  method gives the plain handle. */
  result?(state: ResidentArrayState): object;
}

/** The process-global configuration as an owner: `configure({ prefer })`'s tiers, the device
 *  `configure({ runtime })` names or the call layer requests, and `configure({ fp64Flavor })`'s
 *  flavor. A call with no owned resource uses it when no device is in use (a draw always), and
 *  so does a `fuse()` scope opened by `fuse` from `typeshade/fuse`. */
export const defaultOwner: CallOwner = Object.freeze({
  label: 'the default owner (array())',
  tiers: () => preferredTiers(),
  device: () => gpuDevice(),
  fp64Flavor: (native?: object) => configuredFp64Flavor(native),
  // The probe ran on the default device when it opened (`gpuDevice()`, change 0119).
  subgroupFolds: (native?: object) => native != null && subgroupObservationOf(native) !== null,
});

/** The owner of each texture a device made (`device.texture()`, change 0077). A texture is on
 *  one device, as a buffer is, so a call takes the textures of its own owner only. A texture
 *  that is not in it (a program runtime's, or a host's image) has no owner of its own. */
export const textureOwners = new WeakMap<object, CallOwner>();

/** The owner of a handle's state: the device that made it, or the default owner. */
export function ownerOf(s: ResidentArrayState): CallOwner {
  return s.ownedBy ?? defaultOwner;
}

/** The owner of a `Buffer` or a device-created texture. Plain values select no owner. */
export function resourceOwner(value: unknown, at?: string): CallOwner | undefined {
  const state = residentState(value);
  if (state?.destroyed === true)
    throw new TypeError(
      `${at === undefined ? 'This Buffer' : `${at}: this Buffer`} was disposed; make a new one with array().`,
    );
  return state === undefined ? textureOwners.get(value as object) : ownerOf(state);
}

/** The owner of the device in use (change 0138, R3): the innermost `using _ = device.use()`, or
 *  undefined when none is in use. `runtime/device.ts` installs it when it loads; the call layer
 *  imports no device, so `typeshade/fuse` reaches no program runtime (Rule 11.11). */
export const ownerInUse: { of(): CallOwner | undefined } = { of: () => undefined };

/** The owner a call with no owned resource runs on (change 0138, R3): the device in use, or the
 *  default owner when none is in use. */
export function callDefault(): CallOwner {
  return ownerInUse.of() ?? defaultOwner;
}

/** Choose the unique resource owner (0085), or verify an owner captured at the call site.
 * An explicit default-owned `Buffer` participates just as a device-owned resource does. With no
 * owned resource the call takes `fallback`: the default owner, or for a kernel call and an entry
 * call the device in use ({@link callDefault}, change 0138, R3). */
export function inferOwner(
  at: string,
  resources: Iterable<readonly [string, CallOwner | undefined]>,
  expected?: CallOwner,
  fallback: CallOwner = defaultOwner,
): CallOwner {
  let selected = expected;
  let first = 'this call';
  for (const [name, owner] of resources) {
    if (owner === undefined) continue;
    if (selected === undefined) {
      selected = owner;
      first = name;
    } else if (selected !== owner) {
      throw new TypeError(
        `${at}: ${name} belongs to ${owner.label}, while ${first} belongs to ${selected.label}. A call takes resources from one owner.`,
      );
    }
  }
  const owner = selected ?? fallback;
  if (expected === undefined) owner.assertCall?.();
  return owner;
}

/**
 * The refusal of a call of `owner` that takes a `Buffer` of another owner, or undefined when
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
    `${at} is a Buffer of ${theirs.label}, and a call of ${owner.label} takes the arrays of ${owner.label} only. ${
      owner === defaultOwner
        ? 'Make the call inside that device’s fuse(), or make the array with array().'
        : 'Make the array with device.array(), or make the call outside device.fuse().'
    }`,
  );
}
