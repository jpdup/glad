import fs from 'fs'
import path from 'path'
import chalk from 'chalk'
import * as TSMorph from 'ts-morph'
import { Graph } from './models/graph.js'
import { Container } from './models/container.js'
import { Constants } from './models/constants.js'
import { RenderAsPoster } from './render/renderAsPoster.js'
import { RenderAsGrid } from './render/renderAsGrid.js'
import { RenderAsLayers } from './render/renderAsLayers.js'
import { Layers } from './models/layers.js'
import { createLayers } from './render/renderBase.js'
import { ensureEndsWith, ensureNotEndingWith, stringIsEmpty } from './util/strings.js'

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

    let startingPath = this.options.input
    if (startingPath && startingPath !== '.') {
      startingPath = ensureNotEndingWith(startingPath, '.')
    } else {
      startingPath = './'
    }
    startingPath = ensureEndsWith(startingPath, '/')

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
      startingPath + '**/*.js',
      startingPath + '**/*.ts'
    ]

    if (this.options.exclude) {
      sourceFileGlobs.push('!' + this.options.exclude)
    }

    this.project.addSourceFilesAtPaths(sourceFileGlobs)

    const files = this.project.getSourceFiles()

    if (files.length === 0) {
      return
    }

    if (!this.options.silent) {
      console.info(`Analyzing ${files.length} files ...`)
    }

    if (this.options.listFiles) {
      files.forEach((file) => {
        console.log('\t' + file.getFilePath())
      })
    }

    // Files to Container model instances
    files.forEach(sourceFile => {
      // update the current value in your application..
      this.getTargetFiles(sourceFile)
    })

    // Create containers (folder) tree from each file paths
    this.allFiles.forEach(pathToFile => {
      this.processFileAsContainer(pathToFile)
    })

    // Create edges between files
    this.allFileImports.forEach(edge => {
      this.processFilesAsEdges(edge.source, edge.target)
    })

    // Merge matching .ts & .js
    {
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
   * Create a JSON file based on the graph
   */
  generateJSON () {
    if (!this.options.silent) {
      printAction('./poster.json')
    }
    const graphAsText = this.graph.serialize()
    fs.writeFileSync('poster.json', graphAsText, function (err) {
      if (err) {
        return console.error(err)
      }
    })
  }

  /**
   * Create an SVG file from the Renderer
   */
  generateSVG () {
    if (!this.options.silent) {
      printAction(this.options.output)
    }

    const renderAs = this.getRendererBasedOnUserChoice()

    const svgSource = renderAs.getSVG(this.graph, this.options)

    fs.writeFileSync(this.options.output, svgSource, function (err) {
      if (err) {
        return console.error(err)
      }
    })
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
   * The main files to import starts here for Swift
   */
  scanSwiftSourceFilesBuildGraphAndGenerateSvg () {
    this.generateDependenciesFromSwiftFiles()
    this.processTheGraph()
  }

  /**
   * Scan Swift files to generate graph
   */
  generateDependenciesFromSwiftFiles () {
    let startingPath = this.options.input
    if (startingPath && startingPath !== '.') {
      startingPath = ensureNotEndingWith(startingPath, '.')
    } else {
      startingPath = './'
    }

    if (!this.options.silent) {
      console.info(`Searching "${startingPath}" ...`)
    }

    const files = this.findFilesRecursively(startingPath, '.swift')

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
    // Map: FilePath -> Content
    const fileContents = new Map()

    // Pass 1: Find definitions
    files.forEach(file => {
      const content = fs.readFileSync(file, 'utf8')
      fileContents.set(file, content)

      // Regex to capture class, struct, enum, protocol, actor names
      // Looks for "struct Name" etc.
      const defRegex = /\b(?:class|struct|enum|protocol|actor)\s+(\w+)/g
      let match
      while ((match = defRegex.exec(content)) !== null) {
        const name = match[1]
        // If multiple files define same symbol, first one wins (or we could track duplicates)
        // Ignoring extensions for definition source
        if (!definitions.has(name)) {
          definitions.set(name, file)
        }
      }
    })

    // Pass 2: Find usages
    files.forEach(file => {
      const content = fileContents.get(file)
      this.allFiles.add(file)
      this.processFileAsContainer(file)

      // Find all capitalized words which might be types
      const usageRegex = /\b([A-Z]\w*)\b/g
      const usedSymbols = new Set()
      let match
      while ((match = usageRegex.exec(content)) !== null) {
        usedSymbols.add(match[1])
      }

      usedSymbols.forEach(symbol => {
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
    })

    // Create edges between files
    this.allFileImports.forEach(edge => {
      this.processFilesAsEdges(edge.source, edge.target)
    })
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
