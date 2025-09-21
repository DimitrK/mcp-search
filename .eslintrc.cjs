module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  extends: ['eslint:recommended'],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  env: {
    node: true,
    es2022: true,
    jest: true,
  },
  rules: {
    // Basic rules only for now
    'prefer-const': 'error',
    'no-var': 'error',
    'no-console': 'off', // Allow console in CLI tools
    'no-debugger': 'error',
    'no-unused-vars': 'off', // Disable for placeholder functions in Milestone 1
  },
  overrides: [
    {
      files: ['**/*.test.ts', '**/*.spec.ts', '**/test/**/*.ts'],
      rules: {
        'no-console': 'off',
      },
    },
  ],
  ignorePatterns: ['dist/', 'node_modules/', '*.js'],
};
