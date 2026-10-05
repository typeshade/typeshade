import type { ModuleDecl } from '../../core/ir/nodes.js';
import { buildManifest, type Pack, type PackOptions } from '../../core/manifest.js';

export type {
  Pack,
  PackBinding,
  PackConsole,
  PackDataTexture,
  PackEntry,
  PackGlDraw,
  PackIo,
  PackLayout,
  PackLine,
  PackOptions,
  PackOverride,
  PackResource,
} from '../../core/manifest.js';
export { PACK_SCHEMA } from '../../core/manifest.js';

/** The compiled module's manifest (Rule 11.10): everything a host needs to create its
 *  pipelines and bind its resources, in one plain JSON object. See `buildManifest` in
 *  `src/core/manifest.ts`, which builds it from the IR alone, for what each field promises.
 *
 *  `options.console` adds the recorded variant, the WGSL that writes each `console.*` call an
 *  entry reaches into the console buffer, with the table the buffer decodes with.
 *
 *  `options.emit` emits the program under other options than the defaults (change 0028): the WGSL
 *  writer's `parens`, `fp64Flavor` and `plugins`, and an optimization `level`. The manifest's
 *  `wgsl`, its recorded variant's `wgsl`, its `glsl` and its `bindings` are the ones those options
 *  emit (`fp64Flavor: 'integer'` binds no `_fp64` guard), and it records `level`, `parens` and
 *  `fp64Flavor` in `emit`, so `repack` from `typeshade/emit` emits the program again under them.
 *  A plugin is a function, which a manifest cannot record: `options.ir` with a plugin throws a
 *  `TypeError`, since the load-time emitter could not emit the program again.
 *
 *  @example
 *  ```ts
 *  import { compile, packModule } from 'typeshade';
 *
 *  const program = packModule(compile(source).module, {
 *    emit: { level: 'O1', parens: 'minimal', fp64Flavor: 'integer' },
 *  });
 *  program.emit; // { level: 'O1', parens: 'minimal', fp64Flavor: 'integer' }
 *  ```
 *
 *  @throws `TypeError` for a word an emit option does not take, and for `ir` with `emit.plugins`. */
export function packModule(m: ModuleDecl, options: PackOptions = {}): Pack {
  return buildManifest(m, options);
}

/** {@link packModule} already stringified, pretty-printed at two spaces — the form a build
 *  step writes to disk or embeds in a generated module. */
export function packJson(m: ModuleDecl): string {
  return JSON.stringify(packModule(m), null, 2);
}
