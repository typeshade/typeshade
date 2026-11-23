import ts from 'typescript';
import { provenI32Minimum, type Reading } from './reading.js';
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

const parentOf = (n: ts.Node): ts.Node | undefined => {
  let up = n.parent;
  while (up !== undefined && ts.isParenthesizedExpression(up)) up = up.parent;
  return up;
};

const callOf = (n: ts.Node | undefined, name: string): n is ts.CallExpression =>
  n !== undefined &&
  ts.isCallExpression(n) &&
  ts.isIdentifier(n.expression) &&
  n.expression.text === name;

const underAbsOfI32 = (n: ts.Node): boolean => {
  const conversion = parentOf(n);
  return callOf(conversion, 'i32') && callOf(parentOf(conversion), 'abs');
};

export const absOfI32Minimum = (
  r: {
    readonly operator: string;
    readonly operation?: ts.Node;
    readonly readings: { readonly ts: number; readonly unproven?: boolean };
  },
  all: readonly Reading[],
): boolean =>
  r.operator === 'abs'
    ? [r.readings, ...all].some((x) => x.unproven === true || (x.ts | 0) === -2147483648)
    : r.operator === 'f32()' &&
      r.operation !== undefined &&
      underAbsOfI32(r.operation) &&
      all.length > 0 &&
      all.every(provenI32Minimum);
