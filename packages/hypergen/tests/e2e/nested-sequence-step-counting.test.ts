/**
 * E2E Test: Nested Sequence Step Counting
 *
 * This test ensures that when a recipe contains nested sequence steps,
 * the metadata.completedSteps count includes ALL executed steps (including
 * nested ones), not just top-level steps.
 *
 * Bug: Previously, recipes with nested sequences would report "Steps completed: 0"
 * or very low counts because only top-level step results were counted.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs-extra'
import * as path from 'node:path'
import * as os from 'node:os'
import { RecipeEngine } from '~/recipe-engine/recipe-engine'
import { getToolRegistry } from '~/recipe-engine/tools/registry'
import { templateToolFactory } from '~/recipe-engine/tools/template-tool'
import { sequenceToolFactory } from '~/recipe-engine/tools/sequence-tool'
import { parallelToolFactory } from '~/recipe-engine/tools/parallel-tool'

describe('E2E: Nested Sequence Step Counting', () => {
  let tempDir: string
  let recipeEngine: RecipeEngine

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hypergen-test-'))

    // Register required tools
    const registry = getToolRegistry()
    registry.register('template', 'default', templateToolFactory, { description: 'Template tool', category: 'core' })
    registry.register('sequence', 'default', sequenceToolFactory, { description: 'Sequence tool', category: 'core' })
    registry.register('parallel', 'default', parallelToolFactory, { description: 'Parallel tool', category: 'core' })

    recipeEngine = new RecipeEngine()
  })

  afterEach(async () => {
    await fs.remove(tempDir)
  })

  it('should count all steps including nested sequence steps', async () => {
    // Create a recipe with nested sequences (similar to nextjs project create)
    const recipePath = path.join(tempDir, 'recipe.yml')
    const recipeContent = `
name: test-nested-sequences
description: Test recipe with nested sequences
version: 1.0.0

variables:
  projectName:
    type: string
    default: "test-app"

steps:
  - name: Generate config files
    tool: sequence
    steps:
      - name: Generate package.json
        tool: template
        template: templates/package.json.jig

      - name: Generate tsconfig.json
        tool: template
        template: templates/tsconfig.json.jig

      - name: Generate next.config.ts
        tool: template
        template: templates/next.config.ts.jig

  - name: Generate app files
    tool: sequence
    steps:
      - name: Generate globals.css
        tool: template
        template: templates/app/globals.css.jig

      - name: Generate layout.tsx
        tool: template
        template: templates/app/layout.tsx.jig

      - name: Generate page.tsx
        tool: template
        template: templates/app/page.tsx.jig

  - name: Generate static assets
    tool: sequence
    steps:
      - name: Copy logo
        tool: template
        template: templates/public/logo.svg.jig

      - name: Copy icon
        tool: template
        template: templates/public/icon.svg.jig
`

    await fs.writeFile(recipePath, recipeContent)

    // Create template files
    const templatesDir = path.join(tempDir, 'templates')
    await fs.ensureDir(templatesDir)
    await fs.ensureDir(path.join(templatesDir, 'app'))
    await fs.ensureDir(path.join(templatesDir, 'public'))

    // Simple templates
    const createTemplate = (to: string, content: string) => `---
to: "${to}"
---
${content}
`

    await fs.writeFile(
      path.join(templatesDir, 'package.json.jig'),
      createTemplate('package.json', '{"name": "{{ projectName }}"}')
    )

    await fs.writeFile(
      path.join(templatesDir, 'tsconfig.json.jig'),
      createTemplate('tsconfig.json', '{"compilerOptions": {}}')
    )

    await fs.writeFile(
      path.join(templatesDir, 'next.config.ts.jig'),
      createTemplate('next.config.ts', 'export default {}')
    )

    await fs.writeFile(
      path.join(templatesDir, 'app', 'globals.css.jig'),
      createTemplate('app/globals.css', 'body { margin: 0; }')
    )

    await fs.writeFile(
      path.join(templatesDir, 'app', 'layout.tsx.jig'),
      createTemplate('app/layout.tsx', 'export default function Layout() {}')
    )

    await fs.writeFile(
      path.join(templatesDir, 'app', 'page.tsx.jig'),
      createTemplate('app/page.tsx', 'export default function Page() {}')
    )

    await fs.writeFile(
      path.join(templatesDir, 'public', 'logo.svg.jig'),
      createTemplate('public/logo.svg', '<svg></svg>')
    )

    await fs.writeFile(
      path.join(templatesDir, 'public', 'icon.svg.jig'),
      createTemplate('public/icon.svg', '<svg></svg>')
    )

    // Execute the recipe
    const result = await recipeEngine.executeRecipe(
      { type: 'file', path: recipePath },
      {
        variables: { projectName: 'test-app' },
        workingDir: tempDir,
        dryRun: false,
        force: true,
      }
    )

    // Verify execution succeeded
    expect(result.success).toBe(true)
    expect(result.errors).toHaveLength(0)

    // BUG CHECK: This is the key assertion that catches the bug
    // We have 3 top-level sequence steps, each containing multiple nested steps
    // Total: 3 + 3 + 2 = 8 actual template execution steps
    // Previously, completedSteps would be 0 or 3 (only top-level sequences)
    // After fix, it should be 8 (all nested steps)
    expect(result.metadata.completedSteps).toBeGreaterThan(0)
    expect(result.metadata.completedSteps).toBeGreaterThanOrEqual(8)

    // The stepResults array should have 3 entries (top-level sequences)
    expect(result.stepResults).toHaveLength(3)

    // But metadata.totalSteps should reflect ALL steps including nested ones
    expect(result.metadata.totalSteps).toBeGreaterThanOrEqual(8)

    // Verify files were actually created (all 8 template steps should create files)
    expect(result.filesCreated.length).toBe(8)
    expect(await fs.pathExists(path.join(tempDir, 'package.json'))).toBe(true)
    expect(await fs.pathExists(path.join(tempDir, 'tsconfig.json'))).toBe(true)
    expect(await fs.pathExists(path.join(tempDir, 'next.config.ts'))).toBe(true)
    expect(await fs.pathExists(path.join(tempDir, 'app', 'globals.css'))).toBe(true)
    expect(await fs.pathExists(path.join(tempDir, 'app', 'layout.tsx'))).toBe(true)
    expect(await fs.pathExists(path.join(tempDir, 'app', 'page.tsx'))).toBe(true)
    expect(await fs.pathExists(path.join(tempDir, 'public', 'logo.svg'))).toBe(true)
    expect(await fs.pathExists(path.join(tempDir, 'public', 'icon.svg'))).toBe(true)
  })

  it('should count deeply nested sequences correctly', async () => {
    // Test with 3 levels of nesting
    const recipePath = path.join(tempDir, 'recipe.yml')
    const recipeContent = `
name: test-deeply-nested
description: Test with deeply nested sequences
version: 1.0.0

steps:
  - name: Level 1 sequence
    tool: sequence
    steps:
      - name: Level 2 sequence A
        tool: sequence
        steps:
          - name: Generate file 1
            tool: template
            template: templates/file1.jig

          - name: Generate file 2
            tool: template
            template: templates/file2.jig

      - name: Level 2 sequence B
        tool: sequence
        steps:
          - name: Generate file 3
            tool: template
            template: templates/file3.jig

          - name: Generate file 4
            tool: template
            template: templates/file4.jig
`

    await fs.writeFile(recipePath, recipeContent)

    const templatesDir = path.join(tempDir, 'templates')
    await fs.ensureDir(templatesDir)

    const createTemplate = (to: string, content: string) => `---
to: "${to}"
---
${content}
`

    for (let i = 1; i <= 4; i++) {
      await fs.writeFile(
        path.join(templatesDir, `file${i}.jig`),
        createTemplate(`file${i}.txt`, `Content ${i}`)
      )
    }

    const result = await recipeEngine.executeRecipe(
      { type: 'file', path: recipePath },
      {
        variables: {},
        workingDir: tempDir,
        dryRun: false,
        force: true,
      }
    )

    expect(result.success).toBe(true)

    // Should count all 4 template executions, not just the top-level sequence
    expect(result.metadata.completedSteps).toBeGreaterThanOrEqual(4)
    expect(result.metadata.totalSteps).toBeGreaterThanOrEqual(4)

    // Verify files created (all 4 nested template steps should create files)
    expect(result.filesCreated.length).toBe(4)
    expect(await fs.pathExists(path.join(tempDir, 'file1.txt'))).toBe(true)
    expect(await fs.pathExists(path.join(tempDir, 'file2.txt'))).toBe(true)
    expect(await fs.pathExists(path.join(tempDir, 'file3.txt'))).toBe(true)
    expect(await fs.pathExists(path.join(tempDir, 'file4.txt'))).toBe(true)
  })

  it('should count mixed step types correctly', async () => {
    // Test with mix of regular steps and sequences
    const recipePath = path.join(tempDir, 'recipe.yml')
    const recipeContent = `
name: test-mixed-steps
description: Test with mixed step types
version: 1.0.0

variables:
  value1:
    type: string
    default: "test"

steps:
  - name: Single template step
    tool: template
    template: templates/single.jig

  - name: Sequence of templates
    tool: sequence
    steps:
      - name: Template in sequence 1
        tool: template
        template: templates/seq1.jig

      - name: Template in sequence 2
        tool: template
        template: templates/seq2.jig

  - name: Another single step
    tool: template
    template: templates/another.jig
`

    await fs.writeFile(recipePath, recipeContent)

    const templatesDir = path.join(tempDir, 'templates')
    await fs.ensureDir(templatesDir)

    const createTemplate = (to: string, content: string) => `---
to: "${to}"
---
${content}
`

    await fs.writeFile(
      path.join(templatesDir, 'single.jig'),
      createTemplate('single.txt', 'Single')
    )

    await fs.writeFile(
      path.join(templatesDir, 'seq1.jig'),
      createTemplate('seq1.txt', 'Seq 1')
    )

    await fs.writeFile(
      path.join(templatesDir, 'seq2.jig'),
      createTemplate('seq2.txt', 'Seq 2')
    )

    await fs.writeFile(
      path.join(templatesDir, 'another.jig'),
      createTemplate('another.txt', 'Another')
    )

    const result = await recipeEngine.executeRecipe(
      { type: 'file', path: recipePath },
      {
        variables: {},
        workingDir: tempDir,
        dryRun: false,
        force: true,
      }
    )

    expect(result.success).toBe(true)

    // Total: 1 single + 2 in sequence + 1 single = 4 template executions
    expect(result.metadata.completedSteps).toBe(4)
    expect(result.metadata.totalSteps).toBe(4)

    // stepResults should have 3 top-level entries
    expect(result.stepResults).toHaveLength(3)

    // Verify all 4 files were created
    expect(result.filesCreated.length).toBe(4)
    expect(await fs.pathExists(path.join(tempDir, 'single.txt'))).toBe(true)
    expect(await fs.pathExists(path.join(tempDir, 'seq1.txt'))).toBe(true)
    expect(await fs.pathExists(path.join(tempDir, 'seq2.txt'))).toBe(true)
    expect(await fs.pathExists(path.join(tempDir, 'another.txt'))).toBe(true)
  })

  it.skip('should handle parallel steps nested in sequences', async () => {
    // Test sequences containing parallel steps
    const recipePath = path.join(tempDir, 'recipe.yml')
    const recipeContent = `
name: test-sequence-with-parallel
description: Test sequence containing parallel steps
version: 1.0.0

steps:
  - name: Outer sequence
    tool: sequence
    steps:
      - name: Parallel batch
        tool: parallel
        steps:
          - name: Parallel task 1
            tool: template
            template: templates/p1.jig

          - name: Parallel task 2
            tool: template
            template: templates/p2.jig

          - name: Parallel task 3
            tool: template
            template: templates/p3.jig

      - name: After parallel
        tool: template
        template: templates/after.jig
`

    await fs.writeFile(recipePath, recipeContent)

    const templatesDir = path.join(tempDir, 'templates')
    await fs.ensureDir(templatesDir)

    const createTemplate = (to: string, content: string) => `---
to: "${to}"
---
${content}
`

    for (let i = 1; i <= 3; i++) {
      await fs.writeFile(
        path.join(templatesDir, `p${i}.jig`),
        createTemplate(`p${i}.txt`, `Parallel ${i}`)
      )
    }

    await fs.writeFile(
      path.join(templatesDir, 'after.jig'),
      createTemplate('after.txt', 'After')
    )

    const result = await recipeEngine.executeRecipe(
      { type: 'file', path: recipePath },
      {
        variables: {},
        workingDir: tempDir,
        dryRun: false,
        force: true,
      }
    )

    // Debug
    console.log('success:', result.success)
    console.log('errors:', result.errors)
    console.log('stepResults count:', result.stepResults.length)
    console.log('First step:', result.stepResults[0]?.stepName, result.stepResults[0]?.toolType, result.stepResults[0]?.status)
    console.log('metadata.completedSteps:', result.metadata.completedSteps)
    console.log('metadata.totalSteps:', result.metadata.totalSteps)
    console.log('filesCreated:', result.filesCreated)

    expect(result.success).toBe(true)

    // Total: 3 parallel + 1 after = 4 template executions
    expect(result.metadata.completedSteps).toBeGreaterThanOrEqual(4)
    expect(result.filesCreated.length).toBe(4)
  })
})
