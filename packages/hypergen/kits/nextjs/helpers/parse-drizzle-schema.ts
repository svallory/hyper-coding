/**
 * Parse Drizzle ORM schema files
 */

import { readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'

export interface DrizzleTable {
  name: string
  variableName: string
  fields: DrizzleField[]
  relations: DrizzleRelation[]
  filePath: string
}

export interface DrizzleField {
  name: string
  type: string
  isPrimaryKey: boolean
  isNotNull: boolean
  isUnique: boolean
  defaultValue?: string
  references?: {
    table: string
    column: string
  }
}

export interface DrizzleRelation {
  name: string
  table: string
  type: 'one' | 'many'
  foreignKey?: string
}

/**
 * Find Drizzle schema directory
 */
export function findDrizzleSchema(root: string = process.cwd()): string | null {
  const commonPaths = [
    join(root, 'db', 'schema'),
    join(root, 'src', 'db', 'schema'),
    join(root, 'lib', 'db', 'schema'),
    join(root, 'drizzle', 'schema'),
  ]

  for (const path of commonPaths) {
    if (existsSync(path)) return path
  }

  // Check for single schema file
  const singleFilePaths = [
    join(root, 'db', 'schema.ts'),
    join(root, 'src', 'db', 'schema.ts'),
    join(root, 'lib', 'db', 'schema.ts'),
  ]

  for (const path of singleFilePaths) {
    if (existsSync(path)) return path
  }

  return null
}

/**
 * Parse Drizzle schema files
 */
export function parseDrizzleSchema(
  schemaPath?: string,
  root: string = process.cwd(),
): DrizzleTable[] {
  const path = schemaPath || findDrizzleSchema(root)
  if (!path) return []

  const tables: DrizzleTable[] = []

  // Check if path is a directory or file
  const stat = existsSync(path) ? readdirSync(path, { withFileTypes: true })[0] : null
  if (!stat) return []

  if (existsSync(path) && readdirSync(path, { withFileTypes: true }).some((f) => f.isFile())) {
    // Directory with multiple schema files
    const files = readdirSync(path)
      .filter((f) => f.endsWith('.ts') || f.endsWith('.js'))
      .map((f) => join(path, f))

    for (const file of files) {
      tables.push(...parseTablesFromFile(file))
    }
  } else if (existsSync(path)) {
    // Single schema file
    tables.push(...parseTablesFromFile(path))
  }

  return tables
}

/**
 * Parse tables from a single schema file
 */
function parseTablesFromFile(filePath: string): DrizzleTable[] {
  const content = readFileSync(filePath, 'utf-8')
  const tables: DrizzleTable[] = []

  // Match table definitions: export const users = pgTable('users', {...})
  const tableRegex =
    /export\s+const\s+(\w+)\s*=\s*(?:pgTable|mysqlTable|sqliteTable)\s*\(\s*['"](\w+)['"]\s*,\s*{([^}]+)}/g
  let match: RegExpExecArray | null

  while ((match = tableRegex.exec(content)) !== null) {
    const [, variableName, tableName, fieldsBody] = match

    tables.push({
      name: tableName,
      variableName,
      fields: parseTableFields(fieldsBody),
      relations: parseTableRelations(content, variableName),
      filePath,
    })
  }

  return tables
}

/**
 * Parse table fields from Drizzle table definition
 */
function parseTableFields(fieldsBody: string): DrizzleField[] {
  const fields: DrizzleField[] = []
  const lines = fieldsBody.split(',').filter((line) => line.trim())

  for (const line of lines) {
    const fieldMatch = line.match(/(\w+):\s*(\w+)\(/)
    if (!fieldMatch) continue

    const [, name, type] = fieldMatch
    const fieldDef = line.slice(fieldMatch.index! + fieldMatch[0].length)

    fields.push({
      name,
      type,
      isPrimaryKey: fieldDef.includes('.primaryKey()'),
      isNotNull: fieldDef.includes('.notNull()'),
      isUnique: fieldDef.includes('.unique()'),
      defaultValue: extractDrizzleDefault(fieldDef),
      references: extractDrizzleReference(fieldDef),
    })
  }

  return fields
}

/**
 * Extract default value from Drizzle field definition
 */
function extractDrizzleDefault(fieldDef: string): string | undefined {
  const match = fieldDef.match(/\.default\(([^)]+)\)/)
  return match ? match[1] : undefined
}

/**
 * Extract foreign key reference from Drizzle field definition
 */
function extractDrizzleReference(fieldDef: string): { table: string; column: string } | undefined {
  const match = fieldDef.match(/\.references\(\s*\(\)\s*=>\s*(\w+)\.(\w+)/)
  if (match) {
    return { table: match[1], column: match[2] }
  }
  return undefined
}

/**
 * Parse relations from relations() definition
 */
function parseTableRelations(content: string, tableName: string): DrizzleRelation[] {
  const relations: DrizzleRelation[] = []
  const relationRegex = new RegExp(
    `export\\s+const\\s+${tableName}Relations\\s*=\\s*relations\\s*\\(\\s*${tableName}\\s*,\\s*\\({([^}]+)}\\)`,
    's',
  )
  const match = content.match(relationRegex)

  if (!match) return relations

  const relationsBody = match[1]
  const relationLines = relationsBody.split(',').filter((line) => line.trim())

  for (const line of relationLines) {
    const relationMatch = line.match(/(\w+):\s*(one|many)\s*\(\s*(\w+)/)
    if (relationMatch) {
      const [, name, type, table] = relationMatch
      relations.push({
        name,
        table,
        type: type as 'one' | 'many',
      })
    }
  }

  return relations
}

/**
 * Get TypeScript type for Drizzle field type
 */
export function drizzleTypeToTS(drizzleType: string): string {
  const typeMap: Record<string, string> = {
    text: 'string',
    varchar: 'string',
    char: 'string',
    integer: 'number',
    int: 'number',
    smallint: 'number',
    bigint: 'number',
    real: 'number',
    numeric: 'number',
    decimal: 'number',
    boolean: 'boolean',
    date: 'Date',
    timestamp: 'Date',
    time: 'string',
    json: 'any',
    jsonb: 'any',
    uuid: 'string',
    serial: 'number',
    bigserial: 'number',
  }

  return typeMap[drizzleType] || 'any'
}

/**
 * Get Zod schema for Drizzle field
 */
export function drizzleFieldToZod(field: DrizzleField): string {
  let schema = ''

  const typeMap: Record<string, string> = {
    text: 'z.string()',
    varchar: 'z.string()',
    char: 'z.string()',
    integer: 'z.number()',
    int: 'z.number()',
    smallint: 'z.number()',
    bigint: 'z.number()',
    real: 'z.number()',
    numeric: 'z.number()',
    decimal: 'z.number()',
    boolean: 'z.boolean()',
    date: 'z.date()',
    timestamp: 'z.date()',
    time: 'z.string()',
    json: 'z.any()',
    jsonb: 'z.any()',
    uuid: 'z.string().uuid()',
  }

  schema = typeMap[field.type] || 'z.string()'

  if (!field.isNotNull) {
    schema += '.optional()'
  }

  return schema
}

/**
 * Check if Drizzle is configured in project
 */
export function hasDrizzle(root: string = process.cwd()): boolean {
  return !!findDrizzleSchema(root)
}
