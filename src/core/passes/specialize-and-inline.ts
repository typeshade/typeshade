import type { ModuleDecl } from '../ir/index.js';
import { inlineSmall } from './inline-small.js';
import { specializeCalls } from './specialize-calls.js';

let inlining = true;

export function setSmallInlining(on: boolean): void {
  inlining = on;
}

export const specializeAndInline = (m: ModuleDecl): ModuleDecl =>
  inlining ? inlineSmall(specializeCalls(m)) : specializeCalls(m);
