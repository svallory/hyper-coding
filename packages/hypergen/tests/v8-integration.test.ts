/**
 * V8 Integration Tests
 * 
 * End-to-end tests that prove the complete V8 implementation works:
 * - Template.yml configuration system
 * - Action discovery and registration
 * - CLI command execution
 * - Template-to-code generation pipeline
 * - Recipe Step System Tools Framework
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs-extra'
import path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

describe('V8 Integration Tests', () => {
  const testDir = path.join(__dirname, '..', 'test-output')
  const hypergenBin = path.join(__dirname, '..', 'src', 'bin.ts')

  beforeEach(async () => {
    // Clean test output directory
    await fs.ensureDir(testDir)
    await fs.emptyDir(testDir)
  })

  afterEach(async () => {
    // Clean up test output
    await fs.remove(testDir)
  })

  describe('Template.yml Configuration System', () => {
    it('should validate template.yml files', async () => {
      const { stdout } = await execAsync(
        `cd ${path.dirname(hypergenBin)} && bun --bun ${hypergenBin} template validate _templates/my-test-generator/template.yml`
      )
      
      expect(stdout).toContain('✅ Template validation successful')
      expect(stdout).toContain('my-test-generator')
      expect(stdout).toContain('Variables: 5')
      expect(stdout).toContain('Examples: 1')
    })

    it('should show template information', async () => {
      const { stdout } = await execAsync(
        `cd ${path.dirname(hypergenBin)} && bun --bun ${hypergenBin} template info _templates/my-test-generator/template.yml`
      )
      
      expect(stdout).toContain('📋 Template: my-test-generator')
      expect(stdout).toContain('Description: Test generator for React components')
      expect(stdout).toContain('Version: 1.0.0')
      expect(stdout).toContain('Variables (5):')
      expect(stdout).toContain('• name (string) *required*')
      expect(stdout).toContain('• type (enum) [default: functional]')
    })

    it('should list templates', async () => {
      const { stdout } = await execAsync(
        `cd ${path.dirname(hypergenBin)} && bun --bun ${hypergenBin} template list _templates`
      )
      
      expect(stdout).toContain('📝 Templates found in _templates (1):')
      expect(stdout).toContain('• my-test-generator - Test generator for React components')
    })

    it('should show template examples', async () => {
      const { stdout } = await execAsync(
        `cd ${path.dirname(hypergenBin)} && bun --bun ${hypergenBin} template examples _templates/my-test-generator/template.yml`
      )
      
      expect(stdout).toContain('📝 Examples for template: my-test-generator')
      expect(stdout).toContain('1. Basic my-test-generator')
      expect(stdout).toContain('hypergen action my-test-generator')
    })
  })

  describe('Action Discovery and Registration', () => {
    it('should discover generators', async () => {
      const { stdout } = await execAsync(
        `cd ${path.dirname(hypergenBin)} && bun --bun ${hypergenBin} discover`
      )
      
      expect(stdout).toContain('🔍 Discovery complete: found 1 generators')
      expect(stdout).toContain('📦 my-test-generator (local)')
      expect(stdout).toContain('Actions: myTestGenerator')
    })

    it('should list actions after discovery', async () => {
      const { stdout } = await execAsync(
        `cd ${path.dirname(hypergenBin)} && bun --bun ${hypergenBin} list`
      )
      
      expect(stdout).toContain('📝 Available actions:')
      expect(stdout).toContain('• my-test-generator - Test generator for React components')
      expect(stdout).toContain('📂 Categories: custom')
    })

    it('should show action information', async () => {
      const { stdout } = await execAsync(
        `cd ${path.dirname(hypergenBin)} && bun --bun ${hypergenBin} info my-test-generator`
      )
      
      expect(stdout).toContain('📋 Action: my-test-generator')
      expect(stdout).toContain('Description: Test generator for React components')
      expect(stdout).toContain('Category: custom')
      expect(stdout).toContain('Parameters (5):')
      expect(stdout).toContain('• name (string) *required*')
    })

    it('should list actions by category', async () => {
      const { stdout } = await execAsync(
        `cd ${path.dirname(hypergenBin)} && bun --bun ${hypergenBin} list custom`
      )
      
      expect(stdout).toContain('📝 Actions in category \'custom\':')
      expect(stdout).toContain('• my-test-generator')
    })
  })

  describe('End-to-End Action Execution', () => {
    it('should execute action and generate files', async () => {
      // Change to test directory for file generation
      const { stdout } = await execAsync(
        `cd ${testDir} && bun --bun ${hypergenBin} action my-test-generator --name TestComponent --type functional --withProps true --withStorybook false --styling css --defaults`
      )
      
      // Verify command output
      expect(stdout).toContain('ℹ️  Creating my-test-generator: TestComponent')
      expect(stdout).toContain('✅ Created my-test-generator TestComponent with 2 files')
      expect(stdout).toContain('✅ Action \'my-test-generator\' completed successfully')
      expect(stdout).toContain('Files created:')
      
      // Verify files were created
      const mainFile = path.join(testDir, 'src', 'my-test-generators', 'TestComponent.ts')
      const testFile = path.join(testDir, 'src', 'my-test-generators', 'TestComponent.test.ts')
      
      expect(await fs.pathExists(mainFile)).toBe(true)
      expect(await fs.pathExists(testFile)).toBe(true)
      
      // Verify file contents
      const mainContent = await fs.readFile(mainFile, 'utf-8')
      expect(mainContent).toContain('// Generated my-test-generator: TestComponent')
      expect(mainContent).toContain('export const TestComponent = {')
      
      const testContent = await fs.readFile(testFile, 'utf-8')
      expect(testContent).toContain('import { TestComponent }')
      expect(testContent).toContain('describe(\'TestComponent\'')
    })

    it('should handle different parameter combinations', async () => {
      const { stdout } = await execAsync(
        `cd ${testDir} && bun --bun ${hypergenBin} action my-test-generator --name ButtonComponent --type class --withProps false --withStorybook true --styling scss --defaults`
      )
      
      expect(stdout).toContain('✅ Action \'my-test-generator\' completed successfully')
      expect(stdout).toContain('Creating my-test-generator: ButtonComponent')
      
      // Verify the file was created with the correct name
      const buttonFile = path.join(testDir, 'src', 'my-test-generators', 'ButtonComponent.ts')
      expect(await fs.pathExists(buttonFile)).toBe(true)
    })
  })

  describe('System Commands', () => {
    it('should show system help', async () => {
      const { stdout } = await execAsync(
        `cd ${path.dirname(hypergenBin)} && bun --bun ${hypergenBin} system help`
      )
      
      expect(stdout).toContain('🚀 Hypergen Commands')
      expect(stdout).toContain('Action Management:')
      expect(stdout).toContain('Generator Discovery:')
      expect(stdout).toContain('Template Management:')
    })

    it('should show system status', async () => {
      const { stdout } = await execAsync(
        `cd ${path.dirname(hypergenBin)} && bun --bun ${hypergenBin} system status`
      )
      
      expect(stdout).toContain('📊 Hypergen Status')
      expect(stdout).toContain('Generators: 1')
      expect(stdout).toContain('Actions: 1')
      expect(stdout).toContain('Categories: 1')
    })

    it('should show version information', async () => {
      const { stdout } = await execAsync(
        `cd ${path.dirname(hypergenBin)} && bun --bun ${hypergenBin} system version`
      )
      
      expect(stdout).toContain('Hypergen')
    })
  })

  describe('Error Handling', () => {
    it('should handle missing action gracefully', async () => {
      try {
        await execAsync(
          `cd ${path.dirname(hypergenBin)} && bun --bun ${hypergenBin} action non-existent-action --name test`
        )
      } catch (error: any) {
        expect(error.stdout).toContain('❌ Action \'non-existent-action\' not found')
        expect(error.stdout).toContain('💡 Suggestions:')
      }
    })

    it('should validate template files', async () => {
      try {
        await execAsync(
          `cd ${path.dirname(hypergenBin)} && bun --bun ${hypergenBin} template validate non-existent.yml`
        )
      } catch (error: any) {
        expect(error.stdout).toContain('Template file not found')
      }
    })
  })

  describe('Recipe Step System - Tools Framework', () => {
    beforeEach(() => {
      // Import tools framework for testing
    })

    it('should be importable and provide core functionality', async () => {
      // Dynamic import to test our tools framework
      const {
        ToolRegistry,
        getToolRegistry,
        SUPPORTED_TOOL_TYPES,
        isSupportedToolType,
        validateToolType,
        createValidationResult,
        initializeToolsFramework
      } = await import('../src/recipe-engine/tools/index.js')

      // Test basic functionality
      expect(SUPPORTED_TOOL_TYPES).toContain('template')
      expect(SUPPORTED_TOOL_TYPES).toContain('action')
      expect(SUPPORTED_TOOL_TYPES).toContain('codemod')
      expect(SUPPORTED_TOOL_TYPES).toContain('recipe')

      expect(isSupportedToolType('template')).toBe(true)
      expect(isSupportedToolType('invalid')).toBe(false)

      expect(validateToolType('template')).toBe('template')
      expect(() => validateToolType('invalid')).toThrow()

      const validResult = createValidationResult(true, [], ['warning'])
      expect(validResult.isValid).toBe(true)
      expect(validResult.warnings).toContain('warning')

      // Test registry singleton
      const registry1 = getToolRegistry()
      const registry2 = ToolRegistry.getInstance()
      expect(registry1).toBe(registry2)

      // Test framework initialization
      const registry3 = initializeToolsFramework()
      expect(registry3).toBeInstanceOf(ToolRegistry)
    })

    it('should maintain tool registry state', async () => {
      const { getToolRegistry, ToolRegistry } = await import('../src/recipe-engine/tools/index.js')
      
      // Reset for clean test
      ToolRegistry.reset()
      
      const registry = getToolRegistry()
      const stats = registry.getStats()
      
      expect(stats.totalRegistrations).toBe(0)
      expect(stats.cachedInstances).toBe(0)
      expect(stats.activeInstances).toBe(0)
    })

    it('should provide proper TypeScript types', async () => {
      // This test verifies that our types are properly exported
      const toolsModule = await import('../src/recipe-engine/tools/index.js')
      
      // Verify key exports exist
      expect(typeof toolsModule.getToolRegistry).toBe('function')
      expect(typeof toolsModule.registerTool).toBe('function')
      expect(typeof toolsModule.resolveTool).toBe('function')
      expect(typeof toolsModule.createValidationResult).toBe('function')
      expect(typeof toolsModule.isSupportedToolType).toBe('function')
      expect(typeof toolsModule.validateToolType).toBe('function')
      expect(typeof toolsModule.initializeToolsFramework).toBe('function')
      
      // Verify classes are exported
      expect(toolsModule.Tool).toBeDefined()
      expect(toolsModule.ToolRegistry).toBeDefined()
      expect(toolsModule.BaseToolFactory).toBeDefined()
    })

    it('should support all required tool types', async () => {
      const { SUPPORTED_TOOL_TYPES } = await import('../src/recipe-engine/tools/index.js')
      
      const expectedTypes = ['template', 'action', 'codemod', 'recipe']
      for (const type of expectedTypes) {
        expect(SUPPORTED_TOOL_TYPES).toContain(type)
      }
      
      expect(SUPPORTED_TOOL_TYPES).toHaveLength(4)
    })

    it('should provide development utilities', async () => {
      const { DevUtils } = await import('../src/recipe-engine/tools/index.js')
      
      expect(typeof DevUtils.enableDebugLogging).toBe('function')
      expect(typeof DevUtils.getRegistryDebugInfo).toBe('function')
      expect(typeof DevUtils.resetRegistry).toBe('function')
      
      // Test debug info
      const debugInfo = DevUtils.getRegistryDebugInfo()
      expect(debugInfo.version).toBeDefined()
      expect(Array.isArray(debugInfo.supportedTypes)).toBe(true)
      expect(debugInfo.registryStats).toBeDefined()
      expect(debugInfo.healthCheck).toBeDefined()
    })

    it('should check registry health', async () => {
      const { checkRegistryHealth, ToolRegistry } = await import('../src/recipe-engine/tools/index.js')
      
      // Reset for clean test
      ToolRegistry.reset()
      
      const health = checkRegistryHealth()
      expect(typeof health.healthy).toBe('boolean')
      expect(Array.isArray(health.issues)).toBe(true)
      expect(health.stats).toBeDefined()
      
      // Should report no tools registered as an issue
      expect(health.issues).toContain('No tools registered in the registry')
    })
  })
})