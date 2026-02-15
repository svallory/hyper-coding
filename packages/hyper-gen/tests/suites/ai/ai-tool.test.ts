import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AiTool } from '#/recipe-engine/tools/ai-tool'
import type { AIStep, StepContext, StepResult } from '#/recipe-engine/types'

function makeContext(overrides: Partial<StepContext> = {}): StepContext {
  return {
    step: {} as any,
    variables: { name: 'user', fields: 'id, name, email' },
    projectRoot: '/tmp/test-project',
    recipeVariables: {},
    stepResults: new Map(),
    recipe: { id: '1', name: 'test', startTime: new Date() },
    stepData: {},
    evaluateCondition: () => true,
    ...overrides,
  }
}

describe('AiTool', () => {
  let tool: AiTool

  beforeEach(() => {
    tool = new AiTool()
  })

  describe('onValidate', () => {
    it('validates valid AI step', async () => {
      const step: AIStep = {
        tool: 'ai',
        name: 'test-ai',
        prompt: 'Generate a function',
        output: { type: 'variable', variable: 'result' },
      }

      const result = await tool.validate(step, makeContext())
      expect(result.isValid).toBe(true)
    })

    it('requires prompt', async () => {
      const step: AIStep = {
        tool: 'ai',
        name: 'test-ai',
        prompt: '',
        output: { type: 'variable', variable: 'result' },
      }

      const result = await tool.validate(step, makeContext())
      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('AI step requires a non-empty "prompt" field')
    })

    it('requires output config', async () => {
      const step = {
        tool: 'ai' as const,
        name: 'test-ai',
        prompt: 'Generate code',
      } as any as AIStep

      const result = await tool.validate(step, makeContext())
      expect(result.isValid).toBe(false)
    })

    it('validates output type "variable" needs variable name', async () => {
      const step: AIStep = {
        tool: 'ai',
        name: 'test-ai',
        prompt: 'Generate code',
        output: { type: 'variable' },
      }

      const result = await tool.validate(step, makeContext())
      expect(result.isValid).toBe(false)
      expect(result.errors.some(e => e.includes('variable'))).toBe(true)
    })

    it('validates output type "file" needs to path', async () => {
      const step: AIStep = {
        tool: 'ai',
        name: 'test-ai',
        prompt: 'Generate code',
        output: { type: 'file' },
      }

      const result = await tool.validate(step, makeContext())
      expect(result.isValid).toBe(false)
      expect(result.errors.some(e => e.includes('"to" path'))).toBe(true)
    })

    it('validates temperature range', async () => {
      const step: AIStep = {
        tool: 'ai',
        name: 'test-ai',
        prompt: 'Generate code',
        output: { type: 'stdout' },
        temperature: 3,
      }

      const result = await tool.validate(step, makeContext())
      expect(result.isValid).toBe(false)
      expect(result.errors.some(e => e.includes('Temperature'))).toBe(true)
    })

    it('validates maxTokens is positive', async () => {
      const step: AIStep = {
        tool: 'ai',
        name: 'test-ai',
        prompt: 'Generate code',
        output: { type: 'stdout' },
        maxTokens: -1,
      }

      const result = await tool.validate(step, makeContext())
      expect(result.isValid).toBe(false)
      expect(result.errors.some(e => e.includes('maxTokens'))).toBe(true)
    })
  })
})
