// Code quality gate (CI "quality" job). Keep it strict on real bugs, quiet on style.
import js from '@eslint/js';
import globals from 'globals';

const rules = {
  'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true, varsIgnorePattern: '^_' }],
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-constant-condition': ['error', { checkLoops: false }],
  eqeqeq: ['error', 'smart'],
  'no-var': 'error',
  'prefer-const': ['error', { destructuring: 'all' }],
};
const options = (env) => ({ ecmaVersion: 2024, sourceType: 'module', globals: { ...env } });

export default [
  { ignores: ['node_modules/**', 'data/**', 'coverage/**'] },
  js.configs.recommended,
  { files: ['**/*.js', '**/*.mjs'], ignores: ['src/panel/public/**'], languageOptions: options(globals.node), rules },
  // The panel's browser modules (063): browser globals only.
  { files: ['src/panel/public/**/*.js'], languageOptions: options(globals.browser), rules },
];
