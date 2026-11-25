import type { TypeshadeDiagnostic } from '../types.js';

export function byDocumentOrder(a: TypeshadeDiagnostic, b: TypeshadeDiagnostic): number {
  return (
    a.span.start - b.span.start ||
    a.span.length - b.span.length ||
    (a.source < b.source ? -1 : a.source > b.source ? 1 : 0)
  );
}
