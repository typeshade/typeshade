// Implements: Rule 8.21

import type { CpuValue } from './cpu-runtime.js';
import type { HostType } from './host-values/types.js';
import { fromShader } from './host-values/from-shader.js';
export { callMember, arity } from './host-values/member-call.js';
export type { MemberSpec } from './host-values/member-call.js';
export { fromShader, fromShaderIn } from './host-values/from-shader.js';
export { toShader } from './host-values/to-shader.js';
export type { HostNumber, HostType, HostClasses } from './host-values/types.js';

export function constantOf(t: HostType, v: CpuValue): unknown {
  const deepFreeze = (x: unknown): unknown => {
    if (typeof x === 'object' && x !== null) {
      for (const k of Object.keys(x)) deepFreeze((x as Record<string, unknown>)[k]);
      Object.freeze(x);
    }
    return x;
  };
  return deepFreeze(fromShader(t, v));
}

export function notCallable(name: string, reason: string): () => never {
  return () => {
    throw new TypeError(`${name} cannot be called from host code: ${reason}`);
  };
}
