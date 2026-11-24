import { tierFit, type CheckedCall, type KernelFace } from '../host-kernel.js';
import type { CallOwner } from '../owner.js';
import type { Tier } from '../tiers.js';
import type { RecordedEntry } from '../fuse-record.js';

export interface Choice {
  readonly tier: Tier;
  readonly why: readonly string[];
}

async function firstTier(
  owner: CallOwner,
  fit: (tier: Tier) => Promise<{ readonly why?: string | undefined }>,
): Promise<Choice> {
  const why: string[] = [];
  for (const tier of owner.tiers()) {
    const no = (await fit(tier)).why;
    if (no === undefined) return { tier, why };
    why.push(no);
  }
  return { tier: 'cpu', why };
}

export function tierOf(k: KernelFace, c: CheckedCall, owner: CallOwner): Promise<Choice> {
  return firstTier(owner, (tier) => tierFit(k, c, owner, tier));
}

export function tierOfEntry(c: RecordedEntry, owner: CallOwner): Promise<Choice> {
  return firstTier(owner, (tier) => c.host.entryTierFit(c.e, owner, tier));
}
