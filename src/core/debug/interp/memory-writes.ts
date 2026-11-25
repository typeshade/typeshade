import { type CpuValue, matColumn, setMatColumn } from '../../cpu-runtime.js';
import type { StepCtx } from './types.js';

export function setSlot(
  container: Record<string | number, CpuValue>,
  key: string | number,
  value: CpuValue,
  ctx: StepCtx,
  logged: boolean,
): void {
  if (ctx.journal !== undefined && logged) {
    const before = container[key] as CpuValue;
    const after = value;
    ctx.journal.push({
      undo: () => {
        container[key] = before;
      },
      redo: () => {
        container[key] = after;
      },
    });
  }
  container[key] = value;
}

export function setColumn(
  m: number[],
  j: number,
  rows: number,
  v: number[],
  ctx: StepCtx,
  logged: boolean,
): void {
  if (ctx.journal !== undefined && logged) {
    const before = matColumn(m, j, rows);
    const after = [...v];
    ctx.journal.push({
      undo: () => setMatColumn(m, j, rows, before),
      redo: () => setMatColumn(m, j, rows, after),
    });
  }
  setMatColumn(m, j, rows, v);
}
