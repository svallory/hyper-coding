
import { describe, it, expect } from 'vitest'
import { ShellTool } from '#/recipe-engine/tools/shell-tool'
import { ShellStep } from '#/recipe-engine/types'

describe('ShellTool', () => {
  const tool = new ShellTool()

  it('validates a correct shell step', async () => {
    const step: ShellStep = {
      name: 'test-step',
      tool: 'shell',
      command: 'echo hello'
    }
    const context: any = {}
    const result = await (tool as any).onValidate(step, context)
    expect(result.isValid).toBe(true)
  })

  it('returns error if command is missing', async () => {
    const step: ShellStep = {
      name: 'test-step',
      tool: 'shell',
      command: ''
    }
    const context: any = {}
    const result = await (tool as any).onValidate(step, context)
    expect(result.isValid).toBe(false)
    expect(result.errors).toContain('Shell command is required')
  })
})
