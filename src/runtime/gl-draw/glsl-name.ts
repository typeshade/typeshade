export const glslNameOf = (b: {
  readonly emitted: string;
  readonly emittedGlsl?: string;
}): string => b.emittedGlsl ?? b.emitted;
