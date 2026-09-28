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
 *  entry reaches into the console buffer, with the table the buffer decodes with. */
export function packModule(m: ModuleDecl, options: PackOptions = {}): Pack {
  return buildManifest(m, options);
}

/** {@link packModule} already stringified, pretty-printed at two spaces — the form a build
 *  step writes to disk or embeds in a generated module. */
export function packJson(m: ModuleDecl): string {
  return JSON.stringify(packModule(m), null, 2);
}
