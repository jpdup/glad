import neostandard from 'neostandard'
import jsdoc from 'eslint-plugin-jsdoc'
import globals from 'globals'

export default [
  ...neostandard(),
  jsdoc.configs['flat/recommended'],
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2021
      }
    },
    rules: {
      'jsdoc/require-param-description': 0,
      'jsdoc/require-returns-description': 0,
      'jsdoc/require-param-type': 1,
      'jsdoc/check-line-alignment': 1,
      'jsdoc/check-indentation': 1,
      'linebreak-style': ['error', 'unix']
    }
  },
  {
    files: ['test/**/*.js', 'test_*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2021,
        ...globals.mocha
      }
    }
  }
]
