import ts from 'typescript';
import { skipParenNodes } from './written-syntax.js';

export function readingsSentenceOf(
  r: {
    readonly node: ts.Expression;
    readonly operator: string;
    readonly readings: { readonly u32: number; readonly ts: number; readonly unproven?: boolean };
  },
  remedy: string,
): string {
  const text = skipParenNodes(r.node).getText().replace(/\s+/g, ' ');
  if (r.readings.unproven === true) {
    return (
      `The compiler cannot prove that the u32 bits and the TypeScript value of "${text}" ` +
      `agree, so the "${r.operator}" does not say which value it means. ${remedy}`
    );
  }
  return (
    `"${text}" is ${String(r.readings.u32)} on its u32 bits and ${String(r.readings.ts)} in ` +
    `TypeScript, so the "${r.operator}" does not say which value it means. ${remedy}`
  );
}

export const absOfI32Minimum = (
  r: {
    readonly operator: string;
    readonly readings: { readonly ts: number; readonly unproven?: boolean };
  },
  all: readonly { readonly ts: number; readonly unproven?: boolean }[],
): boolean =>
  r.operator === 'abs' &&
  [r.readings, ...all].some((x) => x.unproven === true || (x.ts | 0) === -2147483648);
