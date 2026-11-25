export const ROLES = ['vertex attribute', 'value between stages', 'render target'] as const;

export interface FieldFacts {
  readonly roles: readonly string[];
  readonly location: number | undefined;
  readonly builtin?: boolean;
}

export function fieldLine(facts: FieldFacts | undefined): string | undefined {
  if (facts?.location === undefined) return undefined;
  const what = facts.roles.length > 0 ? facts.roles.join(' and ') : 'user-defined input or output';
  return `${what} at @location(${String(facts.location)})`;
}
