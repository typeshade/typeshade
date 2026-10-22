import { VERSION } from './version.js';

/** The package build, separate from a program's compiler or a benchmark's revision.
 * Exported from `typeshade` and `typeshade/runtime` (change 0083). */
export interface TypeShadeBuildInfo {
  /** The TypeShade package version. */
  readonly version: string;
  /** Exact clean source revision established during packaging, or `null` for unstamped or
   * modified sources. No Git or package metadata is read at browser runtime. */
  readonly revision: string | null;
}

/** Frozen package information. Source checkouts are unstamped. Packaging may stamp the emitted
 * JavaScript only after establishing a clean source revision (change 0083).
 * Exported from `typeshade` and `typeshade/runtime`. */
export const buildInfo: TypeShadeBuildInfo = Object.freeze({ version: VERSION, revision: null });
