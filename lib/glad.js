import fs from 'fs'

import chalk from 'chalk'

import { GLADContext } from './gladContext.js'
import { Graph } from './models/graph.js'
import { DotParser } from './parsers/parserDot.js'
import { FlutterDartParser } from './parsers/parserFlutterDart.js'
import { JsTsParser } from './parsers/parserJsTs.js'
import { SwiftParser } from './parsers/parserSwift.js'

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
    this.context = new GLADContext(options, new Graph())

    // Initialize parsers
    this.jsTsParser = new JsTsParser(this.context)
    this.swiftParser = new SwiftParser(this.context)
    this.flutterDartParser = new FlutterDartParser(this.context)
    this.parseDot = new DotParser(this.context)

    // Keep backward compatibility properties
    this.options = this.context.options
    this.graph = this.context.graph
    this.allFiles = this.context.allFiles
    this.allFileImports = this.context.allFileImports
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
}

/**
 * @param {string} text
 */
function printAction (text) {
  console.info(chalk.green(text))
}
