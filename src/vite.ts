// === `typeshade/vite`: a host file imports a `.shade.ts` (surface §64) ===
//
// The Vite plugin. It has no Vite import: it is a plain Vite and Rollup plugin object, which the
// host's Vite accepts as it is, so the package gains no dependency (change 0009, "Ship unplugin
// as a dependency"). For each `*.shade.ts` the bundle reads, it:
//
//   - compiles the module with the shader files it imports, read from disk (Rule 3.9), watches
//     each of them, and fails the build with each TS80xx diagnostic at its file, line and column
//     when one is an error;
//   - returns the generated module in its place: the CPU tier's code for the functions a host
//     can call, at `f32` (Rules 8.20, 11.7), each checking its arguments (Rule 8.21), and for
//     each `@compute` entry its WGSL and the byte layout of each binding it reaches, which the
//     runtime dispatches on WebGPU (Rule 8.24);
//   - records the `console.*` calls a GPU entry reaches into the WGSL's console buffer (change
//     0014), which the runtime reads back and prints after the dispatch or draw: in `vite dev`
//     by default, in every build with `console: 'always'` and never with `'never'` (change 0025);
//   - writes the host view beside it, `name.shade.typeshade.ts`, which the project's `tsconfig`
//     (`moduleSuffixes: [".typeshade", ""]`) makes `tsc` read for the import.
//
// A `.ts` the bundle reads that begins with the directive and is not named `*.shade.ts` is
// refused with the rename (Rule 3.8). `tshc sync` writes the same views for a clean
// checkout before `tsc` runs.
//
// Like `src/cli/bin.ts`, this runs on Node, and the library build has no host types
// (`types: []`), so Node filesystem and path access use dynamically imported, local types.

import { isTypeshadeSource } from './compiler/ts/source-file.js';
import { portableOrigin } from './vite-origin.js';
import {
  formatBuildErrors,
  hostFace,
  hostViewPath,
  isShaderModulePath,
} from './compiler/ts/host-face.js';

interface NodeFs {
  readFileSync(path: string, encoding: 'utf8'): string;
  writeFileSync(path: string, text: string): void;
}

let fsPromise: Promise<NodeFs> | undefined;
const nodeFs = (): Promise<NodeFs> => {
  const specifier: string = 'node:fs';
  return (fsPromise ??= import(specifier) as Promise<NodeFs>);
};

/** The options of {@link typeshade}. */
export interface TypeshadeViteOptions {
  /** Opt into portable fusion identities as JSON tuples of this namespace and the module's
   *  path relative to Vite's root (change 0122). Use a distinct nonempty namespace for each
   *  independently built package that can share a fusion scope. Paths must be absolute and
   *  on the same drive or UNC share; outside-root paths retain `../`. Omitting this option
   *  preserves the file-name origin. Other source metadata can still contain absolute paths. */
  readonly originNamespace?: string;
  /**
   * When a GPU entry's WGSL records its `console.*` calls, which the runtime prints after the
   * dispatch or draw (surface §66): `'dev'` in `vite dev` and not in `vite build`, the default;
   * `'always'` in both, so a production build binds a console buffer for each dispatch and draw
   * of an entry that logs and reads it back; `'never'` in neither, so `vite dev`'s WGSL is the
   * production WGSL.
   */
  readonly console?: 'dev' | 'always' | 'never';
  /**
   * Put each module's portable IR in its manifest, the default export, so the load-time emitter
   * (`repack` from `typeshade/emit`) can emit the program again where it runs: with the console
   * recorded in a deployed build, for one. About three times the WGSL gzipped, so off by
   * default.
   */
  readonly ir?: boolean;
  /**
   * Write into the face of each kernel function that lowers the facts of its loops and the
   * lowered module they name, as portable IR, so that the planner of `typeshade/fuse` can fuse a
   * chain of its calls into one dispatch. Enabled by default in dev and production (change
   * 0085). `false` omits this metadata to reduce generated size; scopes still run in order.
   * Eligible ordinary calls can use private input projection with these facts present.
   */
  readonly fuse?: boolean;
}

/** The plugin {@link typeshade} returns: a Vite and Rollup plugin object, typed structurally so
 *  this package needs no `vite` import. */
export interface TypeshadeVitePlugin {
  readonly name: 'typeshade';
  /** Before Vite's own TypeScript transform, which would otherwise strip the source's types
   *  and hand the bundle the shader source as host code. */
  readonly enforce: 'pre';
  /** Asks Vite to pre-bundle `typeshade/runtime`, `typeshade/runtime/internal` and
   *  `typeshade/fuse` together when `vite dev` starts. Generated modules and a late host import
   *  can otherwise reveal a shared dependency after optimization and reload the page. */
  config(): { optimizeDeps: { include: string[] } };
  /** Reads whether this is `vite dev` (`command: 'serve'`) and the project root. The root is
   *  required only with `originNamespace`; the command controls GPU console recording. */
  configResolved(config: { readonly command: string; readonly root?: string }): void;
  /** Says in one line, when a production build starts, that it records the console. */
  buildStart(): void;
  /** The module the bundle reads for `id`: the generated host module for a `*.shade.ts`,
   *  nothing for any other file, and a thrown error for a module that does not compile or a
   *  shader module under another name (Rule 3.8). A module that imports another shader module
   *  is compiled with it (Rule 3.9), a package's found in `node_modules` from the module's
   *  directory up, and each file it read is handed to the bundler's `addWatchFile`, read off
   *  the plugin context the bundler calls this with. */
  transform(code: string, id: string): Promise<{ code: string; map: null } | null>;
}

/** A `.ts` module the bundle reads from the project, not a package's. */
const isProjectTs = (path: string): boolean =>
  /\.[cm]?tsx?$/.test(path) && !path.includes('/node_modules/');

/**
 * The TypeShade plugin for Vite: `plugins: [typeshade()]` in `vite.config.ts`.
 *
 * A host file then imports a `.shade.ts` and calls what it exports (surface §64). The call runs
 * the module's code on the CPU tier at `f32` precision (Rule 11.7), with host values (Rule 8.21); a
 * call of a `@compute` entry dispatches it on WebGPU (Rule 8.24).
 * The plugin writes each module's host view beside it, `name.shade.typeshade.ts`, when the
 * module changes, in `vite dev` and in `vite build`; `tshc sync` writes them all for a
 * clean checkout. A GPU entry records its `console.*` calls in `vite dev`, and in a production
 * build too with `typeshade({ console: 'always' })` ({@link TypeshadeViteOptions}).
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import { defineConfig } from 'vite';
 * import { typeshade } from 'typeshade/vite';
 *
 * export default defineConfig({ plugins: [typeshade()] });
 * ```
 */
export function typeshade(options: TypeshadeViteOptions = {}): TypeshadeVitePlugin {
  const namespace = options.originNamespace;
  if (namespace !== undefined && (typeof namespace !== 'string' || namespace.length === 0))
    throw new TypeError('typeshade(): originNamespace must be a nonempty string.');
  const when = options.console ?? 'dev';
  if (when !== 'dev' && when !== 'always' && when !== 'never')
    throw new TypeError(
      `typeshade(): console takes 'dev', 'always' or 'never', not ${JSON.stringify(when)}.`,
    );
  let dev = false;
  let root: string | undefined;
  /** Whether this build's WGSL records the console. */
  const records = (): boolean => when === 'always' || (when === 'dev' && dev);
  return {
    name: 'typeshade',
    enforce: 'pre',
    // The op library and fuse share modules with the program runtime. Generated code or a late
    // host import can reveal either after startup (changes 0025 and 0073). A second optimization
    // then invalidates the first chunks while the page is importing them. Prepare all three
    // together so their imports keep one dependency graph.
    config() {
      return {
        optimizeDeps: {
          include: ['typeshade/runtime', 'typeshade/runtime/internal', 'typeshade/fuse'],
        },
      };
    },
    configResolved(config) {
      dev = config.command === 'serve';
      root = config.root;
    },
    buildStart() {
      if (!dev && when === 'always')
        console.info(
          "typeshade: console: 'always' records each GPU entry's console.* calls in this build; a dispatch or draw of an entry that logs binds a console buffer and reads it back.",
        );
    },
    async transform(code, id) {
      const path = id.split('?')[0]!.replace(/\\/g, '/');
      if (!isShaderModulePath(path)) {
        if (isProjectTs(path) && code.includes('use typeshade') && isTypeshadeSource(code, path)) {
          const renamed = path.replace(/(\.[cm]?tsx?)$/, '.shade.ts');
          throw new Error(
            `${path} begins with "use typeshade", so it is a shader module, and a host imports a ` +
              `shader module by the name *.shade.ts (Rule 3.8). Rename it to ` +
              `${renamed.split('/').pop()!} and import it by that name.`,
          );
        }
        return null;
      }
      const origin =
        namespace === undefined ? undefined : await portableOrigin(namespace, root, path);
      const fs = await nodeFs();
      const readDocument = (fileName: string): string | undefined => {
        try {
          return fs.readFileSync(fileName, 'utf8');
        } catch {
          return undefined;
        }
      };
      const face = hostFace(code, {
        fileName: path,
        ...(origin !== undefined ? { origin } : {}),
        readDocument,
        ...(records() ? { console: 'gpu' as const } : {}),
        ...(options.ir === true ? { ir: true } : {}),
        ...(options.fuse !== undefined ? { fuse: options.fuse } : {}),
      });
      // The files the module imports, so an edit to one rebuilds this module (Rule 3.9). Rollup
      // and Vite call a plugin hook with their context as `this`; a direct call has none.
      const context = this as unknown as { addWatchFile?: (id: string) => void } | undefined;
      for (const file of face.files) if (file !== path) context?.addWatchFile?.(file);
      if (face.code === undefined || face.view === undefined) {
        throw new Error(`${path} does not compile:\n${formatBuildErrors(face.diagnostics)}`);
      }
      const viewPath = hostViewPath(path);
      let current: string | undefined;
      try {
        current = fs.readFileSync(viewPath, 'utf8');
      } catch {
        current = undefined;
      }
      if (current !== face.view) fs.writeFileSync(viewPath, face.view);
      return { code: face.code, map: null };
    },
  };
}
