import type { DrawBinding } from '../../../core/host-entry.js';

export function guardOf(wgsl: string | undefined): { guard?: { group: number; binding: number } } {
  const m =
    wgsl === undefined ? null : /@group\((\d+)\)\s*@binding\((\d+)\)\s*var\s+_fp64\b/.exec(wgsl);
  return m === null ? {} : { guard: { group: Number(m[1]), binding: Number(m[2]) } };
}

export function guardBinding(at: { group: number; binding: number }): DrawBinding {
  return { name: '_fp64', ...at, space: 'texture', s: 'texture_2d<f32>', guard: true };
}
