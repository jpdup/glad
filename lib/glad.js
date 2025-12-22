import fs from 'fs'
import path from 'path'
import chalk from 'chalk'
import * as TSMorph from 'ts-morph'
import Parser from 'tree-sitter'
import Swift from 'tree-sitter-swift'
import { Graph } from './models/graph.js'
import { Container } from './models/container.js'
import { Constants } from './models/constants.js'
import { RenderAsPoster } from './render/renderAsPoster.js'
import { RenderAsGrid } from './render/renderAsGrid.js'
import { RenderAsLayers } from './render/renderAsLayers.js'
import { Layers } from './models/layers.js'
import { createLayers } from './render/renderBase.js'
import { stringIsEmpty } from './util/strings.js'

/**
 * @typedef Options
 * @property {boolean} listFiles - output the list of files used as input
 */

/**
 * @property {Options} options - Input arguments for controlling how to process and generate the graph
 * @property {Set<object>} allFiles - the files that we used for generating the graph
 * @property {Array<object>} allFileImports - all import files found in the sources
 * @property {Graph} graph = the single graph for holding all dependencies
 */
export class GLAD {
  /**
   * @param {object} options
   */
  constructor (options) {
    this.options = options
    this.graph = new Graph()
    this.allFiles = new Set()
    this.allFileImports = []
  }

  /**
   * The main files to import starts here
   */
  scanSourceFilesBuildGraphAndGenerateSvg () {
    this.generateDependenciesFromSourceFiles()
    this.processTheGraph()
  }

  processTheGraph () {
    if (this.graph.rootNode.sub.length === 0) {
      console.error('No files found')
      return
    }

    this.graph.prepareEdges()

    // Run layering to determine up dependencies (bad architecture)
    this.runLayeringForDependencyAnalysis()

    if (this.options.debug) {
      console.info('--------- Container Tree --------')
      this.graph.rootNode.printTree()

      console.info('----------- Edges ----------')
      this.graph.edges.print()
    }

    // Generate the Graph
    if (this.options.json) {
      this.generateJSON()
    }

    // Generate the SVG
    this.generateSVG()
  }

  /**
   * THe logic for creating the graph starts here
   */
  generateDependenciesFromSourceFiles () {
    this.project = new TSMorph.Project({
      compilerOptions: {
        target: TSMorph.ScriptTarget.ES2020,
        allowJs: true
      }
    })

    const startingPath = this.normalizeStartingPath()

    if (!this.options.silent) {
      console.info(`Searching "${startingPath}" ...`)
    }

    const sourceFileGlobs = [
      '!**/node_modules/**/*',
      '!**/bin/**/*',
      '!**/cdk.out/**/*',
      '!**/bin/**/*',
      '!**/build/**/*',
      '!**/*.d.js',
      '!**/*.d.ts',
      '!**/*.d.tsx',
      startingPath + '**/*.js',
      startingPath + '**/*.ts',
      startingPath + '**/*.tsx'
    ]

    if (this.options.exclude) {
      const excludePatterns = Array.isArray(this.options.exclude) ? this.options.exclude : [this.options.exclude]
      excludePatterns.forEach(pattern => {
        sourceFileGlobs.push('!' + pattern)
      })
    }

    this.project.addSourceFilesAtPaths(sourceFileGlobs)

    const files = this.project.getSourceFiles()
    this.processFiles(files, (file) => file.getFilePath())
  }

  /**
   * Create a JSON file based on the graph
   */
  generateJSON () {
    this.writeOutputFile('./glad.json', this.graph.serialize())
  }

  /**
   * Create an SVG file from the Renderer
   */
  generateSVG () {
    const renderAs = this.getRendererBasedOnUserChoice()
    const svgSource = renderAs.getSVG(this.graph, this.options)
    this.writeOutputFile(this.options.output, svgSource)
  }

  /**
   * Write content to a file with consistent error handling and logging
   * @param {string} filePath - Path to the output file
   * @param {string} content - Content to write
   */
  writeOutputFile (filePath, content) {
    if (!this.options.silent) {
      printAction(filePath)
    }
    fs.writeFileSync(filePath, content, function (err) {
      if (err) {
        return console.error(err)
      }
    })
  }

  /**
   * Parse DOT format string into nodes and edges
   * @param {string} content - DOT format string
   * @returns {object} Object with nodes array and edges array
   */
  parseDotContent (content) {
    const nodes = new Set()
    const edges = []

    // Remove comments (lines starting with # or //, and /* */ blocks)
    let cleanedContent = content
      .split('\n')
      .filter(line => {
        const trimmed = line.trim()
        return trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('//')
      })
      .join('\n')

    // Remove /* */ comments
    cleanedContent = cleanedContent.replace(/\/\*[\s\S]*?\*\//g, '')

    // More robust regex-based DOT parser
    // Match digraph declarations and graph content
    const digraphMatch = cleanedContent.match(/digraph\s+["\w]+\s*\{([\s\S]*)\}/)
    if (!digraphMatch) {
      throw new Error('Invalid DOT format: no digraph found')
    }

    const graphContent = digraphMatch[1]

    // Remove subgraph blocks (we'll handle them later if needed)
    const processedContent = graphContent.replace(/subgraph\s+[^}]*\{[^}]*\}/g, '')

    // Match nodes with optional attributes: "node_name" [label="..."];
    const nodeRegex = /"([^"]+)"\s*\[([^\]]*)\]\s*;/g
    let match
    while ((match = nodeRegex.exec(processedContent)) !== null) {
      const nodeName = match[1]
      nodes.add(nodeName)
    }

    // Also match simple nodes without attributes: "node_name"; or node_name;
    const simpleNodeRegex = /"([^"]+)"\s*;|\b(\w+)\s*;/g
    while ((match = simpleNodeRegex.exec(processedContent)) !== null) {
      const nodeName = match[1] || match[2] // Either quoted or unquoted
      nodes.add(nodeName)
    }

    // Match edges with optional attributes: "source" -> "target" [style=dashed];
    const edgeRegex = /"([^"]+)"\s*->\s*"([^"]+)"(?:\s*\[([^\]]*)\])?\s*;/g
    while ((match = edgeRegex.exec(processedContent)) !== null) {
      const source = match[1]
      const target = match[2]
      edges.push({ source, target })
    }

    // Fallback: match simpler edge format if quoted version fails
    if (edges.length === 0) {
      const simpleEdgeRegex = /(\w+)\s*->\s*(\w+)\s*(?:\[[^\]]*\])?\s*;/g
      while ((match = simpleEdgeRegex.exec(processedContent)) !== null) {
        const source = match[1]
        const target = match[2]
        nodes.add(source)
        nodes.add(target)
        edges.push({ source, target })
      }
    }

    return {
      nodes: Array.from(nodes),
      edges
    }
  }

  /**
   * Parse DOT format content and build graph from it
   * @param {string} dotContent - The DOT format string
   */
  loadGraphFromDot (dotContent) {
    const parsed = this.parseDotContent(dotContent)

    // Apply exclude patterns to filter nodes
    let filteredNodes = parsed.nodes
    if (this.options.exclude) {
      filteredNodes = parsed.nodes.filter(nodeName => {
        const shouldExclude = this.matchesExcludePattern(nodeName, this.options.exclude)
        if (!this.options.silent && shouldExclude) {
          console.info(`Excluding node: ${nodeName}`)
        }
        return !shouldExclude
      })
    }

    // Create nodes (only those not excluded)
    filteredNodes.forEach(nodeName => {
      this.graph.rootNode.upsert(nodeName).setAsLeaf(nodeName)
    })

    // Create edges (only between nodes that weren't excluded)
    const filteredNodeSet = new Set(filteredNodes)
    parsed.edges.forEach(edge => {
      // Only create edge if both source and target nodes are not excluded
      if (filteredNodeSet.has(edge.source) && filteredNodeSet.has(edge.target)) {
        this.graph.upsertFileLinkByText(edge.source, edge.target)
      }
    })

    this.processTheGraph()
  }

  /**
   * Process DOT files for graph generation
   */
  scanDotFileBuildGraphAndGenerateSvg () {
    const dotFilePath = this.options.input

    if (!fs.existsSync(dotFilePath)) {
      throw new Error(`DOT file not found: ${dotFilePath}`)
    }

    if (!this.options.silent) {
      console.info(`Reading DOT file: ${dotFilePath}`)
    }

    const dotContent = fs.readFileSync(dotFilePath, 'utf8')
    this.loadGraphFromDot(dotContent)
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
      // Check for class, struct, enum declarations
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
   * Normalize the starting path from options.input
   * @returns {string}
   */
  normalizeStartingPath () {
    let startingPath = this.options.input
    if (startingPath && startingPath !== '.') {
      startingPath = startingPath.replace(/\/$/, '') // Remove trailing slash if present
    } else {
      startingPath = './'
    }
    return startingPath.endsWith('/') ? startingPath : startingPath + '/'
  }

  /**
   * Common file processing logic for both JS/TS and Swift files
   * @param {Array} files - Array of file objects (TSMorph.SourceFile or string paths)
   * @param {(file: object) => string} getPathFunc - Function to get path from file object
   */
  processFiles (files, getPathFunc) {
    if (files.length === 0) {
      return
    }

    if (!this.options.silent) {
      console.info(`Analyzing ${files.length} files ...`)
    }

    if (this.options.listFiles) {
      files.forEach((file) => {
        console.log('\t' + getPathFunc(file))
      })
    }

    // Files to Container model instances
    files.forEach(file => {
      this.getTargetFiles(file)
    })

    // Create containers (folder) tree from each file paths
    this.allFiles.forEach(pathToFile => {
      this.processFileAsContainer(pathToFile)
    })

    // Create edges between files
    this.allFileImports.forEach(edge => {
      this.processFilesAsEdges(edge.source, edge.target)
    })

    // Merge matching .ts & .js (only for JS/TS files)
    if (files[0] && typeof files[0] !== 'string') {
      this.mergeMatchingTSAndJSFiles()
    }
  }

  /**
   * Merge matching .ts and .js files
   */
  mergeMatchingTSAndJSFiles () {
    const fileSetToMerge = []
    this.allFiles.forEach(file => {
      if (file.endsWith('.js')) {
        const tsVersion = file.replace('.js', '.ts')
        if (this.allFiles.has(tsVersion)) {
          fileSetToMerge.push({ js: file, ts: tsVersion })
        }
      }
    })

    fileSetToMerge.forEach(filesToMerge => {
      const nodeToKeep = Container.getLeafNodeByUserData(filesToMerge.ts)
      if (nodeToKeep) {
        const nodeToMerge = Container.getLeafNodeByUserData(filesToMerge.js)
        if (nodeToMerge) {
          nodeToKeep.targetNodes.concat(nodeToMerge.targetNodes)
          nodeToKeep.sourceNodes.concat(nodeToMerge.sourceNodes)

          // redirect all edges to the merged node
          this.graph.edges.forEach(edge => {
            if (edge.source === nodeToMerge) {
              edge.source = nodeToKeep
            }
            if (edge.target === nodeToMerge) {
              edge.target = nodeToKeep
            }
          })
          nodeToKeep.name += '/.js'
        }
        this.graph.rootNode.removeNodeDescendant(nodeToMerge)
      }
    })
  }

  /**
   * @param {TSMorph.SourceFile} sourceFile
   */
  getTargetFiles (sourceFile) {
    const pathToFile = sourceFile.getFilePath()
    const importingFiles = sourceFile.getReferencedSourceFiles()
    importingFiles.forEach(importFile => {
      const importFilePath = importFile.getFilePath()
      if (importFilePath.indexOf('node_modules') > -1) {
        // skip any reference to node_modules
      } else {
        this.allFiles.add(pathToFile)
        this.allFiles.add(importFilePath)
        this.allFileImports.push({ source: pathToFile, target: importFilePath })
      }
    })
  }

  /**
   * Create the "Folder to Folder" to "File Container" mapping
   * @param {string} pathToFile
   */
  processFileAsContainer (pathToFile) {
    const listOfContainer = pathToFile.split('/').filter(token => !stringIsEmpty(token))
    this.graph.rootNode.createContainerMappingBasedOnArray(listOfContainer, pathToFile)
  }

  /**
   * @param {string} pathToFile
   * @param {string} importFilePath
   */
  processFilesAsEdges (pathToFile, importFilePath) {
    this.graph.upsertFileLinkByText(pathToFile, importFilePath)
  }

  /**
   * Run layering algorithm to determine which edges are "up dependencies" (bad architecture)
   */
  runLayeringForDependencyAnalysis () {
    const nodesToRender = this.graph.getAllNodesInEdges()
    if (nodesToRender.length === 0) return

    const layers = new Layers()

    // Use the same layering logic as the visualization
    createLayers(this.graph, layers, nodesToRender, this.options)

    // Now simulate what the renderer would do - mark edges as up dependencies
    // based on the y-coordinates that would be assigned
    this.simulateRenderingToMarkUpDependencies(layers)
  }

  /**
   * Simulate rendering to determine which edges would be orange (up dependencies)
   * @param {Layers} layers
   */
  simulateRenderingToMarkUpDependencies (layers) {
    // For layers view: higher layer index = lower on screen (higher y)
    // Orange lines occur when source y >= target y, i.e., sourceLayer >= targetLayer

    // For each edge, determine if it would be drawn as orange
    this.graph.edges.forEach(edge => {
      if (!edge.isCircular) {
        // Find which layer each node is in
        let sourceLayerIndex = -1
        let targetLayerIndex = -1

        layers.forEach((layer, index) => {
          if (layer.nodes.includes(edge.source)) {
            sourceLayerIndex = index
          }
          if (layer.nodes.includes(edge.target)) {
            targetLayerIndex = index
          }
        })

        // If source is in a higher or equal layer index than target,
        // it would be drawn as orange (up dependency)
        if (sourceLayerIndex >= targetLayerIndex && sourceLayerIndex !== -1 && targetLayerIndex !== -1) {
          edge.isUpDependency = true
        }
      }
    })
  }

  /**
   * What diagrams to render?
   * @returns {RenderAsGrid|RenderAsLayers|RenderAsPoster}
   */
  getRendererBasedOnUserChoice () {
    switch (this.options.view) {
      case Constants.VIEW_GRID:
        return new RenderAsGrid()

      case Constants.VIEW_LAYERS:
        return new RenderAsLayers()

      case Constants.VIEW_POSTER:
      default:
        return new RenderAsPoster()
    }
  }

  /**
   * Process Swift files for dependency analysis
   * @param {Array<string>} files - Array of Swift file paths
   */
  processSwiftFiles (files) {
    if (files.length === 0) {
      return
    }

    if (!this.options.silent) {
      console.info(`Analyzing ${files.length} files ...`)
    }

    if (this.options.listFiles) {
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
        if (!this.options.silent) {
          console.warn(`Warning: Failed to parse Swift file ${file}: ${error.message}`)
        }
      }
    })

    // Pass 2: Find type usages using AST parsing
    files.forEach(file => {
      try {
        this.allFiles.add(file)
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
              this.allFiles.add(targetFile)
              this.allFileImports.push({ source: file, target: targetFile })
            }
          }
        })
      } catch (error) {
        if (!this.options.silent) {
          console.warn(`Warning: Failed to analyze Swift file ${file}: ${error.message}`)
        }
      }
    })

    // Create edges between files
    this.allFileImports.forEach(edge => {
      this.processFilesAsEdges(edge.source, edge.target)
    })
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
   * Generate dependencies from Swift files
   */
  generateDependenciesFromSwiftFiles () {
    const startingPath = this.normalizeStartingPath()

    if (!this.options.silent) {
      console.info(`Searching "${startingPath}" for Swift files...`)
    }

    // Find all Swift files
    const swiftFiles = this.findFilesRecursively(startingPath, '.swift')

    // Filter out excluded files
    const filteredFiles = swiftFiles.filter(file => {
      const relativePath = path.relative(startingPath, file)
      return !this.matchesExcludePattern(relativePath, this.options.exclude || [])
    })

    // Process the Swift files
    this.processSwiftFiles(filteredFiles)
  }

  /**
   * The main files to import starts here for Swift
   */
  scanSwiftSourceFilesBuildGraphAndGenerateSvg () {
    this.generateDependenciesFromSwiftFiles()
    this.processTheGraph()
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
   * CLean up the container name of Flutter apps
   * @param {object} module
   * @returns {string}
   */
  transFromFlutterContainerName (module) {
    let containerName = module.source
    if (module.kind === 'dev') {
      containerName = 'dev'
    } else
      if (module.source === 'git' || module.source === 'path') {
        containerName = 'direct'
      } else
        if (module.kind === 'transitive') {
          containerName = 'transitive'
        } else
          if (module.kind === 'direct' || module.source === 'sdk') {
            containerName = 'direct'
          }
    return containerName
  }

  /**
   *
   * @param {object} pubspecObject
   */
  loadGraphFromFlutterDependencies (pubspecObject) {
    // Add all the container nodes
    pubspecObject.packages.forEach(module => {
      const containerName = this.transFromFlutterContainerName(module)
      if (module.name !== 'flutter') {
        this.upsertInContainer(containerName, module.name, module.version)
      }
    })

    // Add all the edges
    pubspecObject.packages.forEach(module => {
      module.dependencies.forEach(depName => {
        const containerName = this.transFromFlutterContainerName(module)
        if (module.name !== 'flutter' && depName !== 'flutter') {
          this.ensureContainmentAndLinkTheseTwo(containerName, module.name, module.version, depName)
        }
      })
    })

    if (this.options.externals === false) {
      const container = this.graph.rootNode.getByText('transitive')
      if (container) {
        this.graph.dropContainerAndInternalNodesAndLinks(container)
      }
    }

    if (this.options.dev === false) {
      const container = this.graph.rootNode.getByText('dev')
      if (container) {
        this.graph.dropContainerAndInternalNodesAndLinks(container)
      }
    }

    // this.graph.edges.forEach(edge => {
    //   printAction(edge.target.toString())
    // })

    this.processTheGraph()
  }

  ensureContainmentAndLinkTheseTwo (containerName, sourceName, version, targetName) {
    // printAction('-------- ' + containerName + ' ' + sourceName + ' ' + targetName)

    this.upsertInContainer(containerName, sourceName, version)
    this.graph.upsertFileLinkByText(sourceName, targetName)
  }

  convertAllExternalToSDK (containerName, nodeName) {
    if (containerName === 'hosted') {
      containerName = 'sdk'
    }

    if (containerName === 'sdk') {
      nodeName = 'skd_components'
    }

    return nodeName
  }

  upsertInContainer (containerName, nodeName, nodeVersion = null) {
    let containerFound = this.graph.rootNode.getByText(containerName)
    if (!containerFound) {
      containerFound = this.graph.rootNode.upsert(containerName)
    }

    if (containerFound) {
      containerFound.upsert(nodeName, nodeVersion).setAsLeaf(nodeName)
    }
  }
}

/**
 * @param {string} text
 */
function printAction (text) {
  console.info(chalk.green(text))
}
