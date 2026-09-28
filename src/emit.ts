// === `typeshade/emit`: the load-time emitter (change 0025, section 5, Rule 11.11) ===
//
// Some choices can only be made where a program runs: a host turns the console on for one
// session of a deployed build. Each needs the shader text emitted again, and the IR and the
// backends are enough for that. `repack` builds a program's manifest again from the portable IR
// the manifest carries (`ir: true`), with no TypeScript front end. The program runtime takes it
// as a plug-in, `createRuntime({ emit: repack })`, and never imports it itself, so an
// application that emits nothing at load time ships none of it. `scripts/bundle-boundary.ts`
// holds, in CI, that its module closure reaches no file of the front end and no package, and
// its size.

import { buildManifest } from './core/manifest.js';
import type { Pack, PackOptions } from './core/manifest-types.js';
import { fromPortableIr } from './core/ir/portable.js';

export type { Pack, PackOptions } from './core/manifest-types.js';

/**
 * Build a compiled program's manifest again, with other options, where the program loads.
 * `repack(packModule(m, { ir: true }), options)` is `packModule(m, options)`, byte for byte. It
 * reads the portable IR the manifest carries, which a build adds on request
 * (`packModule(m, { ir: true })` or `typeshade({ ir: true })`), and needs no TypeScript.
 *
 * The program runtime takes it as its emitter: with it, `rt.load(program, { console: true })`
 * records the `console.*` calls of a program whose build did not.
 *
 * Exported from `typeshade/emit`.
 *
 * @param manifest - a manifest that carries its IR.
 * @param options - what the new manifest adds: `console`, the recorded variant, and `ir`.
 * @returns the manifest.
 * @throws `TypeError` when the manifest carries no IR, and `Error` when another version of the
 *   package wrote it, naming both versions: the IR is not a stable format, and only the version
 *   that wrote it reads it.
 *
 * @example
 * ```ts
 * import { createRuntime } from 'typeshade/runtime';
 * import { repack } from 'typeshade/emit';
 * import brick from './brick.shade.ts'; // built with typeshade({ ir: true })
 *
 * const rt = await createRuntime({ emit: repack });
 * const program = rt.load(brick, { console: true }); // records, although the build did not
 * ```
 */
export function repack(manifest: Pack, options: PackOptions = {}): Pack {
  if (manifest.ir === undefined)
    throw new TypeError(
      'repack() builds a manifest again from the IR it carries, and this one carries none. Build it with packModule(m, { ir: true }) or typeshade({ ir: true }).',
    );
  return buildManifest(fromPortableIr(manifest.ir), options);
}
