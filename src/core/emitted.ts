export class Emitted<R extends { readonly emitted: string; readonly emittedGlsl?: string }> {
  constructor(readonly record: R) {}

  get glslName(): string {
    return this.record.emittedGlsl ?? this.record.emitted;
  }
}
