import ts from 'typescript';
import type { TypeshadeSeverity } from '../types.js';

export function severityOfTs(category: ts.DiagnosticCategory): TypeshadeSeverity {
  switch (category) {
    case ts.DiagnosticCategory.Error:
      return 'error';
    case ts.DiagnosticCategory.Warning:
      return 'warning';
    case ts.DiagnosticCategory.Suggestion:
      return 'hint';
    default:
      return 'information';
  }
}

export function severityOfTypeshade(category: 'error' | 'warning' | 'message'): TypeshadeSeverity {
  return category === 'message' ? 'information' : category;
}
