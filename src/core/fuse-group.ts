// Implements: Rule 11.13 (docs/language-design.md; traced in reqs/).

import { KERNEL_TREE, KERNEL_WORKGROUP } from './kernel-tree.js';
import type { PlannedCall, Group } from './fuse-group/types.js';
import { infoOf } from './fuse-group/call-info.js';
import { declaredIn, refusal } from './fuse-group/refusal.js';
export { assignSlots } from './fuse-group/slots.js';
export { WEBGL2_APART, onLaterTier } from './fuse-group/tier-words.js';
export type { GroupCall, EntryCall, PlannedCall, Group } from './fuse-group/types.js';

export const DEFAULT_STORAGE_BUFFERS = 8;

export function groupCalls(
  calls: readonly PlannedCall[],
  limit: number,
  scratch: ReadonlySet<object> = new Set(),
): Group[] {
  const infos = calls.map(infoOf);
  const users = new Map<object, number[]>();
  infos.forEach((info, i) => {
    for (const key of info.by.keys()) users.set(key, [...(users.get(key) ?? []), i]);
  });
  const held = (members: readonly number[]): ReadonlySet<object> => {
    const inside = new Set(members);
    const out = new Set<object>();
    for (const key of scratch) {
      const named = users.get(key);
      if (named === undefined || !named.every((i) => inside.has(i))) continue;
      const seen = named.map((i) => infos[i]!.by.get(key)!);
      if (seen.filter((a) => a.writes).length === 1 && seen.every((a) => a.atI && !a.bare))
        out.add(key);
    }
    return out;
  };
  const groups: { calls: number[]; why?: string }[] = [];
  infos.forEach((_, i) => {
    const last = groups[groups.length - 1];
    const no = last === undefined ? {} : refusal(infos, last.calls, i, limit, held);
    if (last !== undefined && no === undefined) last.calls.push(i);
    else groups.push({ calls: [i], ...(no?.why !== undefined ? { why: no.why } : {}) });
  });
  return groups.map((g) => {
    const members = g.calls.map((i) => infos[i]!);
    const size =
      members.length === 1
        ? members[0]!.wg
        : members.some((m) => m.reduces)
          ? KERNEL_TREE
          : (declaredIn(infos, g.calls)?.size ?? KERNEL_WORKGROUP);
    return {
      ...g,
      fused: g.calls.length > 1,
      ...(members.every((m) => m.tier === 'webgpu') && size !== undefined
        ? { workgroupSize: size }
        : {}),
      contracted: g.calls.length > 1 ? [...held(g.calls)] : [],
    };
  });
}
