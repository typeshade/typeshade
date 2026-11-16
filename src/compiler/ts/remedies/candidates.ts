// Candidate construction consumes analysis facts; it never compiles an edit.

import ts from 'typescript';
import type { AbstractConst, Carried } from '../abstract-const.js';
import { sameFile, writtenText } from '../context.js';
import type { DivisionEdit } from './contracts.js';

/** The edits a refusal of `division` can name, the preferred one first. An integer position
 *  asks the constant declared with its type, or each value with the origin converted to it; a
 *  float position asks the conversion to `f32`; each other form follows as a fallback. */
export function divisionEdits(
  info: AbstractConst,
  read: { readonly type: 'i32' | 'u32' },
  division: {
    readonly node: ts.BinaryExpression;
    readonly asked?: 'i32' | 'u32';
    readonly anyInteger?: boolean;
  },
  sourceFile: ts.SourceFile,
  variable: Carried['variable'],
  converted: (type: string) => DivisionEdit,
): DivisionEdit[] {
  const { node } = division;
  if (node.operatorToken.kind === ts.SyntaxKind.SlashEqualsToken) {
    const integer = variable?.type === 'i32' || variable?.type === 'u32';
    return [
      {
        kind: integer ? 'integer' : 'float',
        text:
          variable === undefined
            ? `${node.left.getText(sourceFile)} = f32(${node.left.getText(sourceFile)}) / ${node.right.getText(sourceFile)}`
            : `${variable.keyword === '' ? '' : `${variable.keyword} `}${variable.name}: ` +
              `${variable.type} = ${variable.init}`,
      },
    ];
  }
  const short = writtenText(info.nameNode).replace(/^#/, '');
  const declared = (type: 'i32' | 'u32'): DivisionEdit | undefined => {
    if (info.keyword === 'function') return undefined;
    if (!sameFile(info.nameNode, node) || !info.integerReads.every((r) => r.type === type)) {
      return undefined;
    }
    const decl = info.nameNode.parent as ts.VariableDeclaration | ts.PropertyDeclaration;
    // After the name, in place of a type the projection wrote there.
    const at = info.nameNode.getEnd();
    const change = { start: at, end: decl.type?.getEnd() ?? at, text: `: ${type}` };
    const head = info.keyword === '' ? short : `${info.keyword} ${short}`;
    return { kind: 'integer', text: `${head}: ${type} = ${info.written}`, change };
  };
  const other: 'i32' | 'u32' = read.type === 'u32' ? 'i32' : 'u32';
  const out: (DivisionEdit | undefined)[] = [];
  if (division.asked !== undefined) {
    // An index takes either integer type: the other reads' type, when they agree, keeps them.
    const type =
      division.anyInteger === true && info.integerReads.every((r) => r.type === read.type)
        ? read.type
        : division.asked;
    out.push(declared(type), converted(type), converted(type === 'u32' ? 'i32' : 'u32'));
    out.push(converted('f32'));
  } else {
    out.push(converted('f32'), declared(read.type), converted(read.type), converted(other));
  }
  const seen = new Set<string>();
  return out.filter((e): e is DivisionEdit => {
    if (e === undefined || seen.has(e.text)) return false;
    seen.add(e.text);
    return true;
  });
}
