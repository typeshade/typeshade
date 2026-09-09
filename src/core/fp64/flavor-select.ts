// ═══ Shader DSL — df64 flavor recommendation (device → 'float' | 'integer') ═══
//
// The integer df64 flavor (df64-int.ts) exists because Apple's Metal shader
// compiler reassociates the float EFT error terms at ANY large-magnitude
// cancellation — proven on-device (probe history, PR #924–#932): every float
// barrier collapses on Apple while the integer lowering passes 9/9. Elsewhere
// the guarded float flavor is correct on the real chains and cheaper, so:
//
//   Apple GPU (Metal underneath — WebGPU or WebGL2-via-ANGLE-Metal) → 'integer'
//   everything else                                                 → 'float'
//
// ANGLE-D3D11 note: FXC also folds deep SYNTHETIC df64 composition trees, but
// the production chains hold under the float flavor's renorm there, and FXC's
// compile cost on the fully-inlined integer bodies can TDR — so D3D11 stays
// 'float' deliberately (documented residual risk on adversarial deep trees).
//
// The DSL cannot see a GPU — it is a standalone library. Consumers collect the
// signals (a WebGPU adapter's `info`, a WebGL2 UNMASKED_RENDERER string, a
// user-agent) with whatever they have and pass them here; any single Apple
// signal selects the integer flavor. All signals optional — no signals means
// 'float' (the default, byte-identical lowering).

import type { Fp64Flavor } from '../passes/fp64-lower.js'

/** The device-identification signals {@link recommendFp64Flavor} and {@link isAppleGpu}
 *  read to pick the df64 flavour a device needs: `'integer'` on Apple GPUs, where Metal
 *  runs underneath, and `'float'` everywhere else (see `Fp64Flavor` for why Apple's shader
 *  compiler forces that split). The library cannot see a GPU itself, so the caller collects
 *  whatever it has, a WebGPU adapter's `info`, a WebGL2 `UNMASKED_RENDERER_WEBGL` string,
 *  `navigator.userAgent`, and passes it here. Every field is optional, and any single
 *  Apple-identifying signal is enough to select `'integer'`. Passing none of them selects
 *  `'float'`, so an Apple device whose signals were never collected silently gets the wrong
 *  flavour: df64 still compiles and runs, but its extended precision collapses to plain f32
 *  once the shader compiler reassociates the error terms the float flavour depends on.
 *
 *  Exported from `@xgis/shader-dsl`.
 */
export interface Fp64FlavorSignals {
  /** `GPUAdapter.info` (or any {vendor, architecture} shaped object). Apple
   *  reports vendor 'apple' (architecture like 'apple' / 'metal-3'). */
  readonly adapterInfo?: { readonly vendor?: string; readonly architecture?: string } | null
  /** The WebGL `UNMASKED_RENDERER_WEBGL` (or RENDERER) string. Apple devices
   *  read like 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified
   *  Version)' or 'Apple GPU'. */
  readonly rendererString?: string | null
  /** `navigator.userAgent`, the fallback when the GPU strings are masked
   *  (iOS Safari always runs Metal underneath). */
  readonly userAgent?: string | null
}

/** True when any signal identifies an Apple GPU / Metal-backed context. */
export function isAppleGpu(s: Fp64FlavorSignals): boolean {
  const vendor = s.adapterInfo?.vendor ?? ''
  const arch = s.adapterInfo?.architecture ?? ''
  if (/apple/i.test(vendor) || /^apple|metal/i.test(arch)) return true
  const r = s.rendererString ?? ''
  if (/apple|metal/i.test(r)) return true
  const ua = s.userAgent ?? ''
  // Any WebKit-on-Apple UA (iPhone/iPad/Mac) — Metal is the only GPU API there.
  if (/\b(iPhone|iPad|Macintosh)\b/.test(ua) && /AppleWebKit/.test(ua)) return true
  return false
}

/** Pick the df64 flavour a device needs for correct results, from whatever identifying
 *  signals a host has. Pass the result as `EmitOptions.fp64Flavor`.
 *
 *  The flavour differs by device because of one operation. The df64 multiply relies on error
 *  terms that are algebraically zero, and a compiler allowed to reassociate can cancel them.
 *  On Apple GPUs, where Metal runs underneath whether the path is WebGPU or WebGL2 through
 *  ANGLE, the shader compiler defaults to fast math and collapses that multiply at any
 *  large-magnitude cancellation, and no in-shader barrier prevents it. `sin` and `cos` are
 *  built on that multiply, so they inherit the same fragility there. An Apple signal therefore
 *  selects `'integer'`, which does the same arithmetic through integer primitives fast math
 *  cannot touch, and every other device gets `'float'`, which is correct on those devices and
 *  cheaper.
 *
 *  D3D11 through ANGLE gets `'float'` as well. Its compiler can fold very deep synthetic df64
 *  expression trees, but the float flavour's renormalisation holds on the chains that occur in
 *  practice, and compiling the fully inlined integer bodies there is expensive enough to reset
 *  the device.
 *
 *  The library cannot see a GPU, so the signals come from the caller: a WebGPU adapter's
 *  `info`, a WebGL2 `UNMASKED_RENDERER_WEBGL` string, a user agent. All are optional, any
 *  single Apple signal selects `'integer'`, and passing none returns `'float'`.
 *
 *  Exported from `@xgis/shader-dsl`.
 *
 *  @param s - the device signals the host was able to collect.
 *  @returns `'integer'` on an Apple or Metal-backed context, `'float'` everywhere else.
 *
 *  @example
 *  ```ts
 *  import { recommendFp64Flavor, emitModule } from '@xgis/shader-dsl'
 *
 *  const fp64Flavor = recommendFp64Flavor({ adapterInfo: adapter.info, userAgent: navigator.userAgent })
 *  const wgsl = emitModule(MODULE, { fp64Flavor })
 *  ```
 *
 *  @see {@link isAppleGpu} for the predicate behind it.
 *  @see {@link f64T} for the emulation this configures.
 */
export function recommendFp64Flavor(s: Fp64FlavorSignals): Fp64Flavor {
  return isAppleGpu(s) ? 'integer' : 'float'
}
