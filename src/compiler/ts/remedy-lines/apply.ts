export const remedyLines = (message: string): string[] =>
  [...message.matchAll(/[Ww]rite "((?:declare )?(?:const|let) .+?)"(?=\.| to write to it\.)/g)]
    .map((m) => m[1]!)
    .filter((line) => !line.includes('...') && !line.includes('…'));

export const declaredNameOf = (line: string): string | undefined =>
  /^(?:declare\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)/.exec(line)?.[1];

export function applyRemedy(program: string, line: string): string {
  const name = declaredNameOf(line);
  if (name === undefined) throw new Error(`the remedy "${line}" declares no name`);
  const at = new RegExp(`^([ \\t]*)(?:declare\\s+)?(?:const|let)\\s+${name}\\b.*$`, 'm');
  if (!at.test(program)) throw new Error(`no declaration of "${name}" in the program to replace`);
  return program.replace(at, (whole, indent: string) =>
    whole.trimEnd().endsWith(';') ? `${indent}${line};` : `${indent}${line}`,
  );
}
