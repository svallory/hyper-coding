/**
 * Parse Prisma schema files
 */

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

export interface PrismaModel {
  name: string
  fields: PrismaField[]
  relations: PrismaRelation[]
  documentation?: string
}

export interface PrismaField {
  name: string
  type: string
  isRequired: boolean
  isUnique: boolean
  isId: boolean
  isUpdatedAt: boolean
  isCreatedAt: boolean
  defaultValue?: string
  documentation?: string
}

export interface PrismaRelation {
  field: string
  model: string
  relationType: 'one-to-one' | 'one-to-many' | 'many-to-many'
  foreignKey?: string
}

/**
 * Find Prisma schema file in project
 */
export function findPrismaSchema(root: string = process.cwd()): string | null {
  const commonPaths = [
    join(root, 'prisma', 'schema.prisma'),
    join(root, 'schema.prisma'),
    join(root, 'prisma', 'schema', 'schema.prisma'),
  ]

  for (const path of commonPaths) {
    if (existsSync(path)) return path
  }

  return null
}

/**
 * Parse Prisma schema file
 */
export function parsePrismaSchema(
  schemaPath?: string,
  root: string = process.cwd(),
): PrismaModel[] {
  const path = schemaPath || findPrismaSchema(root)
  if (!path) return []

  const content = readFileSync(path, 'utf-8')
  return parseModelsFromContent(content)
}

/**
 * Parse models from schema content
 */
function parseModelsFromContent(content: string): PrismaModel[] {
  const models: PrismaModel[] = []
  const modelRegex = /model\s+(\w+)\s*{([^}]+)}/g
  let match: RegExpExecArray | null

  while ((match = modelRegex.exec(content)) !== null) {
    const [, name, body] = match

    // Extract documentation comment
    const docMatch = content
      .slice(0, match.index)
      .match(/\/\/\/\s*(.+)\s*$/m)
    const documentation = docMatch ? docMatch[1].trim() : undefined

    models.push({
      name,
      fields: parseFields(body),
      relations: parseRelations(body, name),
      documentation,
    })
  }

  return models
}

/**
 * Parse fields from model body
 */
function parseFields(body: string): PrismaField[] {
  const fields: PrismaField[] = []
  const lines = body.split('\n').filter((line) => line.trim() && !line.trim().startsWith('@@'))

  for (const line of lines) {
    // Skip relations (identified by model types)
    if (/\s+\w+\s+\w+(?:\[\])?(?:\s+@relation)?/.test(line)) {
      const relationMatch = line.match(/^\s*(\w+)\s+(\w+)/)
      if (relationMatch) {
        const [, fieldName, fieldType] = relationMatch
        // Check if it's a model type (starts with capital letter)
        if (fieldType[0] === fieldType[0].toUpperCase() && fieldType[0] !== fieldType[0].toLowerCase()) {
          continue // Skip relation fields
        }
      }
    }

    const fieldMatch = line.match(/^\s*(\w+)\s+(\w+)(\?|\[\])?\s*(.*)?/)
    if (fieldMatch) {
      const [, name, type, modifier, attributes = ''] = fieldMatch

      // Extract documentation
      const docMatch = line.match(/\/\/\/\s*(.+)/)
      const documentation = docMatch ? docMatch[1].trim() : undefined

      fields.push({
        name,
        type,
        isRequired: !modifier || modifier === '[]',
        isUnique: attributes.includes('@unique'),
        isId: attributes.includes('@id'),
        isUpdatedAt: attributes.includes('@updatedAt'),
        isCreatedAt: attributes.includes('@default(now())'),
        defaultValue: extractDefaultValue(attributes),
        documentation,
      })
    }
  }

  return fields
}

/**
 * Extract default value from field attributes
 */
function extractDefaultValue(attributes: string): string | undefined {
  const match = attributes.match(/@default\(([^)]+)\)/)
  return match ? match[1] : undefined
}

/**
 * Parse relations from model body
 */
function parseRelations(body: string, currentModel: string): PrismaRelation[] {
  const relations: PrismaRelation[] = []
  const lines = body.split('\n').filter((line) => line.trim())

  for (const line of lines) {
    const relationMatch = line.match(/^\s*(\w+)\s+(\w+)(\[\])?\s+@relation/)
    if (relationMatch) {
      const [, field, model, isArray] = relationMatch

      // Extract foreign key if present
      const fkMatch = line.match(/fields:\s*\[(\w+)\]/)
      const foreignKey = fkMatch ? fkMatch[1] : undefined

      relations.push({
        field,
        model,
        relationType: isArray ? 'one-to-many' : 'one-to-one',
        foreignKey,
      })
    }
  }

  return relations
}

/**
 * Get TypeScript type for Prisma field type
 */
export function prismaTypeToTS(prismaType: string): string {
  const typeMap: Record<string, string> = {
    String: 'string',
    Int: 'number',
    Float: 'number',
    Boolean: 'boolean',
    DateTime: 'Date',
    Json: 'any',
    Bytes: 'Buffer',
    Decimal: 'number',
    BigInt: 'bigint',
  }

  return typeMap[prismaType] || 'any'
}

/**
 * Get Zod schema for Prisma field
 */
export function prismaFieldToZod(field: PrismaField): string {
  let schema = ''

  switch (field.type) {
    case 'String':
      schema = 'z.string()'
      break
    case 'Int':
    case 'Float':
    case 'Decimal':
      schema = 'z.number()'
      break
    case 'Boolean':
      schema = 'z.boolean()'
      break
    case 'DateTime':
      schema = 'z.date()'
      break
    case 'Json':
      schema = 'z.any()'
      break
    default:
      schema = 'z.string()'
  }

  if (!field.isRequired) {
    schema += '.optional()'
  }

  return schema
}

/**
 * Check if Prisma is configured in project
 */
export function hasPrisma(root: string = process.cwd()): boolean {
  return !!findPrismaSchema(root)
}
