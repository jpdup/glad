/* eslint-env mocha */

import { GLAD } from '../lib/glad.js'
import fs from 'fs'
import path from 'path'

describe('Swift Dependency Detection', function () {
  it('should detect Swift type dependencies correctly', function () {
    const glad = new GLAD({
      silent: true,
      input: '.',
      exclude: '**/*test*.js'
    })

    // Create test Swift files
    const swiftFiles = [
      {
        name: 'UserModel.swift',
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
`
      },
      {
        name: 'UserView.swift',
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
`
      },
      {
        name: 'UserProfileCard.swift',
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
`
      },
      {
        name: 'UserService.swift',
        content: `
import Foundation

public class UserService {
    private let manager = UserManager()

    func fetchUser() async -> UserModel {
        return await manager.createUser()
    }
}
`
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
      // Process Swift files
      glad.processSwiftFiles(filePaths)

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
