/**
 * TypeScript type parsing utilities
 */

import { readFileSync } from 'fs'

export interface TypeDefinition {
  name: string
  kind: 'interface' | 'type' | 'enum' | 'class'
  fields: FieldDefinition[]
  exported: boolean
}

export interface FieldDefinition {
  name: string
  type: string
  optional: boolean
  readonly: boolean
  description?: string
}

/**
 * Parse type definitions from a TypeScript file
 */
export function parseTypes(filePath: string): TypeDefinition[] {
  const content = readFileSync(filePath, 'utf-8')
  const types: TypeDefinition[] = []

  // Parse interfaces
  const interfaceRegex = /(export\s+)?interface\s+(\w+)\s*{([^}]+)}/gs
  let match: RegExpExecArray | null

  while ((match = interfaceRegex.exec(content)) !== null) {
    const [, exportKeyword, name, body] = match
    types.push({
      name,
      kind: 'interface',
      fields: parseFields(body),
      exported: !!exportKeyword,
    })
  }

  // Parse type aliases
  const typeRegex = /(export\s+)?type\s+(\w+)\s*=\s*{([^}]+)}/gs
  while ((match = typeRegex.exec(content)) !== null) {
    const [, exportKeyword, name, body] = match
    types.push({
      name,
      kind: 'type',
      fields: parseFields(body),
      exported: !!exportKeyword,
    })
  }

  // Parse enums
  const enumRegex = /(export\s+)?enum\s+(\w+)\s*{([^}]+)}/gs
  while ((match = enumRegex.exec(content)) !== null) {
    const [, exportKeyword, name, body] = match
    types.push({
      name,
      kind: 'enum',
      fields: parseEnumFields(body),
      exported: !!exportKeyword,
    })
  }

  // Parse classes (simplified)
  const classRegex = /(export\s+)?class\s+(\w+)\s*{([^}]+)}/gs
  while ((match = classRegex.exec(content)) !== null) {
    const [, exportKeyword, name, body] = match
    types.push({
      name,
      kind: 'class',
      fields: parseClassFields(body),
      exported: !!exportKeyword,
    })
  }

  return types
}

/**
 * Parse fields from interface/type body
 */
function parseFields(body: string): FieldDefinition[] {
  const fields: FieldDefinition[] = []
  const lines = body.split(/[;\n]/).filter((line) => line.trim())

  for (const line of lines) {
    // Skip comments
    if (line.trim().startsWith('//')) continue

    const fieldMatch = line.match(/^\s*(readonly\s+)?(\w+)(\?)?:\s*([^/]+)/)
    if (fieldMatch) {
      const [, readonly, name, optional, type] = fieldMatch
      fields.push({
        name,
        type: type.trim(),
        optional: !!optional,
        readonly: !!readonly,
      })
    }
  }

  return fields
}

/**
 * Parse enum fields
 */
function parseEnumFields(body: string): FieldDefinition[] {
  const fields: FieldDefinition[] = []
  const lines = body.split(',').filter((line) => line.trim())

  for (const line of lines) {
    const match = line.match(/^\s*(\w+)\s*=?\s*(.+)?/)
    if (match) {
      const [, name, value] = match
      fields.push({
        name,
        type: value ? value.trim() : 'number',
        optional: false,
        readonly: true,
      })
    }
  }

  return fields
}

/**
 * Parse class fields (properties only, not methods)
 */
function parseClassFields(body: string): FieldDefinition[] {
  const fields: FieldDefinition[] = []
  const lines = body.split(/[;\n]/).filter((line) => line.trim())

  for (const line of lines) {
    // Skip methods and constructors
    if (line.includes('(') || line.trim().startsWith('constructor')) continue

    const fieldMatch = line.match(
      /^\s*(?:public|private|protected)?\s*(readonly\s+)?(\w+)(\?)?:\s*([^=]+)/,
    )
    if (fieldMatch) {
      const [, readonly, name, optional, type] = fieldMatch
      fields.push({
        name,
        type: type.trim(),
        optional: !!optional,
        readonly: !!readonly,
      })
    }
  }

  return fields
}

/**
 * Convert TypeScript type to Zod schema type
 */
export function typeToZodSchema(tsType: string): string {
  const type = tsType.trim()

  // Handle arrays
  if (type.endsWith('[]')) {
    const innerType = type.slice(0, -2)
    return `z.array(${typeToZodSchema(innerType)})`
  }

  // Handle Array<T>
  const arrayMatch = type.match(/^Array<(.+)>$/)
  if (arrayMatch) {
    return `z.array(${typeToZodSchema(arrayMatch[1])})`
  }

  // Handle unions
  if (type.includes('|')) {
    const types = type.split('|').map((t) => t.trim())
    return `z.union([${types.map(typeToZodSchema).join(', ')}])`
  }

  // Primitive types
  switch (type) {
    case 'string':
      return 'z.string()'
    case 'number':
      return 'z.number()'
    case 'boolean':
      return 'z.boolean()'
    case 'Date':
      return 'z.date()'
    case 'any':
      return 'z.any()'
    case 'unknown':
      return 'z.unknown()'
    case 'null':
      return 'z.null()'
    case 'undefined':
      return 'z.undefined()'
    default:
      // For object types or custom types, default to z.object()
      return 'z.object({})'
  }
}

/**
 * Convert TypeScript type to form input type
 */
export function typeToInputType(tsType: string): string {
  const type = tsType.trim()

  if (type === 'string') return 'text'
  if (type === 'number') return 'number'
  if (type === 'boolean') return 'checkbox'
  if (type === 'Date') return 'date'
  if (type.includes('email') || type.includes('Email')) return 'email'
  if (type.includes('password') || type.includes('Password')) return 'password'
  if (type.includes('url') || type.includes('URL')) return 'url'
  if (type.includes('tel') || type.includes('phone') || type.includes('Phone')) return 'tel'

  return 'text'
}

/**
 * Check if a type is a primitive
 */
export function isPrimitive(tsType: string): boolean {
  const primitives = [
    'string',
    'number',
    'boolean',
    'null',
    'undefined',
    'symbol',
    'bigint',
  ]
  return primitives.includes(tsType.trim())
}
