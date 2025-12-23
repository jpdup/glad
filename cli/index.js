#!/usr/bin/env node

import { createRequire } from 'module'

import chalk from 'chalk'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

import { GLAD } from '../lib/glad.js'
import { Constants } from '../lib/models/constants.js'
import { SwiftParser } from '../lib/parsers/parseSwift.js'

const require = createRequire(import.meta.url)
const fs = require('fs')

const packageJson = require('../package.json')

/**
 *
 */
async function main () {
  const arg = setupArguments()

  arg.useFullLayerWidth = false // Not yet ready for public use

  if (!arg.input) {
    arg.input = arg._[0]
  }

  if (arg.debug) {
    console.log(arg)
  }

  if (!arg.silent) {
    showTitle()
  }

  if (!arg.silent) {
    console.time('Completed')
  }

  const glad = new GLAD(arg)

  //
  // Determine the input context
  //

  if (arg.input && arg.input.endsWith('.dot')) {
    // DOT file input
    glad.parseDot.graphSvgFromDotFile()
  } else if (fs.existsSync('./pubspec.yaml')) {
    //  Dart Project
    await glad.flutterDartParser.graphSvgFromFlutterDart()
  } else if (SwiftParser.isSwiftProject(arg.input)) {
    // Swift Project
    glad.parseDot.graphSvgFromDotFile()
  } else {
    // NodeJS project
    glad.jsTsParser.generateDependenciesFromSourceFiles()
  }

  glad.context.processTheGraph()

  const totalNodes = glad.graph.getAllNodes().length
  const totalEdges = glad.graph.edges.length
  const orphanNodes = glad.graph.getOrphanNodes()
  const orphanCount = orphanNodes.length
  const upDependencyCount = glad.graph.getUpDependenciesCount()
  const circularCount = glad.graph.getCircularDependenciesCount()

  // Handle --orphans flag
  if (arg.orphans) {
    if (orphanCount === 0) {
      console.info('No orphan nodes found.')
    } else {
      console.info(`Found ${orphanCount} orphan node(s):`)
      orphanNodes.forEach(node => {
        console.info(`  - ${node.name}`)
      })
    }
  }

  if (!arg.silent) {
    console.info(`Nodes: ${totalNodes}, Edges: ${totalEdges}`)

    // Warning of orphan nodes
    if (orphanCount > 0) {
      console.error(chalk.yellow(`Orphan nodes: ${orphanCount}`))
    }

    // Warning of upward nodes

    if (upDependencyCount > 0) {
      console.error(chalk.yellow(`Upward dependencies: ${upDependencyCount}`))
    }

    // Error of circular edges
    if (circularCount > 0) {
      console.error(chalk.red(`Circular dependencies: ${circularCount}`))
    }
    console.timeEnd('Completed')
  }

  if (circularCount > 0) {
    process.exit(100)
  }
}

/**
 * Configures and parses command line arguments
 * @returns {object} Parsed arguments
 */
function setupArguments () {
  // noinspection JSUnresolvedFunction,JSUnresolvedVariable
  return yargs(hideBin(process.argv))
    .usage('Usage: glad < path | file.dot > [options]  "Generates an SVG layer diagram file based on your source code dependencies or DOT graph files"')
    .example('glad . --view layers -l --edges -hide', '">>> Produce a diagram with no edges, each layers are numbered."')
    .example('glad myGraph.dot --view layers -l', '">>> Generate layers diagram from DOT graph file."')
    .help('h')
    .alias('h', 'help')
    .option('align', {
      choices: [Constants.ALIGN_LEFT, Constants.ALIGN_CENTER, Constants.ALIGN_RIGHT],
      default: Constants.ALIGN_CENTER,
      description: 'Set the horizontal position of the nodes',
      type: 'string'
    })
    .option('debug', {
      default: false,
      description: 'For tech support',
      type: 'boolean'
    })
    .option('details', {
      alias: 'd',
      default: false,
      description: 'Show additional values for each folders',
      type: 'boolean'
    })
    .option('dev', {
      default: false,
      description: 'Show Dev dependencies',
      type: 'boolean'
    })
    .option(Constants.EDGES, {
      choices: ['files', 'folders'],
      default: 'files',
      description: 'Type of rendering for all edges',
      type: 'string'
    })
    .option('exclude', {
      alias: 'e',
      description: 'File glob patterns to exclude from the analysis, eg: "**/*.test.js" "**/AppLogger*"',
      type: 'array'
    })
    .option('externals', {
      alias: 'ex',
      default: false,
      description: 'Show external dependencies',
      type: 'boolean'
    })
    .option('input', {
      alias: 'i',
      description: 'File path to scan',
      type: 'string'
    })
    .option('json', {
      default: false,
      description: 'Output the graph to file called glad.json',
      type: 'boolean'
    })
    .option('layers', {
      alias: 'l',
      default: false,
      description: 'Display the layers background and numbers',
      type: 'boolean'
    })
    .option('lineEffect', {
      alias: 'le',
      choice: ['flat', 'outline', 'shadow'],
      default: 'flat',
      description: 'Special effect on the lines',
      type: 'string'
    })
    .option(Constants.LINES, {
      choices: [Constants.LINES_CURVE, Constants.LINES_STRAIT, Constants.LINES_ELBOW, Constants.LINES_ANGLE, Constants.LINES_HIDE, Constants.LINES_WARNINGS],
      default: Constants.LINES_CURVE,
      description: 'Type of rendering for all edges',
      type: 'string'
    })
    .option('listFiles', {
      default: false,
      description: 'List all input files found',
      type: 'boolean'
    })
    .option('orphans', {
      default: false,
      description: 'List all orphan nodes (nodes with no edges)',
      type: 'boolean'
    })
    .option('output', {
      alias: 'o',
      default: './glad.svg',
      description: 'File path to output svg',
      type: 'string'
    })
    .option('silent', {
      alias: 's',
      default: false,
      description: 'No output except for errors',
      type: 'boolean'
    })
    .option('view', {
      choices: ['poster', 'layers', 'grid'],
      default: 'poster',
      description: 'Type of diagram to generate',
      type: 'string'
    })
    // .version(true, 'Show version number', packageJson.version)
    .alias('v', 'version')
    .wrap(null)
    .epilog('for more information visit https://github.com/amzn/generate-layer-architecture-diagram')
    .argv
}

/**
 * Display the title of the application
 */
function showTitle () {
  console.info(chalk.blueBright('GLAD') + '   ' + chalk.blue(packageJson.version || ''))
}

main()
