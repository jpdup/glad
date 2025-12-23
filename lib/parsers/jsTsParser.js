import * as TSMorph from 'ts-morph'

import { GLAD } from '../glad.js'
import { Container } from '../models/container.js'
import { stringIsEmpty } from '../util/strings.js'

/**
 * JavaScript/TypeScript parser for GLAD
 */
export class JsTsParser {
  /**
   * @param {GLAD} glad - The GLAD instance
   */
  constructor (glad) {
    this.glad = glad
  }

  /**
   * Generate dependencies from JavaScript/TypeScript source files
   */
  generateDependenciesFromSourceFiles () {
    this.glad.project = new TSMorph.Project({
      compilerOptions: {
        allowJs: true,
        target: TSMorph.ScriptTarget.ES2020
      }
    })

    const startingPath = this.normalizeStartingPath()

    if (!this.glad.options.silent) {
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

    if (this.glad.options.exclude) {
      const excludePatterns = Array.isArray(this.glad.options.exclude) ? this.glad.options.exclude : [this.glad.options.exclude]
      excludePatterns.forEach(pattern => {
        sourceFileGlobs.push('!' + pattern)
      })
    }

    this.glad.project.addSourceFilesAtPaths(sourceFileGlobs)

    const files = this.glad.project.getSourceFiles()
    this.processFiles(files, (file) => file.getFilePath())
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
        this.glad.allFiles.add(pathToFile)
        this.glad.allFiles.add(importFilePath)
        this.glad.allFileImports.push({ source: pathToFile, target: importFilePath })
      }
    })
  }

  /**
   * Merge matching .ts and .js files
   */
  mergeMatchingTSAndJSFiles () {
    const fileSetToMerge = []
    this.glad.allFiles.forEach(file => {
      if (file.endsWith('.js')) {
        const tsVersion = file.replace('.js', '.ts')
        if (this.glad.allFiles.has(tsVersion)) {
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
          this.glad.graph.edges.forEach(edge => {
            if (edge.source === nodeToMerge) {
              edge.source = nodeToKeep
            }
            if (edge.target === nodeToMerge) {
              edge.target = nodeToKeep
            }
          })
          nodeToKeep.name += '/.js'
        }
        this.glad.graph.rootNode.removeNodeDescendant(nodeToMerge)
      }
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
   * Create the "Folder to Folder" to "File Container" mapping
   * @param {string} pathToFile
   */
  processFileAsContainer (pathToFile) {
    const listOfContainer = pathToFile.split('/').filter(token => !stringIsEmpty(token))
    this.glad.graph.rootNode.createContainerMappingBasedOnArray(listOfContainer, pathToFile)
  }

  /**
   * Common file processing logic for JS/TS files
   * @param {Array} files - Array of TSMorph.SourceFile objects
   * @param {(file: object) => string} getPathFunc - Function to get path from file object
   */
  processFiles (files, getPathFunc) {
    if (files.length === 0) {
      return
    }

    if (!this.glad.options.silent) {
      console.info(`Analyzing ${files.length} files ...`)
    }

    if (this.glad.options.listFiles) {
      files.forEach((file) => {
        console.log('\t' + getPathFunc(file))
      })
    }

    // Files to Container model instances
    files.forEach(file => {
      this.getTargetFiles(file)
    })

    // Create containers (folder) tree from each file paths
    this.glad.allFiles.forEach(pathToFile => {
      this.processFileAsContainer(pathToFile)
    })

    // Create edges between files
    this.glad.allFileImports.forEach(edge => {
      this.processFilesAsEdges(edge.source, edge.target)
    })

    // Merge matching .ts & .js
    this.mergeMatchingTSAndJSFiles()
  }

  /**
   * @param {string} pathToFile
   * @param {string} importFilePath
   */
  processFilesAsEdges (pathToFile, importFilePath) {
    this.glad.graph.upsertFileLinkByText(pathToFile, importFilePath)
  }
}
