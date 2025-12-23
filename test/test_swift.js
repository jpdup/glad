/* eslint-env mocha */

import fs from 'fs'
import path from 'path'

import { GLAD } from '../lib/glad.js'
import { Constants } from '../lib/models/constants.js'

describe('Swift Dependency Detection', function () {
  it('should detect Swift type dependencies correctly', function () {
    const glad = new GLAD({
      edges: Constants.EDGES_BOTH,
      exclude: '**/*test*.js',
      input: '.',
      lineEffect: 'flat',
      output: 'test/results/test_output_swift.svg',
      silent: true
    })

    // Create test Swift files
    const swiftFiles = [
      {
        content: `
import Foundation

public struct UserModel: Codable {
    let id: String
    let name: String
    let email: String
}

public class UserManager {
    func createUser() -> UserModel {
        return UserModel(id: "1", name: "Test", email: "test@example.com")
    }
}
`,
        name: 'UserModel.swift'
      },
      {
        content: `
import SwiftUI

public struct UserView: View {
    @StateObject private var manager = UserManager()

    public var body: some View {
        VStack {
            Text("User View")
            UserProfileCard(user: manager.createUser())
        }
    }
}
`,
        name: 'UserView.swift'
      },
      {
        content: `
import SwiftUI

public struct UserProfileCard: View {
    let user: UserModel

    public var body: some View {
        VStack {
            Text(user.name)
            Text(user.email)
        }
    }
}
`,
        name: 'UserProfileCard.swift'
      },
      {
        content: `
import Foundation

public class UserService {
    private let manager = UserManager()

    func fetchUser() async -> UserModel {
        return await manager.createUser()
    }
}
`,
        name: 'UserService.swift'
      }
    ]

    // Write test files
    const testDir = 'test_swift_integration'
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir)
    }

    const filePaths = []
    swiftFiles.forEach(file => {
      const filePath = path.join(testDir, file.name)
      fs.writeFileSync(filePath, file.content)
      filePaths.push(filePath)
    })

    try {
      // Process Swift files and generate output
      glad.swiftParser.processSwiftFiles(filePaths)
      glad.processTheGraph()

      // Verify dependencies were created correctly
      const dependencies = glad.allFileImports

      // Expected dependencies:
      // UserView.swift -> UserModel.swift (uses UserModel and UserManager)
      // UserView.swift -> UserProfileCard.swift (uses UserProfileCard)
      // UserProfileCard.swift -> UserModel.swift (uses UserModel)
      // UserService.swift -> UserModel.swift (uses UserModel and UserManager)

      const userViewToModelDeps = dependencies.filter(dep =>
        dep.source.includes('UserView') && dep.target.includes('UserModel')
      )
      const userViewToCardDeps = dependencies.filter(dep =>
        dep.source.includes('UserView') && dep.target.includes('UserProfileCard')
      )
      const userCardToModelDeps = dependencies.filter(dep =>
        dep.source.includes('UserProfileCard') && dep.target.includes('UserModel')
      )
      const userServiceDeps = dependencies.filter(dep =>
        dep.source.includes('UserService') && dep.target.includes('UserModel')
      )

      // Should have all expected dependencies
      if (userViewToModelDeps.length === 0) {
        throw new Error('UserView should depend on UserModel')
      }
      if (userViewToCardDeps.length === 0) {
        throw new Error('UserView should depend on UserProfileCard')
      }
      if (userCardToModelDeps.length === 0) {
        throw new Error('UserProfileCard should depend on UserModel')
      }
      if (userServiceDeps.length === 0) {
        throw new Error('UserService should depend on UserModel')
      }
    } finally {
      // Clean up test files
      swiftFiles.forEach(file => {
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
