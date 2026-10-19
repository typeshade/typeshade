"use typeshade";

// ═══ typeshade/algorithms (change 0072, §72): what the `typeshade` condition of the subpath ═══
// ═══ names, and what `scripts/bake-common-modules.ts` bakes the host face `./index.ts` from ═══

export {
  copy,
  fill,
  sequence,
  add,
  sub,
  mul,
  div,
  scale,
  absMap,
  negMap,
  sqrtMap,
  rsqrtMap,
  expMap,
  logMap,
  expm1Map,
  log1pMap,
  floorMap,
  ceilMap,
  roundMap,
  signMap,
  sinMap,
  cosMap,
  tanMap,
  tanhMap,
  sigmoidMap,
  reluMap,
  clipMap,
} from "./maps.shade.ts";
export {
  sum,
  maxAll,
  minAll,
  sumAxis,
  meanAxis,
  prodAxis,
  maxAxis,
  minAxis,
  argMaxAxis,
  argMinAxis,
} from "./reduce.shade.ts";
export { inclusiveScan, exclusiveScan, compact, histogram } from "./scan.shade.ts";
