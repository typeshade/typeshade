import type { ModuleDecl } from '../ir/index.js';
import { inlineSmall } from './inline-small.js';
import { specializeCalls } from './specialize-calls.js';

export const specializeAndInline = (m: ModuleDecl): ModuleDecl => inlineSmall(specializeCalls(m));
