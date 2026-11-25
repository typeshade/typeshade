import type { Tier } from '../tiers.js';

export const WEBGL2_APART = 'WebGL2 runs the calls apart';

const TIER_WORDS: Readonly<Record<Tier, string>> = {
  webgpu: 'WebGPU',
  webgl2: 'WebGL2',
  cpu: 'the CPU',
};

export const onLaterTier = (name: string, tier: Tier, why: readonly string[]): string =>
  `${name} runs on ${TIER_WORDS[tier]}, ${why.join('; ')}`;
