export const tree = (files: Record<string, string>): Map<string, string> =>
  new Map(Object.entries(files));

export const ALPHA = `/** Adds one. */\nfunction addOne(x: number): number {\n  return x + 1;\n}\n`;

export const BETA = `const LIMIT = 4;\n\nfunction clamp(x: number): number {\n  return Math.min(x, LIMIT);\n}\n`;

export const USE_TYPESHADE = '"use typeshade";\n';

export const exported = (text: string): string =>
  text.replace(/^(function|const) /gm, 'export $1 ');
