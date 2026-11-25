import type { ShaderType } from '../types.js';

/** One WGSL `diagnostic(severity, rule);` directive. */
export interface DiagnosticDirective {
  readonly severity: 'off' | 'info' | 'warning' | 'error';
  readonly rule: string;
}

/** The `x`, `y` and `z` extents of a compute entry's workgroup, WGSL's `@workgroup_size(x, y, z)`.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`. */
export type WorkgroupShape = readonly [number, number, number];

/** An entry-point parameter: it carries a `@builtin(...)` or a `@location(n)`. */
export interface EntryParam {
  readonly name: string;
  readonly type: ShaderType;
  readonly builtin?: string;
  readonly location?: number;
}
