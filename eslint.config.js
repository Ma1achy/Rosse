// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['assets/', 'assets-built/', 'dist/', 'node_modules/', 'spikes/', 'tests/golden/reference/'] },
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    extends: [...tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ['**/*.{js,mjs}'],
    // Tools drive pages with Playwright: code inside page.evaluate runs in the browser.
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  prettier,
);
