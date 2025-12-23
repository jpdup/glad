import fs from 'fs'
import path from 'path'

import Parser from 'tree-sitter'
import Swift from 'tree-sitter-swift'

import { GLAD } from '../glad.js'
import { stringIsEmpty } from '../util/strings.js'

/**
 * Swift parser for GLAD
 */
export class SwiftParser {
  /**
   * @param {GLAD} glad - The GLAD instance
   */
  constructor (glad) {
    this.glad = glad
  }

  /**
   * Extract type definitions from Swift AST
   * @param {Parser.Tree} tree - The parsed AST tree
   * @param {string} content - The source code content
   * @returns {Set<string>} Set of type names defined in the file
   */
  extractTypeDefinitions (tree, content) {
    const definitions = new Set()

    // Use a simpler approach - walk the tree and find type declarations
    const walkTree = (node) => {
      // Check for class, struct, enum, protocol, actor declarations
      if (node.type === 'class_declaration' ||
        node.type === 'struct_declaration' ||
        node.type === 'enum_declaration' ||
        node.type === 'protocol_declaration' ||
        node.type === 'actor_declaration') {
        // Find the identifier node (usually the first child with type 'identifier' or 'type_identifier')
        for (const child of node.children) {
          if (child.type === 'identifier' || child.type === 'type_identifier') {
            const typeName = content.substring(child.startIndex, child.endIndex)
            definitions.add(typeName)
            break // Found the name, no need to continue
          }
        }
      }

      // Recursively walk child nodes
      for (const child of node.children) {
        walkTree(child)
      }
    }

    walkTree(tree.rootNode)
    return definitions
  }

  /**
   * Extract type usages from Swift AST
   * @param {Parser.Tree} tree - The parsed AST tree
   * @param {string} content - The source code content
   * @returns {Set<string>} Set of type names used in the file
   */
  extractTypeUsages (tree, content) {
    const usages = new Set()
    const definedTypes = new Set()

    // First pass: collect all defined types in this file
    const collectDefinitions = (node) => {
      if (node.type === 'class_declaration' ||
        node.type === 'struct_declaration' ||
        node.type === 'enum_declaration' ||
        node.type === 'protocol_declaration' ||
        node.type === 'actor_declaration') {
        for (const child of node.children) {
          if (child.type === 'identifier' || child.type === 'type_identifier') {
            const typeName = content.substring(child.startIndex, child.endIndex)
            definedTypes.add(typeName)
            break
          }
        }
      }

      for (const child of node.children) {
        collectDefinitions(child)
      }
    }

    collectDefinitions(tree.rootNode)

    // Second pass: collect type usages that are not definitions
    const collectUsages = (node) => {
      // Look for various Swift AST node types that represent type usages
      if (node.type === 'type_identifier' ||
        node.type === 'identifier' ||
        node.type === 'simple_identifier' ||
        node.type === 'navigation_suffix') {
        const typeName = content.substring(node.startIndex, node.endIndex)
        // Only consider capitalized identifiers (Swift type convention)
        if (typeName.length > 0 && typeName[0] === typeName[0].toUpperCase()) {
          // Only add if it's not defined in this file
          if (!definedTypes.has(typeName)) {
            usages.add(typeName)
          }
        }
      }

      // Also check for constructor calls like MyStruct(...) or MyClass(...)
      if (node.type === 'call_expression') {
        // Check if this is a constructor call (starts with capitalized identifier)
        for (const child of node.children) {
          if (child.type === 'navigation_expression' ||
            child.type === 'simple_identifier' ||
            child.type === 'identifier') {
            const typeName = content.substring(child.startIndex, child.endIndex)
            if (typeName.length > 0 && typeName[0] === typeName[0].toUpperCase()) {
              if (!definedTypes.has(typeName)) {
                usages.add(typeName)
              }
            }
            break // Found the constructor name
          }
        }
      }

      // Check for type annotations like "variable: MyType"
      if (node.type === 'type_annotation') {
        for (const child of node.children) {
          if (child.type === 'type_identifier' || child.type === 'user_type') {
            const collectTypeNames = (typeNode) => {
              if (typeNode.type === 'type_identifier' || typeNode.type === 'identifier') {
                const typeName = content.substring(typeNode.startIndex, typeNode.endIndex)
                if (typeName.length > 0 && typeName[0] === typeName[0].toUpperCase()) {
                  if (!definedTypes.has(typeName)) {
                    usages.add(typeName)
                  }
                }
              }
              for (const child of typeNode.children) {
                collectTypeNames(child)
              }
            }
            collectTypeNames(child)
          }
        }
      }

      // Special handling for SwiftUI view construction like PillView(title: ...)
      // Look for direct type references in expressions
      if (node.type === 'function_call_expression' ||
        node.type === 'constructor_call' ||
        node.type === 'implicit_member_expression') {
        // Extract the base type name from constructor calls
        const extractConstructorType = (callNode) => {
          for (const child of callNode.children) {
            if (child.type === 'simple_identifier' ||
              child.type === 'identifier' ||
              child.type === 'type_identifier') {
              const typeName = content.substring(child.startIndex, child.endIndex)
              if (typeName.length > 0 && typeName[0] === typeName[0].toUpperCase()) {
                if (!definedTypes.has(typeName)) {
                  usages.add(typeName)
                }
              }
              break
            }
          }
        }
        extractConstructorType(node)
      }

      // Recursively walk child nodes
      for (const child of node.children) {
        collectUsages(child)
      }
    }

    collectUsages(tree.rootNode)
    return usages
  }

  /**
   * @param {string} dir
   * @param {string} ext
   * @returns {string[]}
   */
  findFilesRecursively (dir, ext) {
    let results = []
    try {
      const list = fs.readdirSync(dir)
      list.forEach(file => {
        const fullPath = path.resolve(dir, file)
        const stat = fs.statSync(fullPath)
        if (stat && stat.isDirectory()) {
          // ignore node_modules, .git, etc
          if (file !== 'node_modules' && file !== '.git' && file !== '.build' && file !== 'Pods') {
            results = results.concat(this.findFilesRecursively(fullPath, ext))
          }
        } else {
          if (file.endsWith(ext)) {
            results.push(fullPath)
          }
        }
      })
    } catch (e) {
      // ignore
    }
    return results
  }

  /**
   * Generate dependencies from Swift files
   */
  generateDependenciesFromSwiftFiles () {
    const startingPath = this.normalizeStartingPath()

    if (!this.glad.options.silent) {
      console.info(`Searching "${startingPath}" for Swift files...`)
    }

    // Find all Swift files
    const swiftFiles = this.findFilesRecursively(startingPath, '.swift')

    // Filter out excluded files
    const filteredFiles = swiftFiles.filter(file => {
      const relativePath = path.relative(startingPath, file)
      return !this.matchesExcludePattern(relativePath, this.glad.options.exclude || [])
    })

    // Process the Swift files
    this.processSwiftFiles(filteredFiles)
  }

  /**
   * Check if a file path matches any exclude pattern
   * @param {string} filePath - Relative file path to check
   * @param {string|Array<string>} excludePatterns - Glob pattern(s) to match against
   * @returns {boolean} True if the file should be excluded
   */
  matchesExcludePattern (filePath, excludePatterns) {
    if (!Array.isArray(excludePatterns)) {
      excludePatterns = excludePatterns ? [excludePatterns] : []
    }

    return excludePatterns.some(pattern => {
      // Simple glob matching implementation
      // First escape special regex characters including *
      let regexPattern = pattern.replace(/[.+^${}()|[\]\\*?/]/g, '\\$&')

      // Then convert escaped glob patterns to regex
      regexPattern = regexPattern
        .replace(/\\\*\\\*\\\//g, '(.*/)?')  // **/ matches optional path (escaped **/)
        .replace(/\\\*\\\*/g, '.*')         // ** matches any path (escaped **)
        .replace(/\\\*/g, '[^/]*')          // * matches any character except / (escaped *)
        .replace(/\\\?/g, '[^/]')           // ? matches any single character except / (escaped ?)

      const regex = new RegExp('^' + regexPattern + '$')
      return regex.test(filePath)
    })
  }

  /**
   * Normalize the starting path from options.input
   * @returns {string}
   */
  normalizeStartingPath () {
    let startingPath = this.glad.options.input
    if (startingPath && startingPath !== '.') {
      startingPath = startingPath.replace(/\/$/, '') // Remove trailing slash if present
    } else {
      startingPath = './'
    }
    return startingPath.endsWith('/') ? startingPath : startingPath + '/'
  }

  /**
   * Parse Swift code using Tree-sitter
   * @param {string} content - Swift source code
   * @returns {Parser.Tree} Parsed AST tree
   */
  parseSwiftFile (content) {
    const parser = new Parser()
    parser.setLanguage(Swift)
    return parser.parse(content)
  }

  /**
   * Create the "Folder to Folder" to "File Container" mapping
   * @param {string} pathToFile
   */
  processFileAsContainer (pathToFile) {
    const listOfContainer = pathToFile.split('/').filter(token => !stringIsEmpty(token))
    this.glad.graph.rootNode.createContainerMappingBasedOnArray(listOfContainer, pathToFile)
  }

  /**
   * @param {string} pathToFile
   * @param {string} importFilePath
   */
  processFilesAsEdges (pathToFile, importFilePath) {
    this.glad.graph.upsertFileLinkByText(pathToFile, importFilePath)
  }

  /**
   * Process Swift files for dependency analysis
   * @param {Array<string>} files - Array of Swift file paths
   */
  processSwiftFiles (files) {
    if (files.length === 0) {
      return
    }

    if (!this.glad.options.silent) {
      console.info(`Analyzing ${files.length} files ...`)
    }

    if (this.glad.options.listFiles) {
      files.forEach((file) => {
        console.log('\t' + file)
      })
    }

    // Map: SymbolName -> FilePath
    const definitions = new Map()

    // Pass 1: Find type definitions using AST parsing
    files.forEach(file => {
      try {
        const content = fs.readFileSync(file, 'utf8')
        const tree = this.parseSwiftFile(content)

        // Extract type definitions from AST
        const typeDefinitions = this.extractTypeDefinitions(tree, content)
        typeDefinitions.forEach(typeName => {
          // If multiple files define same symbol, first one wins
          if (!definitions.has(typeName)) {
            definitions.set(typeName, file)
          }
        })
      } catch (error) {
        if (!this.glad.options.silent) {
          console.warn(`Warning: Failed to parse Swift file ${file}: ${error.message}`)
        }
      }
    })

    // Pass 2: Find type usages using AST parsing
    files.forEach(file => {
      try {
        this.glad.allFiles.add(file)
        this.processFileAsContainer(file)

        const content = fs.readFileSync(file, 'utf8')
        const tree = this.parseSwiftFile(content)

        // Extract type usages from AST
        const typeUsages = this.extractTypeUsages(tree, content)

        typeUsages.forEach(symbol => {
          // If we have a definition for this symbol
          if (definitions.has(symbol)) {
            const targetFile = definitions.get(symbol)
            // valid dependency if it's not the same file
            if (targetFile !== file) {
              this.glad.allFiles.add(targetFile)
              this.glad.allFileImports.push({ source: file, target: targetFile })
            }
          }
        })
      } catch (error) {
        if (!this.glad.options.silent) {
          console.warn(`Warning: Failed to analyze Swift file ${file}: ${error.message}`)
        }
      }
    })

    // Create edges between files
    this.glad.allFileImports.forEach(edge => {
      this.processFilesAsEdges(edge.source, edge.target)
    })
  }

  /**
   * Remove comments and string literals from Swift code to avoid false positives in definition detection
   * @param {string} content - The source code content
   * @returns {string} Content with comments and string literals removed
   */
  removeCommentsAndStrings (content) {
    let result = content
    let inString = false
    let inMultiLineString = false
    let inMultiLineComment = false
    let stringChar = ''
    let i = 0

    while (i < result.length) {
      const char = result[i]
      const nextChar = result[i + 1] || ''
      const nextNextChar = result[i + 2] || ''

      // Handle multi-line comments
      if (inMultiLineComment) {
        if (char === '*' && nextChar === '/') {
          // End of multi-line comment
          result = result.substring(0, i) + result.substring(i + 2)
          inMultiLineComment = false
          continue // Don't increment i since we removed characters
        }
        // Remove character inside multi-line comment
        result = result.substring(0, i) + result.substring(i + 1)
        continue // Don't increment i since we removed a character
      }

      // Handle multi-line strings
      if (inMultiLineString) {
        if (char === '"' && nextChar === '"' && nextNextChar === '"') {
          // End of multi-line string
          result = result.substring(0, i) + result.substring(i + 3)
          inMultiLineString = false
          continue // Don't increment i since we removed characters
        }
        // Remove character inside multi-line string
        result = result.substring(0, i) + result.substring(i + 1)
        continue // Don't increment i since we removed a character
      }

      // Handle regular strings
      if (inString) {
        if (char === stringChar && result[i - 1] !== '\\') {
          // End of string (not escaped)
          result = result.substring(0, i) + result.substring(i + 1)
          inString = false
          continue // Don't increment i since we removed a character
        } else if (char === '\\' && (result[i + 1] === '"' || result[i + 1] === "'")) {
          // Skip escaped quote character
          i++ // Skip the next character (the escaped quote)
        }
        // Remove character inside string
        result = result.substring(0, i) + result.substring(i + 1)
        continue // Don't increment i since we removed a character
      }

      // Check for start of multi-line comment
      if (char === '/' && nextChar === '*') {
        result = result.substring(0, i) + result.substring(i + 2)
        inMultiLineComment = true
        continue // Don't increment i since we removed characters
      }

      // Check for start of single-line comment
      if (char === '/' && nextChar === '/') {
        // Remove from // to end of line
        const endOfLine = result.indexOf('\n', i)
        if (endOfLine !== -1) {
          result = result.substring(0, i) + result.substring(endOfLine)
        } else {
          // Last line
          result = result.substring(0, i)
        }
        continue // Don't increment i since we modified the string
      }

      // Check for start of multi-line string
      if (char === '"' && nextChar === '"' && nextNextChar === '"') {
        result = result.substring(0, i) + result.substring(i + 3)
        inMultiLineString = true
        continue // Don't increment i since we removed characters
      }

      // Check for start of regular string
      if ((char === '"' || char === "'") && result[i - 1] !== '\\') {
        result = result.substring(0, i) + result.substring(i + 1)
        inString = true
        stringChar = char
        continue // Don't increment i since we removed a character
      }

      i++
    }

    return result
  }
}
