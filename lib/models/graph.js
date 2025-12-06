import { Container } from './container.js'
import { Edge } from './edge.js'
import { Edges } from './edges.js'
import { stringIsEmpty } from '../util/strings.js'

/**
 * @property {Container} rootNode - main starting node
 * @property {Edges} edges = the starting edges in this graph
 */
export class Graph {
  /**
   * New empty graph
   */
  constructor () {
    this.rootNode = new Container()
    this.edges = new Edges()
  }

  /**
   * @returns {Array<Container>}
   */
  getAllNodes () {
    const dataSet = new Set()
    this.rootNode.cumulateNodeInDataSet(dataSet)
    return Array.from(dataSet)
  }

  /**
   * @returns {Array<Container>}
   */
  getAllNodesInEdges () {
    const dataSet = new Set()
    this.edges.forEach(edge => {
      dataSet.add(edge.source)
      dataSet.add(edge.target)
    })
    return Array.from(dataSet)
  }

  /**
   * @returns {Container|null}
   */
  getFirstNonCommonRoot () {
    return this.rootNode.getFirstNonCommonRoot()
  }

  /**
   * @param {Container} nodeSource
   * @param {Container} nodeTarget
   * @returns {Edge}
   */
  upsertEdge (nodeSource, nodeTarget) {
    nodeSource.rollupIsCallingThisNode(nodeTarget)
    nodeTarget.rollupIsBeingCalledByThisNode(nodeSource)

    return this.edges.upsertEdge(nodeSource, nodeTarget)
  }

  /**
   * @param {Container} containerNode
   */
  dropContainerAndInternalNodesAndLinks (containerNode) {
    const nodes = containerNode.getFlatListOfNodes()
    // first drop any edge to these nodes
    nodes.forEach(node => {
      this.edges.dropEdgeWithThisTarget(node)
      this.edges.dropEdgeWithThisSource(node)
    })
    this.rootNode.removeNodeDescendant(containerNode)
  }

  /**
   * @param {string} textA
   * @param {string} textB
   * @returns { Edge }
   */
  upsertFileLinkByText (textA, textB) {
    let fileSource = Container.getLeafNodeByUserData(textA)
    if (!fileSource) {
      fileSource = new Container(null, textA)
      fileSource.setAsLeaf(textA)
    }

    let fileTarget = Container.getLeafNodeByUserData(textB)
    if (!fileTarget) {
      fileTarget = new Container(null, textB)
      fileTarget.setAsLeaf(textB)
    }
    return this.upsertEdge(fileSource, fileTarget)
  }

  /**
   * return true if both node are connected to each other
   * @param {Container} nodeA
   * @param {Container} nodeB
   * @returns {boolean}
   */
  isCircular (nodeA, nodeB) {
    if (nodeA === nodeB) {
      return false
    }

    const edge1 = this.edges.getEdge(nodeA, nodeB)
    const edge2 = this.edges.getEdge(nodeB, nodeA)

    return !!(edge1 && edge2)
  }

  /**
   * Sort and detect problems
   */
  prepareEdges () {
    this.edges.sortByName()
    this.edges.forEach(edge => {
      edge.isCircular = this.isCircular(edge.source, edge.target)
      edge.isUpDependency = false // Will be set by detectUpDependencies
    })

    this.detectUpDependencies()
  }

  /**
   * Detect edges that violate layer architecture (lower layer depending on upper layer)
   */
  detectUpDependencies () {
    // Run a simplified layering algorithm to assign layers
    const layers = this.assignLayers()

    // Check each edge to see if it violates layer hierarchy
    this.edges.forEach(edge => {
      if (!edge.isCircular) {
        const sourceLayer = layers.get(edge.source)
        const targetLayer = layers.get(edge.target)

        // If source is in a lower layer than target, it's a bad dependency
        // (lower layer depending on upper layer)
        if (sourceLayer > targetLayer) {
          edge.isUpDependency = true
        }
      }
    })
  }

  /**
   * Assign layers to nodes using a simplified topological sort
   * @returns {Map<Container, number>} Map of node to layer index (0 = top)
   */
  assignLayers () {
    const layers = new Map()
    const visited = new Set()
    const visiting = new Set()

    // Get all nodes that have edges
    const nodes = this.getAllNodesInEdges()

    // Process nodes with no incoming edges first (top layer)
    const processNode = (node, layer) => {
      if (visited.has(node)) return
      if (visiting.has(node)) return // Cycle detected, but we'll handle this

      visiting.add(node)

      // Find all nodes that this node depends on (outgoing edges)
      const dependencies = this.edges
        .filter(edge => edge.source === node)
        .map(edge => edge.target)

      // Process dependencies first
      dependencies.forEach(dep => {
        processNode(dep, layer)
      })

      visiting.delete(node)
      visited.add(node)

      // Assign the highest layer this node can be in
      const existingLayer = layers.get(node)
      if (existingLayer === undefined || layer > existingLayer) {
        layers.set(node, layer)
      }
    }

    // Start with nodes that have no incoming dependencies
    nodes.forEach(node => {
      if (!this.edges.some(edge => edge.target === node)) {
        processNode(node, 0)
      }
    })

    // Process remaining nodes
    nodes.forEach(node => {
      if (!visited.has(node)) {
        processNode(node, 0)
      }
    })

    return layers
  }

  /**
   * @returns {boolean}
   */
  getHasCircularDependencies () {
    return this.edges.some(edge => edge.isCircular)
  }

  /**
   * @returns {number}
   */
  getCircularDependenciesCount () {
    return this.edges.filter(edge => edge.isCircular).length
  }

  /**
   * @returns {number}
   */
  getUpDependenciesCount () {
    return this.edges.filter(edge => edge.isUpDependency).length
  }

  /**
   * used for sorting, compare the number of calls from ListOfNodesA against the ListOfNodesB
   * @param {Array<Container>} ListOfNodesA
   * @param {Array<Container>} ListOfNodesB
   * @returns {{in: number, weight: number, out: number}}
   */
  getOutIn (ListOfNodesA, ListOfNodesB) {
    ListOfNodesA = Container.getFlatterList(ListOfNodesA)
    ListOfNodesB = Container.getFlatterList(ListOfNodesB)

    let totalPointerAtoB = 0
    ListOfNodesA.forEach(node => {
      totalPointerAtoB += this.edges.getTotalMatchingTargetForThisSource(node, ListOfNodesB)
    })

    let totalPointerBtoA = 0
    ListOfNodesB.forEach(node => {
      totalPointerBtoA += this.edges.getTotalMatchingTargetForThisSource(node, ListOfNodesA)
    })
    let weight
    if (totalPointerBtoA === 0 && totalPointerAtoB > 0) {
      weight = 1000000 + totalPointerBtoA
    } else {
      weight = (totalPointerAtoB * 100000) + (totalPointerBtoA * -1000)
    }
    return { out: totalPointerAtoB, in: totalPointerBtoA, weight }
  }

  /**
   * @returns {string}
   */
  serialize () {
    // ------------------------------------------
    // get all the unique nodes
    let allNodes = new Set()
    this.getAllNodes().forEach(n => {
      if (!stringIsEmpty(n.data)) {
        allNodes.add(n.data)
      }
    })
    allNodes = [...allNodes].sort()

    // ------------------------------------------
    // get all the edges
    let allEdges = []
    this.edges.forEach(edge => {
      const edgeDetail = { source: edge.source.data, target: edge.target.data }
      allEdges.push(edgeDetail)
    })

    // sort source + target
    allEdges = allEdges.sort((a, b) => {
      const result = a.source.localeCompare(b.source)
      if (result === 0) {
        return a.target.localeCompare(b.target)
      }
      return result
    })

    // ------------------------------------------
    // return the object
    const object = {
      nodes: allNodes,
      edges: allEdges
    }
    return JSON.stringify(object)
  }
}
