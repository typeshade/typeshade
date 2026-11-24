export const MOVE_DECLARATIONS = {
  pure: /^Move:\s*pure\.?\s*$/i,
  comments: /^Move:\s*comments\.?\s*$/i,
} as const;

export type MoveKind = keyof typeof MOVE_DECLARATIONS;

const KINDS = Object.keys(MOVE_DECLARATIONS) as MoveKind[];

export function declaredKinds(lines: readonly string[]): MoveKind[] {
  return KINDS.filter((kind) => lines.some((line) => MOVE_DECLARATIONS[kind].test(line)));
}

export function malformedLines(lines: readonly string[]): string[] {
  return lines.filter(
    (line) =>
      /^\s*>?\s*move\s*:/i.test(line) && !KINDS.some((kind) => MOVE_DECLARATIONS[kind].test(line)),
  );
}
