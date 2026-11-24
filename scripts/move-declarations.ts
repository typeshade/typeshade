import { runMove } from './move-declarations/run.js';

export { planMove } from './move-declarations/plan.js';
export type { MovePlan } from './move-declarations/plan.js';

if (import.meta.main) process.exit(await runMove(process.argv.slice(2), process.cwd()));
