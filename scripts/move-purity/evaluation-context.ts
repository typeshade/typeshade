import type { EvaluationContext } from './evaluation-state.js';
import type { Side } from './side-program.js';

export const contextOf = (side: Side): EvaluationContext => ({
  checker: side.checker,
  isTracked: (fileName) => side.pathOf(fileName) !== undefined,
});
