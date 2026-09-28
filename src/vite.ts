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
// (`types: []`), so its one file-system call is imported dynamically and typed below.

import { isTypeshadeSource } from './compiler/ts/source-file.js';
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
}

/** The plugin {@link typeshade} returns: a Vite and Rollup plugin object, typed structurally so
 *  this package needs no `vite` import. */
export interface TypeshadeVitePlugin {
  readonly name: 'typeshade';
  /** Before Vite's own TypeScript transform, which would otherwise strip the source's types
   *  and hand the bundle the shader source as host code. */
  readonly enforce: 'pre';
  /** Asks Vite to pre-bundle `typeshade/runtime` and `typeshade/runtime/internal`, the op
   *  library a generated module imports, together when `vite dev` starts: a generated module is
   *  not a source Vite's startup scan reads, so the op library would otherwise be found late and
   *  the page reloaded. */
  config(): { optimizeDeps: { include: string[] } };
  /** Reads whether this is `vite dev` (`command: 'serve'`), which decides with the `console`
   *  option whether the WGSL records the `console.*` calls a GPU entry reaches. */
  configResolved(config: { readonly command: string }): void;
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
  const when = options.console ?? 'dev';
  if (when !== 'dev' && when !== 'always' && when !== 'never')
    throw new TypeError(
      `typeshade(): console takes 'dev', 'always' or 'never', not ${JSON.stringify(when)}.`,
    );
  let dev = false;
  /** Whether this build's WGSL records the console. */
  const records = (): boolean => when === 'always' || (when === 'dev' && dev);
  return {
    name: 'typeshade',
    enforce: 'pre',
    // A generated module imports the op library, which Vite's scan of the project's sources at
    // startup never sees, and it shares modules with the program runtime a host file imports:
    // pre-bundled apart, one found after the other re-bundled both and reloaded the page in
    // `vite dev` (change 0025). Both are pre-bundled together from the start.
    config() {
      return { optimizeDeps: { include: ['typeshade/runtime', 'typeshade/runtime/internal'] } };
    },
    configResolved(config) {
      dev = config.command === 'serve';
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
        readDocument,
        ...(records() ? { console: 'gpu' as const } : {}),
        ...(options.ir === true ? { ir: true } : {}),
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
