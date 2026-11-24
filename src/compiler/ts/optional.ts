// Implements: Rule 7.10 (docs/language-design.md; traced in reqs/).

import type { ShaderType } from '../../core/ir/types.js';
import { optionalAbsence, logicalTypeKey, optionalInner } from './optional/registry.js';
export {
  isUndefinedLiteral,
  optionalTestOperand,
  writesUndefinedUnion,
  absentRemedyValue,
  absentLiteral,
  presenceTest,
} from './optional/syntax.js';
export { usedOptionalDecls, orderedStructDecls, typesOfFunctions } from './optional/order.js';
export {
  optionalWithin,
  refusedOptionalPosition,
  refuseOptionalAt,
  optionalDeclaredType,
  markOmittableField,
  isOmittableField,
} from './optional/positions.js';
export type { OptionalWithin } from './optional/positions.js';
export {
  zeroOfInner,
  absentOf,
  presentOf,
  valueOf,
  presentFlagOf,
  notOf,
} from './optional/values.js';
export type { StructLookup } from './optional/values.js';
export {
  optionalAbsence,
  logicalTypeKey,
  optionalStructName,
  optionalT,
  optionalInner,
  isOptional,
  optionalDeclOf,
  mayBeOptional,
} from './optional/registry.js';
export type { Absence } from './optional/registry.js';

export function fitsOptional(from: ShaderType, to: ShaderType | undefined): boolean {
  const inner = optionalInner(to);
  if (inner === undefined) return false;
  return (
    logicalTypeKey(optionalInner(from) ?? from) === logicalTypeKey(inner) &&
    ((optionalAbsence(from) ?? 0) & optionalAbsence(to)!) === (optionalAbsence(from) ?? 0)
  );
}
