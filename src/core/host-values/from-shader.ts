import type { CpuValue } from '../cpu-runtime.js';
import type { HostType, HostClasses } from './types.js';

export function fromShader(t: HostType, v: CpuValue): unknown {
  switch (t.k) {
    case 'num':
    case 'bool':
      return v;
    case 'key':
      return t.m[v as number];
    case 'void':
      return undefined;
    case 'vec':
    case 'mat': {
      if (!Array.isArray(v)) return Array.from(v as unknown as ArrayLike<number | boolean>);
      const out = new Array<unknown>(v.length);
      for (let i = 0; i < v.length; i++) out[i] = v[i];
      return out;
    }
    case 'arr':
      return Array.from(v as unknown as ArrayLike<CpuValue>, (x) => fromShader(t.e, x));
    case 'rec': {
      const xs = v as unknown as ArrayLike<CpuValue>;
      const out: Record<string, unknown> = {};
      t.m.forEach((name, i) => (out[name] = fromShader(t.e, xs[i]!)));
      return out;
    }
    case 'struct': {
      const o = v as unknown as Record<string, CpuValue>;
      const out: Record<string, unknown> = {};
      for (const [name, ft] of t.f) out[name] = fromShader(ft, o[name]!);
      return out;
    }
  }
}

export function fromShaderIn(t: HostType, v: CpuValue, classes: HostClasses): unknown {
  switch (t.k) {
    case 'arr':
      return Array.from(v as unknown as ArrayLike<CpuValue>, (x) => fromShaderIn(t.e, x, classes));
    case 'rec': {
      const xs = v as unknown as ArrayLike<CpuValue>;
      const out: Record<string, unknown> = {};
      t.m.forEach((name, i) => (out[name] = fromShaderIn(t.e, xs[i]!, classes)));
      return out;
    }
    case 'struct': {
      const proto = classes.get(t.s);
      const out = (proto === undefined ? {} : Object.create(proto)) as Record<string, unknown>;
      assignFields(out, t, v, classes);
      return out;
    }
    default:
      return fromShader(t, v);
  }
}

export function assignFields(target: object, t: HostType, v: CpuValue, classes: HostClasses): void {
  if (t.k !== 'struct') return;
  const o = v as unknown as Record<string, CpuValue>;
  const out = target as Record<string, unknown>;
  for (const [name, ft] of t.f) out[name] = fromShaderIn(ft, o[name]!, classes);
}
