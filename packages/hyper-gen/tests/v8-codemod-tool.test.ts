/**
 * CodeMod Tool Tests for Recipe Step System
 * 
 * Tests the CodeModTool implementation including AST transformations,
 * text transformations, validation, and error handling.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs-extra'
import path from 'node:path'
import os from 'node:os'
import { CodeModTool, CodeModToolFactory } from '#/recipe-engine/tools/codemod-tool'
import type { CodeModStep, StepContext } from '#/recipe-engine/types'

describe('CodeModTool', () => {
  let tool: CodeModTool
  let tempDir: string
  let testContext: StepContext

  beforeEach(async () => {
    tool = new CodeModTool()
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hypergen-codemod-test-'))
    
    // Create a basic StepContext for testing
    testContext = {
      step: {} as any, // Will be set per test
      variables: { projectName: 'test-project' },
      projectRoot: tempDir,
      recipeVariables: {},
      stepResults: new Map(),
      recipe: {
        id: 'test-recipe',
        name: 'Test Recipe',
        startTime: new Date()
      },
      stepData: {},
      evaluateCondition: (expr: string, ctx: Record<string, any>) => true,
      dryRun: false,
      force: false
    }
  })

  afterEach(async () => {
    await tool.cleanup()
    await fs.remove(tempDir)
  })

  describe('Tool Initialization', () => {
    it('should initialize successfully', async () => {
      expect(tool.isInitialized()).toBe(false)
      await tool.initialize()
      expect(tool.isInitialized()).toBe(true)
    })

    it('should get correct tool type', () => {
      expect(tool.getToolType()).toBe('codemod')
    })

    it('should get tool name', () => {
      expect(tool.getName()).toBe('codemod-tool')
    })
  })

  describe('Step Validation', () => {
    it('should validate valid add-import step', async () => {
      const step: CodeModStep = {
        name: 'add-react-import',
        tool: 'codemod',
        codemod: 'add-import',
        files: ['src/**/*.tsx'],
        parameters: {
          import: 'React',
          from: 'react',
          importType: 'default'
        }
      }

      const result = await tool.validate(step, testContext)
      
      expect(result.isValid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should fail validation for missing required fields', async () => {
      const step: CodeModStep = {
        name: 'invalid-step',
        tool: 'codemod',
        codemod: '',
        files: []
      }

      const result = await tool.validate(step, testContext)
      
      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('CodeMod identifier is required')
      expect(result.errors).toContain('File patterns are required')
    })

    it('should fail validation for invalid codemod type', async () => {
      const step: CodeModStep = {
        name: 'invalid-codemod',
        tool: 'codemod',
        codemod: 'invalid-type',
        files: ['**/*.ts']
      }

      const result = await tool.validate(step, testContext)
      
      expect(result.isValid).toBe(false)
      expect(result.errors.some(e => e.includes('Invalid CodeMod type'))).toBe(true)
    })

    it('should validate add-import parameters', async () => {
      const step: CodeModStep = {
        name: 'missing-params',
        tool: 'codemod',
        codemod: 'add-import',
        files: ['**/*.ts'],
        parameters: {
          import: 'React'
          // Missing 'from' parameter
        }
      }

      const result = await tool.validate(step, testContext)
      
      expect(result.isValid).toBe(false)
      expect(result.errors.some(e => e.includes('add-import requires "import" and "from" parameters'))).toBe(true)
    })
  })

  describe('Text Transformations', () => {
    it('should perform replace-text transformation', async () => {
      // Create test file
      const testFile = path.join(tempDir, 'test.txt')
      await fs.writeFile(testFile, 'Hello World! This is a test.')

      const step: CodeModStep = {
        name: 'replace-text-test',
        tool: 'codemod',
        codemod: 'replace-text',
        files: ['test.txt'],
        parameters: {
          find: 'World',
          replace: 'Universe'
        }
      }

      testContext.step = step
      const result = await tool.execute(step, testContext)

      expect(result.status).toBe('completed')
      expect(result.filesModified).toHaveLength(1)
      
      const transformedContent = await fs.readFile(testFile, 'utf8')
      expect(transformedContent).toBe('Hello Universe! This is a test.')
    })

    it('should handle global replace-text transformation', async () => {
      const testFile = path.join(tempDir, 'test.txt')
      await fs.writeFile(testFile, 'foo bar foo baz foo')

      const step: CodeModStep = {
        name: 'global-replace',
        tool: 'codemod',
        codemod: 'replace-text',
        files: ['test.txt'],
        parameters: {
          find: 'foo',
          replace: 'bar',
          global: true
        }
      }

      testContext.step = step
      const result = await tool.execute(step, testContext)

      expect(result.status).toBe('completed')
      
      const transformedContent = await fs.readFile(testFile, 'utf8')
      expect(transformedContent).toBe('bar bar bar baz bar')
    })
  })

  describe('TypeScript AST Transformations', () => {
    it('should add import statement to TypeScript file', async () => {
      // Create test TypeScript file
      const testFile = path.join(tempDir, 'component.tsx')
      await fs.writeFile(testFile, `
export function MyComponent() {
  return <div>Hello</div>;
}
`.trim())

      const step: CodeModStep = {
        name: 'add-react-import',
        tool: 'codemod',
        codemod: 'add-import',
        files: ['component.tsx'],
        parameters: {
          import: 'React',
          from: 'react',
          importType: 'default'
        }
      }

      testContext.step = step
      const result = await tool.execute(step, testContext)

      expect(result.status).toBe('completed')
      expect(result.filesModified).toHaveLength(1)
      
      const transformedContent = await fs.readFile(testFile, 'utf8')
      expect(transformedContent).toContain('import React from "react"')
    })

    it('should add named export to TypeScript file', async () => {
      const testFile = path.join(tempDir, 'utils.ts')
      await fs.writeFile(testFile, `
function helper() {
  return 'helper';
}
`.trim())

      const step: CodeModStep = {
        name: 'add-export',
        tool: 'codemod',
        codemod: 'add-export',
        files: ['utils.ts'],
        parameters: {
          export: 'helper',
          exportType: 'named'
        }
      }

      testContext.step = step
      const result = await tool.execute(step, testContext)

      expect(result.status).toBe('completed')
      
      const transformedContent = await fs.readFile(testFile, 'utf8')
      expect(transformedContent).toContain('export { helper }')
    })
  })

  describe('Backup Functionality', () => {
    it('should create backup files when enabled', async () => {
      const testFile = path.join(tempDir, 'backup-test.txt')
      await fs.writeFile(testFile, 'original content')

      const step: CodeModStep = {
        name: 'backup-test',
        tool: 'codemod',
        codemod: 'replace-text',
        files: ['backup-test.txt'],
        backup: true,
        parameters: {
          find: 'original',
          replace: 'modified'
        }
      }

      testContext.step = step
      const result = await tool.execute(step, testContext)

      expect(result.status).toBe('completed')
      
      // Check that backup was created
      const backupFiles = await fs.readdir(tempDir)
      const backupFile = backupFiles.find(f => f.startsWith('backup-test.txt.backup.'))
      expect(backupFile).toBeDefined()
      
      // Verify backup content
      if (backupFile) {
        const backupContent = await fs.readFile(path.join(tempDir, backupFile), 'utf8')
        expect(backupContent).toBe('original content')
      }
    })

    it('should skip backup when disabled', async () => {
      const testFile = path.join(tempDir, 'no-backup-test.txt')
      await fs.writeFile(testFile, 'original content')

      const step: CodeModStep = {
        name: 'no-backup-test',
        tool: 'codemod',
        codemod: 'replace-text',
        files: ['no-backup-test.txt'],
        backup: false,
        parameters: {
          find: 'original',
          replace: 'modified'
        }
      }

      testContext.step = step
      const result = await tool.execute(step, testContext)

      expect(result.status).toBe('completed')
      
      // Check that no backup was created
      const backupFiles = await fs.readdir(tempDir)
      const backupFile = backupFiles.find(f => f.includes('.backup.'))
      expect(backupFile).toBeUndefined()
    })
  })

  describe('Dry Run Mode', () => {
    it('should not modify files in dry run mode', async () => {
      const testFile = path.join(tempDir, 'dry-run-test.txt')
      const originalContent = 'original content'
      await fs.writeFile(testFile, originalContent)

      const step: CodeModStep = {
        name: 'dry-run-test',
        tool: 'codemod',
        codemod: 'replace-text',
        files: ['dry-run-test.txt'],
        parameters: {
          find: 'original',
          replace: 'modified'
        }
      }

      testContext.step = step
      testContext.dryRun = true
      const result = await tool.execute(step, testContext)

      expect(result.status).toBe('completed')
      expect(result.filesModified).toHaveLength(1) // Reports as modified
      
      // File should remain unchanged
      const fileContent = await fs.readFile(testFile, 'utf8')
      expect(fileContent).toBe(originalContent)
    })
  })

  describe('Error Handling', () => {
    it('should handle non-existent file patterns gracefully', async () => {
      const step: CodeModStep = {
        name: 'missing-files',
        tool: 'codemod',
        codemod: 'replace-text',
        files: ['non-existent/**/*.ts'],
        parameters: {
          find: 'test',
          replace: 'replaced'
        }
      }

      testContext.step = step
      const result = await tool.execute(step, testContext)

      // Should complete even with no files found
      expect(result.status).toBe('completed')
      expect(result.filesModified).toHaveLength(0)
    })

    it('should handle transformation errors', async () => {
      const testFile = path.join(tempDir, 'invalid-syntax.ts')
      await fs.writeFile(testFile, 'invalid typescript syntax {{{')

      const step: CodeModStep = {
        name: 'syntax-error-test',
        tool: 'codemod',
        codemod: 'add-import',
        files: ['invalid-syntax.ts'],
        parameters: {
          import: 'React',
          from: 'react'
        }
      }

      testContext.step = step
      const result = await tool.execute(step, testContext)

      // Should handle syntax errors gracefully
      expect(result.status).toBe('failed')
    })
  })

  describe('Multiple File Processing', () => {
    it('should process multiple files matching pattern', async () => {
      // Create multiple test files
      const files = ['file1.txt', 'file2.txt', 'file3.txt']
      for (const file of files) {
        await fs.writeFile(path.join(tempDir, file), 'original content')
      }

      const step: CodeModStep = {
        name: 'multi-file-test',
        tool: 'codemod',
        codemod: 'replace-text',
        files: ['*.txt'],
        parameters: {
          find: 'original',
          replace: 'modified'
        }
      }

      testContext.step = step
      const result = await tool.execute(step, testContext)

      expect(result.status).toBe('completed')
      expect(result.filesModified).toHaveLength(3)
      
      // Verify all files were modified
      for (const file of files) {
        const content = await fs.readFile(path.join(tempDir, file), 'utf8')
        expect(content).toBe('modified content')
      }
    })
  })
})

describe('CodeModToolFactory', () => {
  let factory: CodeModToolFactory

  beforeEach(() => {
    factory = new CodeModToolFactory()
  })

  it('should create CodeModTool instances', () => {
    const tool = factory.create('test-codemod-tool')
    
    expect(tool).toBeInstanceOf(CodeModTool)
    expect(tool.getName()).toBe('test-codemod-tool')
    expect(tool.getToolType()).toBe('codemod')
  })

  it('should get correct tool type', () => {
    expect(factory.getToolType()).toBe('codemod')
  })

  it('should validate configuration', () => {
    const validConfig = {
      enableCaching: true,
      cleanupBackups: false
    }

    const result = factory.validateConfig(validConfig)
    
    expect(result.isValid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('should warn about invalid configuration', () => {
    const invalidConfig = {
      enableCaching: 'not-boolean',
      cleanupBackups: 'also-not-boolean'
    }

    const result = factory.validateConfig(invalidConfig)
    
    expect(result.isValid).toBe(true) // Warnings don't make it invalid
    expect(result.warnings).toContain('enableCaching should be a boolean')
    expect(result.warnings).toContain('cleanupBackups should be a boolean')
  })
})