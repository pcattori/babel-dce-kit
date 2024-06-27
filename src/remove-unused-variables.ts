import {
  t,
  traverse,
  type Node,
  type NodePath,
  type BabelTypes,
  type ParseResult,
} from "./babel-esm"
import * as Identifier from "./identifier"

// TODO:
// - [ ] function: decl, expr, arrow
// - [ ] import
// - [ ] catch
// - [ ] class: decl, prop, method
// - [ ] ts: enum decl, interface decl, type alias decl

export default function (ast: ParseResult<BabelTypes.File>) {
  let changed: boolean

  do {
    changed = false
    traverse(ast, {
      Program(path) {
        path.scope.crawl()
      },
      VariableDeclarator(path) {
        let id = path.get("id")

        if (id.isIdentifier()) {
          if (!Identifier.isReferenced(id)) {
            path.remove()
            changed = true
          }
          return
        }

        if (id.isObjectPattern() || id.isArrayPattern()) {
          let vars = findVariablesInPattern(id)
          for (let v of vars) {
            if (Identifier.isReferenced(v)) continue

            let parent = v.parentPath
            changed = true

            if (parent.isObjectProperty()) {
              parent.remove()
              continue
            }

            if (parent.isArrayPattern()) {
              parent.node.elements[v.key as number] = null
              continue
            }

            if (parent.isAssignmentPattern()) {
              if (t.isObjectProperty(parent.parent)) {
                parent.parentPath?.remove()
                continue
              }
              if (t.isArrayPattern(parent.parent)) {
                parent.parent.elements[parent.key as number] = null
                continue
              }
              throw unsupported(parent)
            }

            if (parent.isRestElement()) {
              parent.remove()
              continue
            }

            throw unsupported(parent)
          }

          return
        }
      },
      ObjectPattern(path) {
        let isWithinDeclarator =
          path.find((p) => p.isVariableDeclarator()) !== null
        let isEmpty = path.node.properties.length === 0
        if (isWithinDeclarator && isEmpty) {
          sweepPattern(path)
          changed = true
        }
      },
      ArrayPattern(path) {
        let isWithinDeclarator =
          path.find((p) => p.isVariableDeclarator()) !== null
        let isEmpty = path.node.elements.every((e) => e === null)
        if (isWithinDeclarator && isEmpty) {
          sweepPattern(path)
          changed = true
        }
      },
    })
  } while (changed)
}

function findVariablesInPattern(
  patternPath: NodePath<t.ObjectPattern | t.ArrayPattern>,
): NodePath<t.Identifier>[] {
  let variables: NodePath<t.Identifier>[] = []
  function recurse(path: NodePath<Node | null>): void {
    if (path.isIdentifier()) {
      variables.push(path)
      return
    }
    if (path.isObjectPattern()) {
      return path.get("properties").forEach(recurse)
    }
    if (path.isObjectProperty()) {
      return recurse(path.get("value"))
    }
    if (path.isArrayPattern()) {
      let _elements = path.get("elements")
      return _elements.forEach(recurse)
    }
    if (path.isAssignmentPattern()) {
      return recurse(path.get("left"))
    }
    if (path.isRestElement()) {
      return recurse(path.get("argument"))
    }
    if (path.node === null) return
    throw unsupported(path)
  }
  recurse(patternPath)
  return variables
}

function sweepPattern(path: NodePath<t.ObjectPattern | t.ArrayPattern>) {
  let parent = path.parentPath
  if (parent.isVariableDeclarator()) {
    return parent.remove()
  }
  if (parent.isArrayPattern()) {
    parent.node.elements[path.key as number] = null
    return
  }
  if (parent.isObjectProperty()) {
    return parent.remove()
  }
  if (parent.isRestElement()) {
    return parent.remove()
  }
  if (parent.isAssignmentPattern()) {
    if (t.isObjectProperty(parent.parent)) {
      return parent.parentPath.remove()
    }
    if (t.isArrayPattern(parent.parent)) {
      parent.parent.elements[parent.key as number] = null
      return
    }
    throw unsupported(parent.parentPath)
  }
  throw unsupported(parent)
}

function unsupported(path: NodePath<Node | null>) {
  let type = path.node === null ? "null" : path.node.type
  return path.buildCodeFrameError(
    `[babel-dead-code-elimination] Unsupported node type: ${type}`,
  )
}
