export const RUNNABLE_TEST_ROOTS: readonly string[] = ['src/', 'examples/'];

export const isRunnableTest = (path: string): boolean =>
  path.endsWith('.test.ts') &&
  RUNNABLE_TEST_ROOTS.some((root) => path.startsWith(root)) &&
  !path.split('/').includes('node_modules');
