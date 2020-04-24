module.exports = {
  env: {
    browser: true,
    es6: true,
  },
  extends: [
    'plugin:react/recommended',
    "airbnb-base",
    "airbnb/rules/react"
  ],
  globals: {
    Atomics: 'readonly',
    SharedArrayBuffer: 'readonly',
  },
  parserOptions: {
    ecmaFeatures: {
      jsx: true,
    },
    ecmaVersion: 2018,
    sourceType: 'module',
  },
  plugins: [
    'react',
  ],
  rules: {
    "import/prefer-default-export": 0,
    "max-len": 0,
    "react/prop-types": 0,
    "no-param-reassign": 0,
    "no-underscore-dangle": 0,
    "quotes": ['error', 'single', {"allowTemplateLiterals": true}],
    "lines-between-class-members": 0,
    "@typescript-eslint/no-unused-vars": ['error'],
    "@typescript-eslint/no-explicit-any": 0,
    "@typescript-eslint/explicit-function-return-type": 0,
    "@typescript-eslint/no-empty-function": 0,
    "class-methods-use-this": 0,
    "@typescript-eslint/ban-ts-ignore": 0,
    "max-classes-per-file": 0,
    "no-unused-vars": 0,
    "import/extensions": 0,
    "import/no-unresolved": 0,
    "import/no-extraneous-dependencies": 0,
    "no-plusplus": 0,
    "no-empty": ["error", { "allowEmptyCatch": true }],
    "no-constant-condition": 0,
    "spaced-comment": 0,
    "no-useless-constructor": 0,
    "arrow-body-style": 0,
    "jsx-filename-extension": 0,
    "no-nested-ternary": 0,
    "jsx-a11y/*": 0,
  },
};
