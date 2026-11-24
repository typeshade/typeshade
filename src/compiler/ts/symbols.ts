export {
  recordResultCopies,
  recordCopyCall,
  mapResultCopies,
  resetResultCopies,
  copyCallParamsAt,
  hasResultCopies,
  resultCopiesAt,
  copyCallAt,
} from './symbols/result-copies.js';
export { recordAbstractConstTable, abstractConstTableOf } from './symbols/abstract-constants.js';
export type {
  AbstractConstDecl,
  AbstractConstRead,
  AbstractConstTable,
} from './symbols/abstract-constants.js';
export {
  captureExpressionRecords,
  openExpressionTable,
  recordLoweredExpression,
  loweredTypeOf,
  closeExpressionTable,
} from './symbols/lowered-expressions.js';
export type { LoweredExpression } from './symbols/lowered-expressions.js';
export { recordInferredReturn, inferredReturnAt } from './symbols/inferred-returns.js';
export { recordDeclaration } from './symbols/declared.js';
export type {
  DeclaredSymbolKind,
  DeclaredParam,
  DeclaredSymbol,
  DeclaredSymbolSink,
} from './symbols/declared.js';
