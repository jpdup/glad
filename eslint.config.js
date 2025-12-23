import jsdoc from 'eslint-plugin-jsdoc'
import perfectionist from 'eslint-plugin-perfectionist'
import globals from 'globals'
import neostandard from 'neostandard'

export default [
  ...neostandard(),
  jsdoc.configs['flat/recommended'],
  perfectionist.configs['recommended-natural'],
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2021
      }
    },
    rules: {
      'jsdoc/check-indentation': 1,
      'jsdoc/check-line-alignment': 1,
      'jsdoc/require-param-description': 0,
      'jsdoc/require-param-type': 1,
      'jsdoc/require-returns-description': 0,
      'linebreak-style': ['error', 'unix'],
      'perfectionist/sort-imports': [
        'error',
        {
          groups: [
            'builtin',
            'external',
            'internal',
            'parent',
            'sibling',
            'index'
          ],
          order: 'asc',
          type: 'natural'
        }
      ],
      'perfectionist/sort-objects': [
        'error',
        {
          order: 'asc',
          type: 'natural'
        }
      ]
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
