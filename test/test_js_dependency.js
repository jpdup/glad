/* eslint-env mocha */

import { GLAD } from '../lib/glad.js'
import fs from 'fs'
import path from 'path'

describe('JavaScript Dependency Detection', function () {
  it('should detect JavaScript import/export dependencies correctly', function () {
    const glad = new GLAD({
      silent: true,
      input: '.',
      output: 'test_output_js.svg',
      exclude: '**/*test*.js'
    })

    // Create test JavaScript files
    const jsFiles = [
      {
        name: 'utils.js',
        content: `
export function formatName(firstName, lastName) {
  return \`\${firstName} \${lastName}\`.trim()
}

export const API_BASE_URL = 'https://api.example.com'

export class DataService {
  static async fetchUsers() {
    const response = await fetch(\`\${API_BASE_URL}/users\`)
    return response.json()
  }
}
`
      },
      {
        name: 'UserComponent.js',
        content: `
import React from 'react'
import { formatName, DataService } from './utils.js'

export default function UserComponent({ user }) {
  const [users, setUsers] = React.useState([])

  React.useEffect(() => {
    DataService.fetchUsers().then(setUsers)
  }, [])

  return (
    <div>
      <h1>{formatName(user.firstName, user.lastName)}</h1>
      <UserList users={users} />
    </div>
  )
}

function UserList({ users }) {
  return (
    <ul>
      {users.map(user => (
        <li key={user.id}>
          {formatName(user.firstName, user.lastName)}
        </li>
      ))}
    </ul>
  )
}
`
      },
      {
        name: 'App.js',
        content: `
import React from 'react'
import UserComponent from './UserComponent.js'
import { API_BASE_URL } from './utils.js'

function App() {
  console.log('API URL:', API_BASE_URL)

  return (
    <div className="App">
      <header>
        <h1>User Management App</h1>
      </header>
      <main>
        <UserComponent user={{ firstName: 'John', lastName: 'Doe' }} />
      </main>
    </div>
  )
}

export default App
`
      }
    ]

    // Write test files
    const testDir = 'test_js_integration'
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir)
    }

    const filePaths = []
    jsFiles.forEach(file => {
      const filePath = path.join(testDir, file.name)
      fs.writeFileSync(filePath, file.content)
      filePaths.push(filePath)
    })

    try {
      // Process JavaScript files
      glad.scanSourceFilesBuildGraphAndGenerateSvg()

      // Verify dependencies were created correctly
      const dependencies = glad.allFileImports

      // Expected dependencies:
      // UserComponent.js -> utils.js (imports formatName, DataService)
      // App.js -> UserComponent.js (imports UserComponent)
      // App.js -> utils.js (imports API_BASE_URL)

      const userComponentToUtils = dependencies.filter(dep =>
        dep.source.includes('UserComponent') && dep.target.includes('utils')
      )
      const appToUserComponent = dependencies.filter(dep =>
        dep.source.includes('App') && dep.target.includes('UserComponent')
      )
      const appToUtils = dependencies.filter(dep =>
        dep.source.includes('App') && dep.target.includes('utils')
      )

      // Should have dependencies
      if (userComponentToUtils.length === 0) {
        throw new Error('UserComponent should depend on utils')
      }
      if (appToUserComponent.length === 0) {
        throw new Error('App should depend on UserComponent')
      }
      if (appToUtils.length === 0) {
        throw new Error('App should depend on utils')
      }
    } finally {
      // Clean up test files
      jsFiles.forEach(file => {
        const filePath = path.join(testDir, file.name)
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath)
        }
      })
      if (fs.existsSync(testDir)) {
        fs.rmdirSync(testDir)
      }
    }
  })
})
