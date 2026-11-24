import type { CpuCode, CpuEntry, CpuIo, CpuIoField, CpuProgram } from '../cpu-program.js';
import type { RhiShaderModule } from '../rhi.js';
import type { CpuModule } from './handles.js';

export interface Stage {
  readonly program: CpuProgram;
  readonly code: CpuCode;
  readonly entry: CpuEntry;
  readonly name: string;
}

export function argOf(io: CpuIo, value: (f: CpuIoField) => unknown): unknown {
  if (io.kind === 'field') return value(io.field);
  const out: Record<string, unknown> = {};
  for (const f of io.fields) out[f.name] = value(f);
  return out;
}

export function fieldsOf(io: CpuIo, result: unknown): [CpuIoField, unknown][] {
  if (io.kind === 'field') return [[io.field, result]];
  const o = result as Readonly<Record<string, unknown>>;
  return io.fields.map((f) => [f, o[f.name]]);
}

export function stageOf(
  module: RhiShaderModule,
  name: string,
  stage: CpuEntry['stage'],
  constants: Readonly<Record<string, number>> | undefined,
): Stage {
  const program = (module as CpuModule).program;
  const entry = program.entries[name];
  if (entry === undefined || entry.stage !== stage)
    throw new TypeError(`The CPU program has no ${stage} entry "${name}".`);
  if (entry.noCpu !== undefined)
    throw new TypeError(`The CPU tier does not run "${name}" yet: ${entry.noCpu}.`);
  if (program.code.F[entry.fn] === undefined)
    throw new TypeError(`The CPU program has no code for "${name}".`);
  let code = program.code;
  if (constants !== undefined && Object.keys(constants).length > 0) {
    if (code.specialize === undefined)
      throw new TypeError(
        `The CPU program of "${name}" declares no override, and the pipeline sets ${Object.keys(constants).join(', ')}.`,
      );
    code = code.specialize(constants);
  }
  return { program, code, entry, name };
}
