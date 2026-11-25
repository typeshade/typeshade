import { expect } from 'vitest';
import { bothTake } from './both-halves.js';
import { uninlined } from './keep-helpers.js';
import type { CpuValue } from '../cpu-runtime.js';
import { startDebugSession, type DebugSession } from '../debug/session.js';
import type { ModuleDecl } from '../ir/index.js';

type Options = NonNullable<Parameters<typeof startDebugSession>[3]>;

export function moduleOf(source: string): ModuleDecl {
  return uninlined(() => bothTake(source).result.module);
}

export function steppedToEnd(
  source: string,
  entry: string,
  args: readonly CpuValue[] = [],
  options?: Options,
): DebugSession {
  const session = startDebugSession(moduleOf(source), entry, args as CpuValue[], options);
  session.continue();
  expect(session.done).toBe(true);
  return session;
}

export function steppedResult(
  source: string,
  entry: string,
  args: readonly CpuValue[] = [],
  options?: Options,
): CpuValue | undefined {
  return steppedToEnd(source, entry, args, options).result;
}
