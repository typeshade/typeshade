import type { CpuValue } from '../../cpu-runtime.js';
import type { ShaderType, Stmt } from '../../ir/index.js';
import type { SourceSpan } from '../../ir/span.js';
import { sourceSpanOf } from '../../ir/span.js';
import type { StepFrame } from '../interp.js';
import type { DebugPause } from './types.js';

export function snapshot(
  reason: DebugPause['reason'],
  stmt: Stmt,
  span: SourceSpan,
  frames: readonly StepFrame[],
  bindings: Readonly<Record<string, CpuValue>>,
  bindingTypes: ReadonlyMap<string, ShaderType>,
): DebugPause {
  return {
    reason,
    span,
    stmt,
    frames: frames
      .map((f) => {
        const locals = new Map(f.env);
        const localTypes = new Map(f.types);
        const stubbedLocals = new Set(f.stubbed);
        for (const [authored, local] of f.parameterLocals ?? []) {
          if (locals.has(local)) locals.set(authored, locals.get(local)!);
          if (localTypes.has(local)) localTypes.set(authored, localTypes.get(local)!);
          locals.delete(local);
          localTypes.delete(local);
          stubbedLocals.delete(authored);
          if (stubbedLocals.has(local)) stubbedLocals.add(authored);
          stubbedLocals.delete(local);
        }
        return {
          fnName: f.fnName,
          fnSpan: f.fnSpan,
          callSpan: f.callSpan,
          span: f.current ? sourceSpanOf(f.current) : undefined,
          locals,
          localTypes,
          stubbedLocals,
        };
      })
      .reverse(),
    bindings: new Map(Object.entries(bindings)),
    bindingTypes,
  };
}
