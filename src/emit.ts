// === `typeshade/emit`: the load-time emitter (change 0025, Rule 11.11) ===
//
// Some choices can only be made where the program runs: a host turns the console on in a
// deployed build for one session. Each needs the shader text emitted again, and the TypeScript
// front end is not needed for that: the IR and the backends are enough. `repack` emits a
// manifest again from the portable IR it carries (`packModule(m, { ir: true })`), under the
// options the manifest records it was packed under (change 0028), and the program runtime takes
// it as a plug-in, `createRuntime({ emit: repack })`, so the runtime never imports it itself. Its
// module closure holds no file of the front end and no `typescript`, which
// `scripts/bundle-boundary.ts` holds in CI with a size budget.

import { buildManifest, type PackOptions } from './core/manifest.js';
import type { Pack } from './core/manifest-types.js';
import { fromPortable } from './core/ir/portable.js';
import { VERSION } from './core/version.js';

/**
 * Emit `manifest` again from the portable IR it carries, with `options`: the same program, its
 * WGSL, GLSL and layouts byte for byte what the build wrote, and the variants the build did not
 * ask for. The IR stays on the result, so it can be emitted again. `options.console` adds the
 * recorded variant, the WGSL that records the `console.*` calls (surface §66).
 *
 * The program is emitted under the options the manifest was packed under, the `emit` it records
 * (`packModule(m, { emit })`, surface §69): its optimization level, its `parens` and its
 * `fp64Flavor`, so its text and its bindings are the ones the build wrote and the variant it adds
 * agrees with them. A manifest packed with emit plugins carries no IR (`packModule` refuses `ir`
 * with a plugin: a plugin is a function, which a manifest cannot record).
 *
 * Exported from `typeshade/emit`.
 *
 * @example
 * ```ts
 * import { createRuntime } from 'typeshade/runtime';
 * import { repack } from 'typeshade/emit';
 *
 * const rt = await createRuntime({ emit: repack });
 * const program = rt.load(manifest, { console: true }); // recorded, though the build did not
 * ```
 *
 * @throws `TypeError` when the manifest carries no IR, and when another package version wrote
 *   it, naming both versions: the IR is not a stable format, and only its own version reads it.
 */
export function repack(manifest: Pack, options: { readonly console?: boolean } = {}): Pack {
  const ir = manifest.ir;
  if (ir === undefined)
    throw new TypeError(
      'repack(): this manifest carries no IR; build it with packModule(m, { ir: true }) or typeshade({ ir: true }).',
    );
  if (ir.version !== VERSION)
    throw new TypeError(
      `repack(): this manifest's IR was written by typeshade ${ir.version}, and this emitter (typeshade ${VERSION}) reads only its own version's IR; build the manifest again with this version.`,
    );
  const pack: PackOptions = {
    ...(options.console === true ? { console: true } : {}),
    ...(manifest.emit !== undefined ? { emit: manifest.emit } : {}),
  };
  return { ...buildManifest(fromPortable(ir), pack), ir };
}
