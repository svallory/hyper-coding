import { describe, it, expect, beforeEach } from 'vitest'
import { AiCollector } from '../../src/ai/ai-collector.js'
import { initializeJig, renderTemplate } from '../../src/template-engines/jig-engine.js'

describe('AI Tags (2-Pass)', () => {
  beforeEach(() => {
    AiCollector.reset()
    initializeJig({ cache: false })
  })

  describe('collect mode (Pass 1)', () => {
    it('collects a single @ai block', async () => {
      const collector = AiCollector.getInstance()
      collector.collectMode = true

      const template = `@ai()
  @context()
    Model: User
  @end
  @prompt()
    Which fields for the card?
  @end
  @output({ key: 'mainFields' })
    ["field1", "field2"]
  @end
@end`

      const result = await renderTemplate(template, {
        __hypergenCollectMode: true,
        answers: undefined,
      })

      // In collect mode, @ai should produce no output
      expect(result.trim()).toBe('')

      expect(collector.hasEntries()).toBe(true)
      const entries = collector.getEntries()
      expect(entries.size).toBe(1)

      const entry = entries.get('mainFields')!
      expect(entry.key).toBe('mainFields')
      expect(entry.prompt).toContain('Which fields for the card?')
      expect(entry.contexts.length).toBe(1)
      expect(entry.contexts[0]).toContain('Model: User')
      expect(entry.outputDescription).toContain('["field1", "field2"]')
    })

    it('collects multiple @ai blocks', async () => {
      const collector = AiCollector.getInstance()
      collector.collectMode = true

      const template = `@ai()
  @prompt()
    First prompt
  @end
  @output({ key: 'first' })
    format A
  @end
@end
separator
@ai()
  @prompt()
    Second prompt
  @end
  @output({ key: 'second' })
    format B
  @end
@end`

      const result = await renderTemplate(template, {
        __hypergenCollectMode: true,
        answers: undefined,
      })

      // Only the separator text should remain
      expect(result.trim()).toBe('separator')

      const entries = collector.getEntries()
      expect(entries.size).toBe(2)
      expect(entries.get('first')!.prompt).toContain('First prompt')
      expect(entries.get('second')!.prompt).toContain('Second prompt')
    })

    it('collects global @context outside @ai', async () => {
      const collector = AiCollector.getInstance()
      collector.collectMode = true

      const template = `@context()
  TypeScript project
@end
@ai()
  @prompt()
    Generate code
  @end
  @output({ key: 'code' })
  @end
@end`

      await renderTemplate(template, {
        __hypergenCollectMode: true,
        answers: undefined,
      })

      const globalContexts = collector.getGlobalContexts()
      expect(globalContexts.length).toBe(1)
      expect(globalContexts[0]).toContain('TypeScript project')
    })

    it('renders variables inside @prompt body', async () => {
      const collector = AiCollector.getInstance()
      collector.collectMode = true

      const template = `@ai()
  @prompt()
    Generate code for {{ name }}
  @end
  @output({ key: 'code' })
  @end
@end`

      await renderTemplate(template, {
        __hypergenCollectMode: true,
        answers: undefined,
        name: 'Customer',
      })

      const entry = collector.getEntries().get('code')!
      expect(entry.prompt).toContain('Generate code for Customer')
    })
  })

  describe('answers mode (Pass 2)', () => {
    it('resolves answer by key', async () => {
      const template = `before
@ai()
  @prompt()
    Generate code
  @end
  @output({ key: 'myCode' })
  @end
@end
after`

      const result = await renderTemplate(template, {
        __hypergenCollectMode: false,
        answers: { myCode: 'const x = 42;' },
      })

      expect(result).toContain('before')
      expect(result).toContain('const x = 42;')
      expect(result).toContain('after')
    })

    it('outputs empty string for missing answer key', async () => {
      const template = `@ai()
  @prompt()
    Generate code
  @end
  @output({ key: 'missing' })
  @end
@end`

      const result = await renderTemplate(template, {
        __hypergenCollectMode: false,
        answers: {},
      })

      expect(result.trim()).toBe('')
    })

    it('handles no answers object gracefully', async () => {
      const template = `@ai()
  @prompt()
    Generate code
  @end
  @output({ key: 'test' })
  @end
@end`

      const result = await renderTemplate(template, {
        __hypergenCollectMode: false,
      })

      expect(result.trim()).toBe('')
    })
  })

  describe('no @ai tags', () => {
    it('renders normally without @ai', async () => {
      const template = `Hello {{ name }}`

      const result = await renderTemplate(template, {
        __hypergenCollectMode: false,
        name: 'World',
      })

      expect(result).toBe('Hello World')
    })

    it('collector stays empty without @ai blocks', async () => {
      const collector = AiCollector.getInstance()
      collector.collectMode = true

      const template = `{{ name }}`

      await renderTemplate(template, {
        __hypergenCollectMode: true,
        name: 'Test',
      })

      expect(collector.hasEntries()).toBe(false)
    })
  })

  describe('@output key formats', () => {
    it('accepts { key: "name" } format', async () => {
      const collector = AiCollector.getInstance()
      collector.collectMode = true

      const template = `@ai()
  @prompt()
    test
  @end
  @output({ key: 'myKey' })
    hint
  @end
@end`

      await renderTemplate(template, {
        __hypergenCollectMode: true,
        answers: undefined,
      })

      expect(collector.getEntries().has('myKey')).toBe(true)
    })

    it('accepts string-only key', async () => {
      const collector = AiCollector.getInstance()
      collector.collectMode = true

      const template = `@ai()
  @prompt()
    test
  @end
  @output('directKey')
    hint
  @end
@end`

      await renderTemplate(template, {
        __hypergenCollectMode: true,
        answers: undefined,
      })

      expect(collector.getEntries().has('directKey')).toBe(true)
    })
  })
})
