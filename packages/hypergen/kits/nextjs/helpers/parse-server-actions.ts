/**
 * Parse Server Actions from Next.js files
 */

import { readFileSync } from 'fs'
import { glob } from 'glob'
import { join } from 'path'

export interface ServerAction {
  name: string
  filePath: string
  isInline: boolean // Inline in component vs separate file
  hasValidation: boolean
  revalidates: string[] // Paths being revalidated
}

/**
 * Find all Server Actions in a Next.js project
 */
export async function findServerActions(root: string = process.cwd()): Promise<ServerAction[]> {
  const actions: ServerAction[] = []

  // Find all potential Server Action files
  const patterns = [
    join(root, 'app/**/*.ts'),
    join(root, 'app/**/*.tsx'),
    join(root, 'actions/**/*.ts'),
    join(root, 'lib/**/*.ts'),
  ]

  const files: string[] = []
  for (const pattern of patterns) {
    const matches = await glob(pattern, { ignore: ['**/node_modules/**', '**/.next/**'] })
    files.push(...matches)
  }

  // Parse each file for Server Actions
  for (const file of files) {
    const fileActions = parseServerActionsFromFile(file)
    actions.push(...fileActions)
  }

  return actions
}

/**
 * Parse Server Actions from a single file
 */
export function parseServerActionsFromFile(filePath: string): ServerAction[] {
  const content = readFileSync(filePath, 'utf-8')
  const actions: ServerAction[] = []

  // Check if file has 'use server' directive
  const hasUseServer =
    content.includes("'use server'") || content.includes('"use server"')

  if (!hasUseServer) return actions

  // Find async function declarations
  const functionRegex = /(?:export\s+)?async\s+function\s+(\w+)/g
  let match: RegExpExecArray | null

  while ((match = functionRegex.exec(content)) !== null) {
    const name = match[1]
    const functionBody = extractFunctionBody(content, match.index)

    actions.push({
      name,
      filePath,
      isInline: filePath.includes('/app/') && !filePath.includes('/actions/'),
      hasValidation: functionBody.includes('.safeParse') || functionBody.includes('.parse'),
      revalidates: extractRevalidatePaths(functionBody),
    })
  }

  // Find arrow function Server Actions
  const arrowRegex = /(?:export\s+)?const\s+(\w+)\s*=\s*async\s*\(/g
  while ((match = arrowRegex.exec(content)) !== null) {
    const name = match[1]
    const functionBody = extractFunctionBody(content, match.index)

    actions.push({
      name,
      filePath,
      isInline: filePath.includes('/app/') && !filePath.includes('/actions/'),
      hasValidation: functionBody.includes('.safeParse') || functionBody.includes('.parse'),
      revalidates: extractRevalidatePaths(functionBody),
    })
  }

  return actions
}

/**
 * Extract function body from source code starting at an index
 */
function extractFunctionBody(content: string, startIndex: number): string {
  let braceCount = 0
  let inBody = false
  let body = ''

  for (let i = startIndex; i < content.length; i++) {
    const char = content[i]

    if (char === '{') {
      braceCount++
      inBody = true
    }

    if (inBody) {
      body += char
    }

    if (char === '}') {
      braceCount--
      if (braceCount === 0) break
    }
  }

  return body
}

/**
 * Extract revalidatePath/revalidateTag calls from function body
 */
function extractRevalidatePaths(functionBody: string): string[] {
  const paths: string[] = []

  // revalidatePath('...')
  const pathRegex = /revalidatePath\s*\(\s*['"]([^'"]+)['"]/g
  let match: RegExpExecArray | null

  while ((match = pathRegex.exec(functionBody)) !== null) {
    paths.push(match[1])
  }

  // revalidateTag('...')
  const tagRegex = /revalidateTag\s*\(\s*['"]([^'"]+)['"]/g
  while ((match = tagRegex.exec(functionBody)) !== null) {
    paths.push(`tag:${match[1]}`)
  }

  return paths
}

/**
 * Check if a file contains Server Actions
 */
export function hasServerActions(filePath: string): boolean {
  const content = readFileSync(filePath, 'utf-8')
  return (
    (content.includes("'use server'") || content.includes('"use server"')) &&
    /async\s+function/.test(content)
  )
}

/**
 * Generate Server Action boilerplate
 */
export function generateServerAction(options: {
  name: string
  validation?: boolean
  revalidate?: string
}): string {
  const { name, validation = true, revalidate } = options

  let code = `'use server'\n\n`

  if (validation) {
    code += `import { z } from 'zod'\n`
    code += `import { revalidatePath } from 'next/cache'\n\n`
    code += `const schema = z.object({\n`
    code += `  // TODO: Define validation schema\n`
    code += `})\n\n`
  }

  code += `export async function ${name}(formData: FormData) {\n`

  if (validation) {
    code += `  const parsed = schema.safeParse({\n`
    code += `    // TODO: Extract formData fields\n`
    code += `  })\n\n`
    code += `  if (!parsed.success) {\n`
    code += `    return { error: parsed.error.flatten().fieldErrors }\n`
    code += `  }\n\n`
    code += `  // TODO: Implement action logic\n\n`
  } else {
    code += `  // TODO: Implement action logic\n\n`
  }

  if (revalidate) {
    code += `  revalidatePath('${revalidate}')\n\n`
  }

  code += `  return { success: true }\n`
  code += `}\n`

  return code
}
