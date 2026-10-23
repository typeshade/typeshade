// JSONC edits for explicit project initialization (0085). Keep untouched text and comments.
import ts from 'typescript';

/** A document the initializer can edit without reprinting unrelated properties. */
export class ConfigDocument {
  private source!: ts.JsonSourceFile;
  private object!: ts.ObjectLiteralExpression;
  private value!: Record<string, unknown>;

  constructor(
    readonly file: string,
    public text: string,
  ) {
    this.parse();
  }

  private parse(): void {
    const result = ts.parseConfigFileTextToJson(this.file, this.text);
    if (result.error)
      throw new Error(
        `${this.file}: ${ts.flattenDiagnosticMessageText(result.error.messageText, ' ')}`,
      );
    if (!result.config || typeof result.config !== 'object' || Array.isArray(result.config))
      throw new Error(`${this.file}: expected a JSON object.`);
    this.value = result.config as Record<string, unknown>;
    this.source = ts.parseJsonText(this.file, this.text);
    const first = this.source.statements[0];
    if (
      !first ||
      !ts.isExpressionStatement(first) ||
      !ts.isObjectLiteralExpression(first.expression)
    )
      throw new Error(`${this.file}: expected a JSON object.`);
    this.object = first.expression;
    const visit = (node: ts.Node): void => {
      if (ts.isObjectLiteralExpression(node)) {
        const names = new Set<string>();
        for (const p of node.properties) {
          if (!ts.isPropertyAssignment(p))
            throw new Error(`${this.file}: expected JSON properties.`);
          const name = this.name(p);
          if (names.has(name))
            throw new Error(`${this.file}: duplicate property ${JSON.stringify(name)}.`);
          names.add(name);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(this.object);
  }

  private name(p: ts.PropertyAssignment): string {
    if (!ts.isIdentifier(p.name) && !ts.isStringLiteral(p.name))
      throw new Error(`${this.file}: expected a literal property name.`);
    return p.name.text;
  }

  private property(
    object: ts.ObjectLiteralExpression,
    name: string,
  ): ts.PropertyAssignment | undefined {
    return object.properties.find(
      (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && this.name(p) === name,
    );
  }

  get(path: readonly string[]): unknown {
    let value: unknown = this.value;
    for (const name of path) {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error(`${this.file}: ${path.join('.')} needs an object parent.`);
      value = Object.hasOwn(value, name) ? (value as Record<string, unknown>)[name] : undefined;
      if (value === undefined) return undefined;
    }
    return value;
  }

  private node(path: readonly string[]): ts.Expression {
    let node: ts.Expression = this.object;
    for (const name of path) {
      if (!ts.isObjectLiteralExpression(node))
        throw new Error(`${this.file}: ${path.join('.')} needs an object parent.`);
      const p = this.property(node, name);
      if (!p) throw new Error(`${this.file}: missing ${path.join('.')}.`);
      node = p.initializer;
    }
    return node;
  }

  private replace(start: number, end: number, text: string): void {
    this.text = this.text.slice(0, start) + text + this.text.slice(end);
    this.parse();
  }

  private indent(at: number): string {
    return /^[\t ]*/.exec(this.text.slice(this.text.lastIndexOf('\n', at - 1) + 1, at))![0];
  }

  private append(node: ts.ObjectLiteralExpression | ts.ArrayLiteralExpression, item: string): void {
    this.text = appendList(this.text, node, this.source, item);
    this.parse();
  }

  set(path: readonly string[], value: unknown): void {
    const parent = path.slice(0, -1);
    if (parent.length && this.get(parent) === undefined) this.set(parent, {});
    const object = this.node(parent);
    if (!ts.isObjectLiteralExpression(object))
      throw new Error(`${this.file}: ${parent.join('.')} needs an object.`);
    const name = path[path.length - 1]!;
    const p = this.property(object, name);
    const text = JSON.stringify(value);
    if (p) this.replace(p.initializer.getStart(this.source), p.initializer.end, text);
    else this.append(object, `${JSON.stringify(name)}: ${text}`);
  }

  require(path: readonly string[], value: unknown): void {
    const current = this.get(path);
    if (current === undefined) this.set(path, value);
    else if (JSON.stringify(current) !== JSON.stringify(value))
      throw new Error(
        `${this.file}: ${path.join('.')} conflicts with ${JSON.stringify(value)}. Resolve it before running tshc init.`,
      );
  }

  strings(path: readonly string[], wanted: readonly string[], first = false): void {
    const current = this.get(path);
    if (current === undefined) {
      this.set(path, wanted);
      return;
    }
    if (!Array.isArray(current) || current.some((v: unknown) => typeof v !== 'string'))
      throw new Error(`${this.file}: ${path.join('.')} must be an array of strings.`);
    if (first && current.includes(wanted[0]) && current[0] !== wanted[0])
      throw new Error(
        `${this.file}: ${path.join('.')} must put ${JSON.stringify(wanted[0])} first. Resolve it before running tshc init.`,
      );
    for (const [i, value] of wanted.entries()) {
      if (current.includes(value)) continue;
      const node = this.node(path);
      if (!ts.isArrayLiteralExpression(node)) throw new Error(`${this.file}: expected an array.`);
      if (first && i === 0 && node.elements.length) {
        const multiline = this.text.slice(node.pos, node.end).includes('\n');
        const eol = this.text.includes('\r\n') ? '\r\n' : '\n';
        const indent = this.indent(node.elements[0]!.getStart(this.source));
        const at = node.getStart(this.source) + 1;
        this.replace(
          at,
          at,
          multiline ? `${eol}${indent}${JSON.stringify(value)},` : `${JSON.stringify(value)}, `,
        );
      } else this.append(node, JSON.stringify(value));
    }
  }
}

/** The whitespace at the start of the line that contains a node. */
function indentAt(text: string, at: number): string {
  return /^[\t ]*/.exec(text.slice(text.lastIndexOf('\n', at - 1) + 1, at))![0];
}

/** Append one property or element, preserving existing list text and trailing comments. */
export function appendList(
  text: string,
  node: ts.ObjectLiteralExpression | ts.ArrayLiteralExpression,
  source: ts.SourceFile,
  item: string,
): string {
  const items = ts.isObjectLiteralExpression(node) ? node.properties : node.elements;
  const last = items[items.length - 1];
  const close = node.end - 1;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const multiline = text.slice(node.getStart(source), close).includes('\n');
  const parent = indentAt(text, node.getStart(source));
  const unit = /\n(\t| +)\S/.exec(text)?.[1] ?? '  ';
  const indent = items.length ? indentAt(text, items[0]!.getStart(source)) : parent + unit;
  const line = text.lastIndexOf('\n', close - 1) + 1;
  const ownLine = /^[\t ]*$/.test(text.slice(line, close));
  const at = multiline && ownLine ? line : close;
  const addition = multiline
    ? `${ownLine ? '' : eol}${indent}${item}${items.hasTrailingComma ? ',' : ''}${eol}${ownLine ? '' : parent}`
    : `${last ? ' ' : ''}${item}${items.hasTrailingComma ? ',' : ''}`;
  // Apply the later insertion first, so the comma's original offset remains valid.
  let result = text.slice(0, at) + addition + text.slice(at);
  if (last && !items.hasTrailingComma)
    result = result.slice(0, last.end) + ',' + result.slice(last.end);
  return result;
}
