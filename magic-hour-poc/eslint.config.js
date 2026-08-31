import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/explicit-function-return-type': 'error',
      'eqeqeq': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      'no-console': 'error'
    },
    ignores: ['build/', 'node_modules/', 'scripts/test-wasm-harness.ts']
  }
);
