// The compile gate's RHI conformance leg (change 0120, milestone M2): the suite of
// `src/rhi/rhi-conformance.ts` run on both GPU backends of the render hardware interface, WebGPU
// and WebGL2, in the gate's headless Chromium, every case held to its plain-JavaScript answer.
//
// WHY IT CANNOT BE VACUOUSLY GREEN (AGENTS.md#gate-discipline):
//   1. Every case must run on WebGPU, and every case but the ones WebGL2 has no member for (a
//      compute pass) on WebGL2: a floor of compared cases on each backend.
//   2. The suite run again on a WebGL2 device whose reads are perturbed must DIFFER in every case
//      that it runs: each comparison is seen to fail.

import { fileURLToPath } from 'node:url';
import { CONFORMANCE, differences, type CaseResult } from '../src/rhi/rhi-conformance.js';
import type { RhiConformanceReport } from './rhi-conformance-page.js';

interface Bundler {
  build(options: { entrypoints: string[]; target: 'browser'; format: 'esm' }): Promise<{
    success: boolean;
    logs: unknown[];
    outputs: { text(): Promise<string> }[];
  }>;
}

/** The page of the leg, bundled for the browser. */
export async function rhiConformanceBundle(): Promise<string> {
  const bun = (globalThis as { Bun?: Bundler }).Bun;
  if (bun === undefined)
    throw new Error('the RHI conformance page needs Bun: run the gate with bun');
  const built = await bun.build({
    entrypoints: [fileURLToPath(new URL('./rhi-conformance-page.ts', import.meta.url))],
    target: 'browser',
    format: 'esm',
  });
  if (!built.success)
    throw new Error(`the RHI conformance page did not build: ${built.logs.map(String).join('\n')}`);
  return built.outputs[0]!.text();
}

/** The cases WebGL2 does not run: those that need a compute pass. */
const NOT_ON_WEBGL2 = CONFORMANCE.filter((c) => c.covers.includes('beginComputePass')).length;

/** Print the leg's verdicts; the number of failures. */
export function rhiConformanceVerdicts(report: RhiConformanceReport): number {
  let failures = 0;
  const leg = (backend: string, results: readonly CaseResult[], floor: number): void => {
    let compared = 0;
    for (const r of results) {
      const diff = differences(r);
      if (r.skipped !== undefined) {
        console.log(`—     rhi ${backend.padEnd(6)}  ${r.name} (not run: ${r.skipped})`);
        continue;
      }
      compared += 1;
      if (diff.length > 0) failures += 1;
      console.log(`${diff.length > 0 ? 'FAIL' : 'ok  '}  rhi ${backend.padEnd(6)}  ${r.name}`);
      for (const d of diff.slice(0, 8)) console.log(`        ${d}`);
    }
    if (compared < floor) {
      console.error(
        `FAIL  rhi ${backend}: ${String(compared)} cases compared, fewer than the floor of ${String(floor)}`,
      );
      failures += 1;
    }
  };
  leg('webgpu', report.webgpu, CONFORMANCE.length);
  leg('webgl2', report.webgl2, CONFORMANCE.length - NOT_ON_WEBGL2);
  // Which of the backend's two ways the flat cases held: the context decides, so the leg says.
  console.log(
    `rhi webgl2: a flat value takes the first vertex ${report.provokingVertex ? 'with WEBGL_provoking_vertex' : 'through reordered indices (the context has no WEBGL_provoking_vertex)'}`,
  );
  const ran = report.perturbed.filter((r) => r.skipped === undefined);
  const blind = ran.filter((r) => differences(r).length === 0);
  if (ran.length >= CONFORMANCE.length - NOT_ON_WEBGL2 && blind.length === 0)
    console.log(
      `instrument: the suite on a WebGL2 device with perturbed reads DIFFERS in all ${String(ran.length)} cases — the verdicts can fail`,
    );
  else {
    console.error(
      `FAIL instrument: the perturbed device ran ${String(ran.length)} cases and passed ${blind.map((r) => `"${r.name}"`).join(', ') || 'none'} — those verdicts would be blind`,
    );
    failures += 1;
  }
  const ok = (results: readonly CaseResult[]): number =>
    results.filter((r) => r.skipped === undefined && differences(r).length === 0).length;
  console.log(
    `rhi conformance: ${String(CONFORMANCE.length)} cases · WebGPU ${String(ok(report.webgpu))} ok · WebGL2 ${String(ok(report.webgl2))} ok · failures: ${String(failures)}`,
  );
  return failures;
}
