// ═══ The derived capabilities — the one list `enables` cannot name ═══
//
// PRIVATE: not re-exported by the IR barrel (`core/ir/index.ts`), so it widens no public
// surface. It is the single source of truth for which capabilities a module's own shape
// derives. `DeclarableCapability` (nodes.ts) is `Capability` minus this list's members, and
// `capabilityMatrix` (backend.ts) reads the same list at runtime for its `declarable` column,
// so the type an author meets in `enables` and the table a doc renders cannot disagree.
// Appending a derived id here removes it from `enables` and flips its matrix row together.

import type { Capability } from './nodes.js'

/** The capabilities `requiredCaps` derives from a module's SHAPE, which a module therefore
 *  never names in `enables`. Nine ids, in `ALL_CAPABILITIES` order:
 *
 *  - from a binding's KIND or an entry's stage: `storageBuffer` (a storage binding),
 *    `compute` (a `@compute` entry), `msaaTextureLoad` (a multisampled texture load),
 *    `storageTexture` (a storage-texture binding), `texture1d` and `textureCubeArray` (a 1d
 *    or cube-array texture binding);
 *  - from the CALLS: `textureGather` (a gather call, roadmap 0.4 item 12) and `packed4x8Dot`
 *    (one of the eight packed 4x8 builtins, #152), since a module that does not use one would
 *    be asserting a feature it never reaches;
 *  - from a binding's FORMAT: `bgra8unormStorage` (#147), since a storage texture declared
 *    `bgra8unorm` needs the `bgra8unorm-storage` device feature and nothing else does, so
 *    declaring it would restate the declaration.
 *
 *  The caps derived from a `@builtin(...)` id (`clipDistances`, `primitiveIndex`,
 *  `subgroups`, §50) are deliberately NOT here: each stays declarable, because a module may
 *  hold the directive for a feature it reaches another way, and deriving and declaring fold
 *  into one set. */
export const DERIVED_CAPABILITIES = [
  'storageBuffer',
  'compute',
  'msaaTextureLoad',
  'storageTexture',
  'texture1d',
  'textureCubeArray',
  'textureGather',
  'bgra8unormStorage',
  'packed4x8Dot',
] as const satisfies readonly Capability[]

/** One of the {@link DERIVED_CAPABILITIES}. */
export type DerivedCapability = (typeof DERIVED_CAPABILITIES)[number]
