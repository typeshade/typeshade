// === `typeshade/vite`: a host file imports a `.shade.ts` (surface §64) ===
//
// The Vite plugin. It has no Vite import: it is a plain Vite and Rollup plugin object, which the
// host's Vite accepts as it is, so the package gains no dependency (change 0009, "Ship unplugin
// as a dependency"). For each `*.shade.ts` the bundle reads, it:
//
//   - compiles the module, and fails the build with each TS80xx diagnostic at its file, line
//     and column when one is an error;
//   - returns the generated module in its place: the CPU tier's code for the functions a host
//     can call, at `f32` (Rules 8.20, 11.7), each checking its arguments (Rule 8.21);
//   - writes the host view beside it, `name.shade.typeshade.ts`, which the project's `tsconfig`
//     (`moduleSuffixes: [".typeshade", ""]`) makes `tsc` read for the import.
//
// A `.ts` the bundle reads that begins with the directive and is not named `*.shade.ts` is
// refused with the rename (Rule 3.8). `typeshade sync` writes the same views for a clean
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

/** The plugin {@link typeshade} returns: a Vite and Rollup plugin object, typed structurally so
 *  this package needs no `vite` import. */
export interface TypeshadeVitePlugin {
  readonly name: 'typeshade';
  /** Before Vite's own TypeScript transform, which would otherwise strip the source's types
   *  and hand the bundle the shader source as host code. */
  readonly enforce: 'pre';
  /** The module the bundle reads for `id`: the generated host module for a `*.shade.ts`,
   *  nothing for any other file, and a thrown error for a module that does not compile or a
   *  shader module under another name (Rule 3.8). */
  transform(code: string, id: string): Promise<{ code: string; map: null } | null>;
}

/** A `.ts` module the bundle reads from the project, not a package's. */
const isProjectTs = (path: string): boolean =>
  /\.[cm]?tsx?$/.test(path) && !path.includes('/node_modules/');

/**
 * The TypeShade plugin for Vite: `plugins: [typeshade()]` in `vite.config.ts`. It takes no
 * options.
 *
 * A host file then imports a `.shade.ts` and calls what it exports (surface §64). The call runs
 * the module's code on the CPU tier at `f32` precision (Rule 11.7), with host values (Rule 8.21).
 * The plugin writes each module's host view beside it, `name.shade.typeshade.ts`, when the
 * module changes, in `vite dev` and in `vite build`; `typeshade sync` writes them all for a
 * clean checkout.
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
export function typeshade(): TypeshadeVitePlugin {
  return {
    name: 'typeshade',
    enforce: 'pre',
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
      const face = hostFace(code, { fileName: path });
      if (face.code === undefined || face.view === undefined) {
        throw new Error(`${path} does not compile:\n${formatBuildErrors(face.diagnostics)}`);
      }
      const fs = await nodeFs();
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
