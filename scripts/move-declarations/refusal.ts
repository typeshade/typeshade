export class Refusal extends Error {
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join('\n'));
  }
}

export function refuse(...reasons: string[]): never {
  throw new Refusal(reasons);
}
