const gts = require('gts');
const {defineConfig} = require('eslint/config');

module.exports = defineConfig([
  {
    ignores: ['build/**', 'config/**', 'functions/**', '.cache/**', '.npm/**'],
  },
  ...gts,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
    },
  },
]);
