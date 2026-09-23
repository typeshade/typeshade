// Flat config: `typescript-eslint`'s recommended set, as in vscode-typeshade, with the one
// convention this repository already follows: a binding whose name starts with `_` is unused
// on purpose (an `Exact<…>` type assertion, a parameter a callback signature requires).
//
// Formatting is Prettier's (`bun run format:check`), and the `;` in shader source is
// `bun run format:semicolons`; neither is a lint rule. `*.shade.ts` is shader source, not a
// TypeScript module (`vec4` is a shader type there, not an import), so it is not linted.
//
// Unused `eslint-disable` directives are not reported: the ones for
// `@typescript-eslint/no-deprecated` name a rule that needs type-aware linting, which this
// config does not run, and they stay for when it does.
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      '.codebase-memory/**',
      'examples/**/*.shade.ts',
    ],
  },
  ...tseslint.configs.recommended,
  {
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
    },
  },
);
