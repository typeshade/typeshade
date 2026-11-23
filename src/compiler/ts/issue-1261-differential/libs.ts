export const INPUTS = { ii: -3, vi: 7, f: 2.5 } as const;
export const FILE = '/p/a.shade.ts';
export const LIB_FILE = '/p/lib.shade.ts';
const LIB_BASE =
  '"use typeshade";\nexport const L = 3;\nexport const LB = 0xF0000000 | 0;\n' +
  'export const LK = 1 | 2;\nexport function lg() {\n  return 6 ^ 3;\n}\n';
export const LIBS = [
  LIB_BASE,
  `${LIB_BASE}export const LQ = (1|2)/2;\n`,
  `${LIB_BASE}export function lh() {\n  return (5|0)/2;\n}\n`,
  `${LIB_BASE}export const LS = 0xF0000000 >> 28;\n`,
] as const;
