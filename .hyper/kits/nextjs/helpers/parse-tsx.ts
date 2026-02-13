/**
 * Parse TypeScript/TSX files to extract component information
 */

import { readFileSync } from 'fs'

export interface TypeInfo {
  name: string
  type: string
  optional: boolean
  description?: string
}

export interface ExportInfo {
  name: string
  kind: 'function' | 'const' | 'class' | 'type' | 'interface'
  isDefault: boolean
}

export interface ParsedComponent {
  name: string
  isClientComponent: boolean
  isServerComponent: boolean
  props: TypeInfo[]
  exports: ExportInfo[]
  imports: string[]
  hasUseClient: boolean
  hasUseServer: boolean
}

/**
 * Parse a TSX/TS file and extract component information
 */
export function parseTsxFile(filePath: string): ParsedComponent {
  const content = readFileSync(filePath, 'utf-8')

  const result: ParsedComponent = {
    name: '',
    isClientComponent: false,
    isServerComponent: false,
    props: [],
    exports: [],
    imports: [],
    hasUseClient: content.includes("'use client'") || content.includes('"use client"'),
    hasUseServer: content.includes("'use server'") || content.includes('"use server"'),
  }

  result.isClientComponent = result.hasUseClient
  result.isServerComponent = result.hasUseServer

  // Extract imports
  result.imports = extractImports(content)

  // Extract exports
  result.exports = extractExports(content)

  // Find main component name
  const defaultExport = result.exports.find((e) => e.isDefault)
  if (defaultExport) {
    result.name = defaultExport.name
  }

  // Extract props if there's a Props interface/type
  result.props = extractProps(content, result.name)

  return result
}

/**
 * Extract import statements from source code
 */
export function extractImports(content: string): string[] {
  const imports: string[] = []
  const importRegex = /import\s+(?:{[^}]+}|[^{}\s]+|\*\s+as\s+\w+)\s+from\s+['"]([^'"]+)['"]/g
  let match: RegExpExecArray | null

  while ((match = importRegex.exec(content)) !== null) {
    imports.push(match[1])
  }

  return imports
}

/**
 * Extract export statements from source code
 */
export function extractExports(content: string): ExportInfo[] {
  const exports: ExportInfo[] = []

  // Default exports
  const defaultExportRegex =
    /export\s+default\s+(?:function|class|const)?\s*(\w+)|export\s+{\s*(\w+)\s+as\s+default\s*}/g
  let match: RegExpExecArray | null

  while ((match = defaultExportRegex.exec(content)) !== null) {
    const name = match[1] || match[2]
    if (name) {
      exports.push({
        name,
        kind: detectExportKind(content, name),
        isDefault: true,
      })
    }
  }

  // Named exports
  const namedExportRegex =
    /export\s+(?:const|let|var|function|class|type|interface)\s+(\w+)/g

  while ((match = namedExportRegex.exec(content)) !== null) {
    const name = match[1]
    exports.push({
      name,
      kind: detectExportKind(content, name),
      isDefault: false,
    })
  }

  // Re-exports
  const reExportRegex = /export\s+{\s*([^}]+)\s*}/g
  while ((match = reExportRegex.exec(content)) !== null) {
    const names = match[1].split(',').map((n) => n.trim().split(/\s+as\s+/)[0])
    names.forEach((name) => {
      if (name && !exports.some((e) => e.name === name)) {
        exports.push({
          name,
          kind: detectExportKind(content, name),
          isDefault: false,
        })
      }
    })
  }

  return exports
}

/**
 * Detect the kind of export (function, const, class, type, interface)
 */
function detectExportKind(
  content: string,
  name: string,
): 'function' | 'const' | 'class' | 'type' | 'interface' {
  if (new RegExp(`\\bfunction\\s+${name}\\b`).test(content)) return 'function'
  if (new RegExp(`\\bclass\\s+${name}\\b`).test(content)) return 'class'
  if (new RegExp(`\\btype\\s+${name}\\b`).test(content)) return 'type'
  if (new RegExp(`\\binterface\\s+${name}\\b`).test(content)) return 'interface'
  if (new RegExp(`\\bconst\\s+${name}\\b`).test(content)) return 'const'
  return 'const'
}

/**
 * Extract props from a Props interface or type
 */
export function extractProps(content: string, componentName: string): TypeInfo[] {
  const props: TypeInfo[] = []
  const propsInterfaceName = `${componentName}Props`

  // Find interface/type definition
  const interfaceRegex = new RegExp(
    `(?:interface|type)\\s+${propsInterfaceName}\\s*=?\\s*{([^}]+)}`,
    's',
  )
  const match = content.match(interfaceRegex)

  if (!match) return props

  const propsBody = match[1]
  const propLines = propsBody.split(/[;\n]/).filter((line) => line.trim())

  for (const line of propLines) {
    const propMatch = line.match(/^\s*(\w+)(\?)?:\s*([^/]+)/)
    if (propMatch) {
      const [, name, optional, type] = propMatch
      props.push({
        name,
        type: type.trim(),
        optional: !!optional,
      })
    }
  }

  return props
}

/**
 * Check if a file is a Client Component
 */
export function isClientComponent(filePath: string): boolean {
  const content = readFileSync(filePath, 'utf-8')
  return content.includes("'use client'") || content.includes('"use client"')
}

/**
 * Check if a file is a Server Component (no 'use client' directive in App Router)
 */
export function isServerComponent(filePath: string): boolean {
  return !isClientComponent(filePath)
}
