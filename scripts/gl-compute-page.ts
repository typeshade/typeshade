// The page side of the WebGL2 compute arm (`gl-compute-arm.ts`): the executor, bundled for the
// browser, and one function the arm calls with a program and its memory. Nothing from the
// compiler: the program arrives built.

import { runGlCompute } from '../src/core/gl-compute.js';
import type { GlComputeProgram } from '../src/core/passes/gl-compute.js';

/** One dispatch the arm asks for. */
export interface ComputeJob {
  readonly id: string;
  readonly program: GlComputeProgram;
  readonly workgroups: number;
  readonly memory: Readonly<Record<string, number[]>>;
  readonly uniforms: Readonly<Record<string, unknown>>;
}

/** What came back: each storage root's words, or why it did not run. */
export interface ComputeResult {
  readonly id: string;
  readonly memory?: Record<string, number[]>;
  readonly passes?: number;
  readonly error?: string;
}

let gl: WebGL2RenderingContext | undefined;

function run(jobs: readonly ComputeJob[]): { renderer: string; results: ComputeResult[] } {
  if (gl === undefined) {
    const made = document.createElement('canvas').getContext('webgl2');
    if (made === null)
      throw new Error('getContext("webgl2") returned null: WebGL2 is not reachable');
    gl = made;
  }
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = String(
    debug === null ? gl.getParameter(gl.RENDERER) : gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),
  );
  const results = jobs.map((job): ComputeResult => {
    const memory: Record<string, Uint32Array> = {};
    for (const [k, v] of Object.entries(job.memory)) memory[k] = new Uint32Array(v);
    try {
      const r = runGlCompute(gl!, job.program, {
        workgroups: [job.workgroups, 1, 1],
        memory,
        uniforms: job.uniforms,
      });
      return {
        id: job.id,
        passes: r.passes,
        memory: Object.fromEntries(Object.entries(memory).map(([k, v]) => [k, [...v]])),
      };
    } catch (e) {
      return { id: job.id, error: e instanceof Error ? e.message : String(e) };
    }
  });
  return { renderer, results };
}

(globalThis as Record<string, unknown>)['__runCompute'] = run;
