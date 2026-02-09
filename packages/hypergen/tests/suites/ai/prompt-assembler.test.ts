import { describe, it, expect, beforeEach } from 'vitest'
import { AiCollector } from '../../../src/ai/ai-collector.js'
import { PromptAssembler } from '../../../src/ai/prompt-assembler.js'

describe('PromptAssembler', () => {
  let assembler: PromptAssembler

  beforeEach(() => {
    AiCollector.reset()
    assembler = new PromptAssembler()
  })

  it('produces markdown with correct structure', () => {
    const collector = AiCollector.getInstance()
    collector.addEntry({
      key: 'mainFields',
      contexts: ['Model: User with id, name, email'],
      prompt: 'Which fields for the card?',
      outputDescription: '["field1", "field2"]',
      sourceFile: 'user.jig.t',
    })

    const result = assembler.assemble(collector, {
      originalCommand: 'hypergen run ./test-recipe',
    })

    expect(result).toContain('# Hypergen AI Generation Request')
    expect(result).toContain('## Context')
    expect(result).toContain('## Prompts')
    expect(result).toContain('## Response Format')
    expect(result).toContain('## Instructions')
  })

  it('includes global context', () => {
    const collector = AiCollector.getInstance()
    collector.addGlobalContext('TypeScript strict mode')
    collector.addEntry({
      key: 'code',
      contexts: [],
      prompt: 'Generate code',
      outputDescription: '',
      sourceFile: 'f',
    })

    const result = assembler.assemble(collector, {
      originalCommand: 'hypergen run test',
    })

    expect(result).toContain('### Global Context')
    expect(result).toContain('TypeScript strict mode')
  })

  it('includes per-block context', () => {
    const collector = AiCollector.getInstance()
    collector.addEntry({
      key: 'fields',
      contexts: ['Model has id, name'],
      prompt: 'Select fields',
      outputDescription: '',
      sourceFile: 'f',
    })

    const result = assembler.assemble(collector, {
      originalCommand: 'hypergen run test',
    })

    expect(result).toContain('### Context for `fields`')
    expect(result).toContain('Model has id, name')
  })

  it('includes all prompt keys', () => {
    const collector = AiCollector.getInstance()
    collector.addEntry({
      key: 'alpha',
      contexts: [],
      prompt: 'First prompt',
      outputDescription: 'format A',
      sourceFile: 'f',
    })
    collector.addEntry({
      key: 'beta',
      contexts: [],
      prompt: 'Second prompt',
      outputDescription: 'format B',
      sourceFile: 'f',
    })

    const result = assembler.assemble(collector, {
      originalCommand: 'hypergen run test',
    })

    expect(result).toContain('### `alpha`')
    expect(result).toContain('First prompt')
    expect(result).toContain('### `beta`')
    expect(result).toContain('Second prompt')
    expect(result).toContain('**Expected output format:**')
  })

  it('includes JSON response schema', () => {
    const collector = AiCollector.getInstance()
    collector.addEntry({
      key: 'mainFields',
      contexts: [],
      prompt: 'Pick fields',
      outputDescription: '["a", "b"]',
      sourceFile: 'f',
    })

    const result = assembler.assemble(collector, {
      originalCommand: 'hypergen run test',
    })

    expect(result).toContain('"mainFields"')
    expect(result).toContain('```json')
  })

  it('includes callback command with --answers', () => {
    const collector = AiCollector.getInstance()
    collector.addEntry({
      key: 'k',
      contexts: [],
      prompt: 'p',
      outputDescription: '',
      sourceFile: 'f',
    })

    const result = assembler.assemble(collector, {
      originalCommand: 'hypergen run ./my-recipe --name=User',
      answersPath: './my-answers.json',
    })

    expect(result).toContain('hypergen run ./my-recipe --name=User --answers ./my-answers.json')
  })

  it('uses default answers path when not specified', () => {
    const collector = AiCollector.getInstance()
    collector.addEntry({
      key: 'k',
      contexts: [],
      prompt: 'p',
      outputDescription: '',
      sourceFile: 'f',
    })

    const result = assembler.assemble(collector, {
      originalCommand: 'hypergen run test',
    })

    expect(result).toContain('--answers ./ai-answers.json')
  })

  it('omits context section when no contexts exist', () => {
    const collector = AiCollector.getInstance()
    collector.addEntry({
      key: 'k',
      contexts: [],
      prompt: 'p',
      outputDescription: '',
      sourceFile: 'f',
    })

    const result = assembler.assemble(collector, {
      originalCommand: 'hypergen run test',
    })

    expect(result).not.toContain('## Context')
  })
})
