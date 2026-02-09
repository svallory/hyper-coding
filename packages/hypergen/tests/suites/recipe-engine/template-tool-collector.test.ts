/**
 * Template Tool Collector Integration Tests
 *
 * IMPORTANT SETUP REQUIREMENTS:
 * 1. Jig must be initialized with initializeJig({ cache: false }) to register @ai tags
 * 2. Template files must exist on disk (not inline)
 * 3. StepContext must include ALL required fields (projectRoot, step, recipe, etc.)
 * 4. TemplateStep.template must be a STRING path, not an object
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { TemplateTool } from '~/recipe-engine/tools/template-tool'
import type { StepContext, TemplateStep } from '~/recipe-engine/types'
import * as jigEngine from '~/template-engines/jig-engine'
import { initializeJig, getJig } from '~/template-engines/jig-engine'
import { AiCollector } from '~/ai/ai-collector'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('Template Tool Collector Integration', () => {
  let testDir: string
  let collector: AiCollector

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'hypergen-test-'))
    collector = AiCollector.getInstance()
    collector.clear()

    // CRITICAL: Initialize Jig to register @ai tags
    initializeJig({ cache: false })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
    collector.clear()
    collector.collectMode = false
    vi.restoreAllMocks()
  })

  it('should pass __hypergenCollectMode from StepContext to Jig', async () => {
    const tool = new TemplateTool()

    // Spy on jigEngine.renderTemplate to capture the context passed
    const renderSpy = vi.spyOn(jigEngine, 'renderTemplate')

    // Create template file on disk
    const templatePath = join(testDir, 'test-template.jig')
    writeFileSync(templatePath, `---
to: "test.ts"
---
@ai({ key: 'test' })
  @prompt()
Generate something
  @end
  @output()
    @example()
Default output
    @end
  @end
@end`)

    // Create a template step with string path (not inline object)
    const templateStep: TemplateStep = {
      name: 'test-step',
      tool: 'template',
      template: 'test-template.jig'
    }

    // Create StepContext with ALL required fields
    const context: StepContext = {
      // Required fields
      projectRoot: testDir,
      step: templateStep,
      recipe: {
        id: 'test-recipe',
        name: 'Test Recipe',
        startTime: new Date()
      },
      recipeVariables: {},
      stepData: {},
      stepResults: new Map(),
      evaluateCondition: (expr: string) => true,

      // Optional fields
      collectMode: true,
      variables: {
        model: 'User',
        name: 'TestComponent'
      },
      utils: {}
    }

    // Execute template step
    await tool.execute(templateStep, context, {})

    // CRITICAL: Verify __hypergenCollectMode was passed to Jig
    expect(renderSpy).toHaveBeenCalled()

    const renderCalls = renderSpy.mock.calls
    expect(renderCalls.length).toBeGreaterThan(0)

    // Get the context argument from the first call
    const [, contextArg] = renderCalls[0]

    // This assertion will FAIL if template-tool doesn't pass collectMode correctly
    expect(contextArg).toHaveProperty('__hypergenCollectMode', true)
  })

  it('should pass __hypergenCollectMode=false when collectMode is disabled', async () => {
    const tool = new TemplateTool()
    const renderSpy = vi.spyOn(jigEngine, 'renderTemplate')

    // Create template file on disk
    const templatePath = join(testDir, 'test-template-2.jig')
    writeFileSync(templatePath, `---
to: "test.ts"
---
@ai({ key: 'test' })
  @prompt()
Test
  @end
  @output()
    @example()
Default
    @end
  @end
@end`)

    const templateStep: TemplateStep = {
      name: 'test-step',
      tool: 'template',
      template: 'test-template-2.jig'
    }

    const context: StepContext = {
      // Required fields
      projectRoot: testDir,
      step: templateStep,
      recipe: {
        id: 'test-recipe',
        name: 'Test Recipe',
        startTime: new Date()
      },
      recipeVariables: {},
      stepData: {},
      stepResults: new Map(),
      evaluateCondition: (expr: string) => true,

      // Optional fields
      collectMode: false, // Explicitly false
      variables: { model: 'User' },
      utils: {}
    }

    await tool.execute(templateStep, context, {})

    const [, contextArg] = renderSpy.mock.calls[0]

    // Should either not have the property or have it set to false
    if (contextArg.__hypergenCollectMode !== undefined) {
      expect(contextArg.__hypergenCollectMode).toBe(false)
    }
  })

  it('should propagate collectMode through template variables and helpers', async () => {
    const tool = new TemplateTool()
    const renderSpy = vi.spyOn(jigEngine, 'renderTemplate')

    // Create helpers that should be available in template context
    const helpers = {
      getFields: (model: string) => `Fields for ${model}`,
      customHelper: () => 'Helper result'
    }

    // Register helpers as Jig globals
    const jig = getJig()
    jig.global('getFields', helpers.getFields)
    jig.global('customHelper', helpers.customHelper)

    // Create template file on disk
    const templatePath = join(testDir, 'test-helpers.jig')
    writeFileSync(templatePath, `---
to: "test.ts"
---
@ai({ key: 'code' })
  @context()
Model: {{ model }}
Feature: {{ feature }}
Helper output: {{ getFields(model) }}
  @end
  @prompt()
Generate code
  @end
  @output()
    @example()
Default
    @end
  @end
@end`)

    const templateStep: TemplateStep = {
      name: 'test-helpers',
      tool: 'template',
      template: 'test-helpers.jig'
    }

    const context: StepContext = {
      // Required fields
      projectRoot: testDir,
      step: templateStep,
      recipe: {
        id: 'test-recipe',
        name: 'Test Recipe',
        startTime: new Date()
      },
      recipeVariables: {},
      stepData: {},
      stepResults: new Map(),
      evaluateCondition: (expr: string) => true,

      // Optional fields
      collectMode: true,
      variables: {
        model: 'User',
        feature: 'authentication'
      },
      utils: helpers
    }

    await tool.execute(templateStep, context, {})

    const [, contextArg] = renderSpy.mock.calls[0]

    // Verify all context elements are passed through
    expect(contextArg).toHaveProperty('__hypergenCollectMode', true)
    expect(contextArg).toHaveProperty('model', 'User')
    expect(contextArg).toHaveProperty('feature', 'authentication')
    expect(contextArg).toHaveProperty('getFields')
    expect(contextArg).toHaveProperty('customHelper')
  })

  it('should maintain collectMode through multiple template renderings', async () => {
    const tool = new TemplateTool()
    const renderSpy = vi.spyOn(jigEngine, 'renderTemplate')

    // Create multiple template files
    for (let i = 0; i < 3; i++) {
      const templatePath = join(testDir, `test-${i}.jig`)
      writeFileSync(templatePath, `---
to: "test-${i}.ts"
---
@ai({ key: 'test${i}' })
  @prompt()
Test ${i}
  @end
  @output()
    @example()
Output ${i}
    @end
  @end
@end`)
    }

    // Execute multiple templates
    for (let i = 0; i < 3; i++) {
      const step: TemplateStep = {
        name: `step-${i}`,
        tool: 'template',
        template: `test-${i}.jig`
      }

      const context: StepContext = {
        // Required fields
        projectRoot: testDir,
        step,
        recipe: {
          id: 'test-recipe',
          name: 'Test Recipe',
          startTime: new Date()
        },
        recipeVariables: {},
        stepData: {},
        stepResults: new Map(),
        evaluateCondition: (expr: string) => true,

        // Optional fields
        collectMode: true,
        variables: { index: i },
        utils: {}
      }

      await tool.execute(step, context, {})
    }

    // renderTemplate is called twice per template (frontmatter + content)
    expect(renderSpy.mock.calls.length).toBeGreaterThan(0)

    // Check that __hypergenCollectMode is passed in ALL rendering calls
    renderSpy.mock.calls.forEach((call, index) => {
      const [, contextArg] = call
      expect(contextArg).toHaveProperty('__hypergenCollectMode', true)
    })
  })

  it('should verify collector receives entries when collectMode is true', async () => {
    const tool = new TemplateTool()

    // Enable collect mode on collector
    collector.collectMode = true

    // Create template file on disk
    const templatePath = join(testDir, 'collect-test.jig')
    writeFileSync(templatePath, `---
to: "test.ts"
---
@ai({ key: 'handler' })
  @context()
Model: {{ model }}
  @end
  @prompt()
Generate handler
  @end
  @output()
    @example()
Default handler
    @end
  @end
@end`)

    const templateStep: TemplateStep = {
      name: 'collect-test',
      tool: 'template',
      template: 'collect-test.jig'
    }

    const context: StepContext = {
      // Required fields
      projectRoot: testDir,
      step: templateStep,
      recipe: {
        id: 'test-recipe',
        name: 'Test Recipe',
        startTime: new Date()
      },
      recipeVariables: {},
      stepData: {},
      stepResults: new Map(),
      evaluateCondition: (expr: string) => true,

      // Optional fields
      collectMode: true,
      variables: { model: 'User' },
      utils: {}
    }

    const result = await tool.execute(templateStep, context, {})

    console.log('Tool execution result:', result)
    console.log('Collector hasEntries:', collector.hasEntries())
    console.log('Collector entries:', Array.from(collector.getEntries().values()))

    // CRITICAL: This will FAIL if __hypergenCollectMode isn't passed correctly
    expect(collector.hasEntries()).toBe(true)
    expect(collector.getEntries().size).toBe(1)

    const entry = Array.from(collector.getEntries().values())[0]
    expect(entry.key).toBe('handler')
    expect(entry.contexts.join('\n')).toContain('Model: User')
  })
})
