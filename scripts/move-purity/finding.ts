export interface Finding {
  readonly kind: string;
  readonly path: string;
  readonly line?: number;
  readonly detail: string;
}

export const finding = (kind: string, path: string, detail: string, line?: number): Finding =>
  line === undefined ? { kind, path, detail } : { kind, path, line, detail };

export const describeFinding = (f: Finding): string =>
  `${f.kind} ${f.path}${f.line === undefined ? '' : `:${f.line}`}${f.detail ? ` ${f.detail}` : ''}`;
