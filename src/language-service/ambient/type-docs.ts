import { TYPE_DOCS } from '../docs.js';

export function renderJSDoc(text: string): string {
  if (text.includes('*/'))
    throw new Error(`JSDoc text contains '*/' which is not allowed: ${text}`);
  const singleLine = `/** ${text} */`;
  if (singleLine.length <= 100) return singleLine;
  const lines = text.split('\n');
  return `/**\n${lines.map((line) => ` * ${line}`).join('\n')}\n */`;
}

export function withTypeDocs(dts: string): string {
  const documented = new Set<string>();
  const out: string[] = [];
  for (const line of dts.split('\n')) {
    const name = /^(?:type|interface)\s+([A-Za-z_]\w*)\b/.exec(line)?.[1];
    if (name !== undefined && !documented.has(name) && Object.hasOwn(TYPE_DOCS, name)) {
      documented.add(name);
      if (!out.at(-1)?.trimEnd().endsWith('*/')) out.push(renderJSDoc(TYPE_DOCS[name]!));
    }
    out.push(line);
  }
  return out.join('\n');
}
