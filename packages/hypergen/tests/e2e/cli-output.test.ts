/**
 * E2E Tests for CLI Output
 * Verifies that CLI output is clean and user-friendly without debug pollution
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const CLI_PATH = join(__dirname, '../../bin/run.js')

describe('CLI Output E2E', () => {
  let testDir: string

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'hypergen-cli-test-'))
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  it('should have clean output without debug logs', () => {
    // Setup minimal test recipe with @ai tag
    setupMinimalRecipe(testDir)

    // Execute CLI (Pass 1 - should collect and show prompt)
    let stdout: string
    let exitCode = 0
    try {
      stdout = execSync(
        `node ${CLI_PATH} run ${join(testDir, 'test-recipe.yml')}`,
        { encoding: 'utf8', cwd: testDir, stdio: 'pipe' }
      )
    } catch (error: any) {
      stdout = error.stdout || ''
      exitCode = error.status || 0
    }

    // Verify NO debug logs in output
    expect(stdout).not.toContain('[CONTEXT]')
    expect(stdout).not.toContain('[RECIPE-ENGINE]')
    expect(stdout).not.toContain('[AI TAG]')
    expect(stdout).not.toContain('[BASE-COMMAND]')
    expect(stdout).not.toContain('console.log')

    // Debug logs should not appear even with debug-like patterns
    expect(stdout).not.toMatch(/\[.*\].*helpers/)
    expect(stdout).not.toMatch(/loadedHelpers/)
  })

  it('should display AI prompt in clean format when collecting', () => {
    // Setup recipe with AI blocks
    setupAiRecipe(testDir)

    let stdout: string
    try {
      stdout = execSync(
        `node ${CLI_PATH} run ${join(testDir, 'ai-recipe.yml')}`,
        { encoding: 'utf8', cwd: testDir, stdio: 'pipe' }
      )
    } catch (error: any) {
      stdout = error.stdout || ''
    }

    // Verify clean prompt format
    expect(stdout).toContain('# Hypergen AI Generation Request')
    expect(stdout).toContain('## Prompts')
    expect(stdout).toContain('###')
    expect(stdout).toContain('Save your response')
    expect(stdout).toContain('--answers')

    // Should not have debug pollution mixed with prompt
    expect(stdout).not.toContain('[CONTEXT]')
    expect(stdout).not.toContain('[RECIPE-ENGINE]')
  })

  it('should not show debug logs in dry run mode', () => {
    setupMinimalRecipe(testDir)

    const stdout = execSync(
      `node ${CLI_PATH} run ${join(testDir, 'test-recipe.yml')} --dry`,
      { encoding: 'utf8', cwd: testDir }
    )

    expect(stdout).not.toContain('[CONTEXT]')
    expect(stdout).not.toContain('[RECIPE-ENGINE]')
    expect(stdout).not.toContain('[BASE-COMMAND]')
  })
})

/**
 * Create a minimal test recipe without AI tags
 */
function setupMinimalRecipe(dir: string) {
  const recipeYml = `
name: test-recipe
description: Test recipe for CLI output
version: 1.0.0

variables:
  name:
    type: string
    default: "test"

steps:
  - name: Create test file
    tool: template
    template: test.txt.jig
`

  const template = `---
to: "output.txt"
---
Hello {{ name }}!
`

  writeFileSync(join(dir, 'test-recipe.yml'), recipeYml)
  writeFileSync(join(dir, 'test.txt.jig'), template)
}

/**
 * Create a test recipe with AI collection
 */
function setupAiRecipe(dir: string) {
  const recipeYml = `
name: ai-test-recipe
description: Test recipe with AI collection
version: 1.0.0

variables:
  model:
    type: string
    default: "User"

steps:
  - name: Generate handler
    tool: template
    template: handler.go.jig
`

  const template = `---
to: "handlers/{{ snakeCase(model) }}_handler.go"
---
package handlers

type {{ model }}Handler struct {
@ai()
  @prompt()
    Write handler struct fields for {{ model }}
  @end
  @output({ key: 'handlerFields' })
    svc *service.{{ model }}Service
  @end
@end
}

func (h *{{ model }}Handler) Handle(w http.ResponseWriter, r *http.Request) {
@ai()
  @prompt()
    Write the handler body for {{ model }}
  @end
  @output({ key: 'handlerBody' })
    // Handler implementation
  @end
@end
}
`

  writeFileSync(join(dir, 'ai-recipe.yml'), recipeYml)
  writeFileSync(join(dir, 'handler.go.jig'), template)
  mkdirSync(join(dir, 'handlers'), { recursive: true })
}
