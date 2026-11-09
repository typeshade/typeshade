// A `CpuProgram` (`rhi/cpu-program.ts`) built from a `"use typeshade"` source, for the tests of the
// CPU backend of the render hardware interface (change 0120, M3). The code is the CPU tier's
// generated code (Rule 11.7): `generateModuleJs` writes it, as it writes the module the Vite
// plugin generates, and the factory runs over `createCodegenRuntime`, as that module's does. Only
// the way the text becomes a function differs: a test builds it with `new Function`, which a
// generated module never needs, since it is module code.

import { compile } from '../../compiler/ts/compile.js';
import { generateModuleJs } from '../cpu-codegen.js';
import { createCodegenRuntime, type CodegenRuntime } from '../cpu-codegen-runtime.js';
import { cpuEntriesOf } from '../cpu-entries.js';
import type { CpuCode, CpuProgram } from '../../rhi/cpu-program.js';

/** The CPU program of `source`, whose diagnostics must have no error and whose every function
 *  the generator must write. */
export function cpuProgramOf(source: string, fileName = '/test/program.shade.ts'): CpuProgram {
  const r = compile(source, { fileName });
  const errors = r.diagnostics.filter((d) => d.category === 'error');
  if (errors.length > 0)
    throw new Error(`${fileName}: ${errors.map((d) => `${d.code} ${d.message}`).join('; ')}`);
  const gen = generateModuleJs(r.module, { precision: 'f32' });
  if (gen.fallbacks.length > 0)
    throw new Error(`${fileName}: the generator could not write ${gen.fallbacks.join(', ')}`);
  const build = (overrides?: Readonly<Record<string, number | boolean>>): CpuCode => {
    const $ = createCodegenRuntime(
      overrides === undefined ? {} : { overrides: overrides as never },
    );
    const factory = new Function('$', gen.factorySource) as (
      $: CodegenRuntime,
    ) => CodegenRuntime['F'];
    $.F = factory($);
    return {
      F: $.F as unknown as CpuCode['F'],
      $: $ as unknown as CpuCode['$'],
      specialize: (values) => build(values),
    };
  };
  return { code: build(), ...cpuEntriesOf(r.module) };
}
