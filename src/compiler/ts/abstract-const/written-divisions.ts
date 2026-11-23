// Why: the `/` and `/=` over a bitwise expression of written integers (D-b of #1272, Amendment A2
// and A4 of change 0134) are recorded by file, and a position that reads the quotient marks the
// record. A `u32()` read marks it `none`: the `i32` edit is exact only while the `u32` operand is
// below 2^31, which no check proves, so its refusal names no edit (issue 1403).
import ts from 'typescript';

export const writtenDivisionsOf = new WeakMap<ts.SourceFile, WrittenDivision[]>();

export interface WrittenDivision {
  readonly node: ts.BinaryExpression;
  readonly subject: string;
  readonly subjects: readonly string[];
  readonly edit: string;
  readonly kind: 'float' | 'integer';
  readonly peerEdit?: (type: 'i32' | 'u32') => string;
  read: boolean;
  peer?: 'i32' | 'u32';
  noEdit?: boolean;
  readonly readings?: boolean;
}

export function noteWrittenDivision(
  node: ts.BinaryExpression,
  sourceFile: ts.SourceFile,
  subject: string,
  edit: string,
  kind: 'float' | 'integer',
  peerEdit?: (type: 'i32' | 'u32') => string,
  subjects: readonly string[] = [subject],
  readings = false,
): void {
  let list = writtenDivisionsOf.get(sourceFile);
  if (list === undefined) writtenDivisionsOf.set(sourceFile, (list = []));
  if (list.some((d) => d.node === node)) return;
  list.push({
    node,
    subject,
    subjects,
    edit,
    kind,
    read: false,
    ...(peerEdit !== undefined ? { peerEdit } : {}),
    ...(readings ? { readings } : {}),
  });
}

export function noteWrittenDivisionRead(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  how: 'read' | 'i32' | 'u32' | 'none',
): void {
  const record = writtenDivisionsOf.get(sourceFile)?.find((d) => d.node === node);
  if (record === undefined) return;
  if (how === 'read') record.read = true;
  else if (how === 'none') record.noEdit = true;
  else record.peer ??= how;
}
