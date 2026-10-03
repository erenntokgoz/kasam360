module.exports = {
  root: true,
  env: {
    browser: true,
    es2020: true,
    node: true,
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
    'prettier',
  ],
  ignorePatterns: ['dist', '.eslintrc.js', 'node_modules'],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'react-refresh'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
  },
  overrides: [
    {
      files: ['src/presentation/**/*', 'src/domain/**/*'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: [
              {
                name: '@tauri-apps/api',
                message: 'Absolute Isolation Rule: Presentation and Domain layers must never directly access Tauri IPC commands.',
              },
              {
                name: '@tauri-apps/api/core',
                message: 'Absolute Isolation Rule: Presentation and Domain layers must never directly access Tauri IPC commands.',
              },
            ],
            patterns: [
              {
                group: ['@tauri-apps/*', '@tauri-apps/**/*'],
                message: 'Absolute Isolation Rule: Presentation and Domain layers must never directly access Tauri IPC commands.',
              },
            ],
          },
        ],
      },
    },
    {
      files: ['tests/**/*', '**/*.test.ts', '**/*.test.tsx'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
  ],
};
