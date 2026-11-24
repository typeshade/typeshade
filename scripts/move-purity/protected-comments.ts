export const PROTECTED_COMMENTS: readonly RegExp[] = [
  /^\/\/\/\s*<(?:reference|amd-)/,
  /@ts-check/,
  /@jsx/,
  /@vite-ignore/,
  /@__(?:PURE|NO_SIDE_EFFECTS)__/,
  /#__PURE__/,
  /webpack(?:Ignore|Chunk)/,
  /prettier-ignore/,
  /(?:v8|c8|istanbul) ignore/,
  /format:semicolons skip/,
  /@deprecated/,
  /@preserve|@license/,
];

export const isProtectedComment = (text: string): boolean =>
  PROTECTED_COMMENTS.some((pattern) => pattern.test(text));
