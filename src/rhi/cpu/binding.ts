import type { CpuBinding, CpuCode } from '../cpu-program.js';
import type { RhiBuffer } from '../rhi.js';
import type { CpuBuffer } from './buffer.js';
import type { CpuBindGroup } from './handles.js';
import { decode, encode } from './codec.js';
import type { Stage } from './stage.js';

type Bound = Map<
  string,
  { readonly buffer: CpuBuffer; readonly size: number; readonly writable: boolean }
>;

export function boundOf(groups: ReadonlyMap<number, CpuBindGroup>): Bound {
  const out: Bound = new Map();
  for (const [index, group] of groups)
    for (const e of group.entries) {
      const r = e.resource;
      if (!('buffer' in r)) continue;
      const le = group.layout.entries.find((l) => l.binding === e.binding);
      const writable = le !== undefined && 'buffer' in le && le.buffer.type === 'storage';
      const buffer = r.buffer as CpuBuffer;
      out.set(`${index}:${e.binding}`, {
        buffer,
        size: Math.min(r.size ?? buffer.size, buffer.size),
        writable,
      });
    }
  return out;
}

const hostValues = new WeakMap<object, { value: unknown }>();

export function holdValue(buffer: RhiBuffer, slot: { value: unknown } | undefined): void {
  if (slot === undefined) hostValues.delete(buffer);
  else hostValues.set(buffer, slot);
}

export function bindTo(
  stages: readonly Stage[],
  bound: Bound,
): { binding: CpuBinding; code: CpuCode; buffer: CpuBuffer; size: number }[] {
  const back: { binding: CpuBinding; code: CpuCode; buffer: CpuBuffer; size: number }[] = [];
  const seen = new Set<CpuCode>();
  for (const s of stages) {
    if (seen.has(s.code)) continue;
    seen.add(s.code);
    for (const b of s.program.bindings) {
      const at = bound.get(`${b.group}:${b.binding}`);
      if (at === undefined || b.layout === undefined) continue;
      const held = hostValues.get(at.buffer);
      s.code.$.bindings[b.name] =
        held !== undefined
          ? held.value
          : decode(new DataView(at.buffer.bytes.buffer, 0, at.size), 0, b.layout, at.size);
      if (at.writable && b.kind === 'storage')
        back.push({ binding: b, code: s.code, buffer: at.buffer, size: at.size });
    }
  }
  return back;
}

export function writeBack(
  back: readonly { binding: CpuBinding; code: CpuCode; buffer: CpuBuffer; size: number }[],
): void {
  for (const { binding, code, buffer, size } of back) {
    const held = hostValues.get(buffer);
    if (held !== undefined) {
      held.value = code.$.bindings[binding.name];
      continue;
    }
    encode(
      new DataView(buffer.bytes.buffer, 0, size),
      0,
      binding.layout!,
      code.$.bindings[binding.name],
      size,
    );
  }
}
