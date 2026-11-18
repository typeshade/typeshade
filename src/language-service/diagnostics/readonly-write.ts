import { TS_CODES } from '../../compiler/ts/codes.js';
import type { TypeshadeDiagnostic } from '../types.js';
import { spanEnd, within } from './spans.js';

const MUTATING_MEMBER_OF_READONLY =
  /^Property '(push|fill|pop|shift|unshift|splice|sort|reverse|copyWithin)' does not exist on type 'readonly /;

function isReadonlyWriteReport(diagnostic: TypeshadeDiagnostic): boolean {
  if (diagnostic.source !== 'typescript') return false;
  if (diagnostic.code === 2542 || diagnostic.code === 2540) return true;
  return diagnostic.code === 2339 && MUTATING_MEMBER_OF_READONLY.test(diagnostic.message);
}

function refusesTheSameWrite(error: TypeshadeDiagnostic, diagnostic: TypeshadeDiagnostic): boolean {
  if (error.code === TS_CODES.CONST_ASSIGN) return within(diagnostic.span, error.span);
  return (
    error.code === TS_CODES.UNSUPPORTED &&
    / writes "[^"]+", which this shader may only read\./.test(error.message) &&
    diagnostic.span.start === spanEnd(error.span) + 1
  );
}

export function repeatsReadonlyWrite(
  diagnostic: TypeshadeDiagnostic,
  compilerErrors: readonly TypeshadeDiagnostic[],
): boolean {
  if (!isReadonlyWriteReport(diagnostic)) return false;
  return compilerErrors.some((error) => refusesTheSameWrite(error, diagnostic));
}
