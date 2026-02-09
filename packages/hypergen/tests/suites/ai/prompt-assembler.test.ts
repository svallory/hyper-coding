import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { AiCollector } from '../../../src/ai/ai-collector.js'
import { PromptAssembler } from '../../../src/ai/prompt-assembler.js'
import { initializeJig } from '../../../src/template-engines/jig-engine.js'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('PromptAssembler', () => {
  let assembler: PromptAssembler

  beforeEach(() => {
    AiCollector.reset()
    initializeJig({ cache: false })
    assembler = new PromptAssembler()
  })

  it('produces markdown with correct structure', () => {
    const collector = AiCollector.getInstance()
    collector.addEntry({
      key: 'mainFields',
      contexts: ['Model: User with id, name, email'],
      prompt: 'Which fields for the card?',
      outputDescription: '["field1", "field2"]',
      examples: [],
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
      examples: [],
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
      examples: [],
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
      examples: [],
      sourceFile: 'f',
    })
    collector.addEntry({
      key: 'beta',
      contexts: [],
      prompt: 'Second prompt',
      outputDescription: 'format B',
      examples: [],
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
      examples: [],
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
      examples: [],
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
      examples: [],
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
      examples: [],
      sourceFile: 'f',
    })

    const result = assembler.assemble(collector, {
      originalCommand: 'hypergen run test',
    })

    expect(result).not.toContain('## Context')
  })

  // ─── Custom template tests ──────────────────────────────────────────

  describe('custom promptTemplate option', () => {
    let tmpDir: string

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'hypergen-prompt-test-'))
    })

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true })
    })

    it('uses a custom template file when promptTemplate is provided', () => {
      const customTemplatePath = join(tmpDir, 'custom-prompt.jig')
      writeFileSync(
        customTemplatePath,
        'CUSTOM: {{ entries.length }} entries, command={{ originalCommand }}',
        'utf-8',
      )

      const collector = AiCollector.getInstance()
      collector.addEntry({
        key: 'myKey',
        contexts: [],
        prompt: 'Do something',
        outputDescription: '',
        examples: [],
        sourceFile: 'f',
      })

      const result = assembler.assemble(collector, {
        originalCommand: 'hypergen run custom',
        promptTemplate: customTemplatePath,
      })

      expect(result).toContain('CUSTOM: 1 entries, command=hypergen run custom')
      // Should NOT contain default template markers
      expect(result).not.toContain('# Hypergen AI Generation Request')
    })

    it('exposes all template variables to a custom template', () => {
      const customTemplatePath = join(tmpDir, 'full-custom.jig')
      // A template that exercises every variable available to custom templates
      writeFileSync(
        customTemplatePath,
        [
          'HAS_CONTEXT={{ hasContext }}',
          'ANSWERS_PATH={{ answersPath }}',
          'COMMAND={{ originalCommand }}',
          'SCHEMA_START',
          '{{ responseSchema }}',
          'SCHEMA_END',
          '@each(gc in globalContexts)',
          'GLOBAL_CTX={{ gc }}',
          '@end',
          '@each(entry in entries)',
          'ENTRY_KEY={{ entry.key }}',
          'ENTRY_PROMPT={{ entry.prompt }}',
          'ENTRY_SOURCE={{ entry.sourceFile }}',
          'ENTRY_HAS_OUTPUT={{ entry.hasOutputDesc }}',
          '@if(entry.hasOutputDesc)',
          'ENTRY_OUTPUT={{ entry.outputDescription }}',
          '@end',
          '@each(ctx in entry.contexts)',
          'ENTRY_CTX={{ ctx }}',
          '@end',
          '@end',
        ].join('\n'),
        'utf-8',
      )

      const collector = AiCollector.getInstance()
      collector.addGlobalContext('Global rule: use TypeScript')
      collector.addGlobalContext('Global rule: no any types')
      collector.addEntry({
        key: 'schema',
        contexts: ['Model User has id, name, email'],
        prompt: 'Generate the Zod schema',
        outputDescription: 'z.object({ ... })',
        examples: [],
        sourceFile: 'user-schema.jig.t',
      })
      collector.addEntry({
        key: 'handler',
        contexts: ['REST endpoint for /users', 'Auth required'],
        prompt: 'Generate the route handler',
        outputDescription: '',
        examples: [],
        sourceFile: 'user-handler.jig.t',
      })

      const result = assembler.assemble(collector, {
        originalCommand: 'hypergen run crud --model=User',
        answersPath: './custom-answers.json',
        promptTemplate: customTemplatePath,
      })

      // Top-level scalars
      expect(result).toContain('HAS_CONTEXT=true')
      expect(result).toContain('ANSWERS_PATH=./custom-answers.json')
      expect(result).toContain('COMMAND=hypergen run crud --model=User')

      // responseSchema (pre-built JSON)
      expect(result).toContain('SCHEMA_START')
      expect(result).toContain('"schema": "<see format above>"')
      expect(result).toContain('"handler": "<your answer>"')
      expect(result).toContain('SCHEMA_END')

      // Global contexts
      expect(result).toContain('GLOBAL_CTX=Global rule: use TypeScript')
      expect(result).toContain('GLOBAL_CTX=Global rule: no any types')

      // First entry — has outputDescription
      expect(result).toContain('ENTRY_KEY=schema')
      expect(result).toContain('ENTRY_PROMPT=Generate the Zod schema')
      expect(result).toContain('ENTRY_SOURCE=user-schema.jig.t')
      expect(result).toContain('ENTRY_HAS_OUTPUT=true')
      expect(result).toContain('ENTRY_OUTPUT=z.object({ ... })')
      expect(result).toContain('ENTRY_CTX=Model User has id, name, email')

      // Second entry — no outputDescription, multiple contexts
      expect(result).toContain('ENTRY_KEY=handler')
      expect(result).toContain('ENTRY_PROMPT=Generate the route handler')
      expect(result).toContain('ENTRY_SOURCE=user-handler.jig.t')
      expect(result).toContain('ENTRY_CTX=REST endpoint for /users')
      expect(result).toContain('ENTRY_CTX=Auth required')

      // hasOutputDesc=false should NOT render the ENTRY_OUTPUT line for handler
      // Split output into lines and find the handler block
      const lines = result.split('\n')
      const handlerKeyIdx = lines.indexOf('ENTRY_KEY=handler')
      const nextEntryOrEnd = lines.length
      const handlerBlock = lines.slice(handlerKeyIdx, nextEntryOrEnd).join('\n')
      expect(handlerBlock).toContain('ENTRY_HAS_OUTPUT=false')
      // The @if(entry.hasOutputDesc) guard should have prevented ENTRY_OUTPUT
      // from appearing between handler's ENTRY_HAS_OUTPUT=false and the end
      const afterHasOutput = handlerBlock.split('ENTRY_HAS_OUTPUT=false')[1]
      expect(afterHasOutput).not.toContain('ENTRY_OUTPUT=')
    })

    it('throws when custom template path does not exist', () => {
      const collector = AiCollector.getInstance()
      collector.addEntry({
        key: 'k',
        contexts: [],
        prompt: 'p',
        outputDescription: '',
        examples: [],
        sourceFile: 'f',
      })

      expect(() =>
        assembler.assemble(collector, {
          originalCommand: 'hypergen run test',
          promptTemplate: '/absolutely/nonexistent/path/template.jig',
        }),
      ).toThrow('Custom prompt template not found')
    })
  })

  // ─── Multiple global contexts ───────────────────────────────────────

  it('renders multiple global contexts under Global Context heading', () => {
    const collector = AiCollector.getInstance()
    collector.addGlobalContext('We are using TypeScript strict mode')
    collector.addGlobalContext('The project uses React 18')
    collector.addGlobalContext('All components must be functional')

    collector.addEntry({
      key: 'comp',
      contexts: [],
      prompt: 'Generate a component',
      outputDescription: '',
      examples: [],
      sourceFile: 'f',
    })

    const result = assembler.assemble(collector, {
      originalCommand: 'hypergen run test',
    })

    expect(result).toContain('### Global Context')
    expect(result).toContain('We are using TypeScript strict mode')
    expect(result).toContain('The project uses React 18')
    expect(result).toContain('All components must be functional')
  })

  // ─── Multiple block contexts on single entry ────────────────────────

  it('renders multiple contexts for a single entry', () => {
    const collector = AiCollector.getInstance()
    collector.addEntry({
      key: 'schema',
      contexts: [
        'Database is PostgreSQL',
        'ORM is Prisma',
        'Schema uses UUID primary keys',
      ],
      prompt: 'Define the user schema',
      outputDescription: '',
      examples: [],
      sourceFile: 'f',
    })

    const result = assembler.assemble(collector, {
      originalCommand: 'hypergen run test',
    })

    expect(result).toContain('### Context for `schema`')
    expect(result).toContain('Database is PostgreSQL')
    expect(result).toContain('ORM is Prisma')
    expect(result).toContain('Schema uses UUID primary keys')
  })

  // ─── Mixed: global + block contexts ─────────────────────────────────

  it('renders both global and per-block contexts with global first', () => {
    const collector = AiCollector.getInstance()
    collector.addGlobalContext('Project language: TypeScript')

    collector.addEntry({
      key: 'api',
      contexts: ['REST API with Express'],
      prompt: 'Create an endpoint',
      outputDescription: '',
      examples: [],
      sourceFile: 'f',
    })

    const result = assembler.assemble(collector, {
      originalCommand: 'hypergen run test',
    })

    expect(result).toContain('## Context')
    expect(result).toContain('### Global Context')
    expect(result).toContain('Project language: TypeScript')
    expect(result).toContain('### Context for `api`')
    expect(result).toContain('REST API with Express')

    // Global context should appear before block context
    const globalIdx = result.indexOf('### Global Context')
    const blockIdx = result.indexOf('### Context for `api`')
    expect(globalIdx).toBeLessThan(blockIdx)
  })

  // ─── Entry with empty prompt ────────────────────────────────────────

  it('renders an entry with an empty prompt without errors', () => {
    const collector = AiCollector.getInstance()
    collector.addEntry({
      key: 'emptyPrompt',
      contexts: [],
      prompt: '',
      outputDescription: '',
      examples: [],
      sourceFile: 'f',
    })

    const result = assembler.assemble(collector, {
      originalCommand: 'hypergen run test',
    })

    expect(result).toContain('### `emptyPrompt`')
    // Should still have the key heading even with empty prompt
    expect(result).toContain('"emptyPrompt"')
  })

  // ─── Entry with whitespace-only outputDescription ───────────────────

  it('does not show "Expected output format:" for whitespace-only outputDescription', () => {
    const collector = AiCollector.getInstance()
    collector.addEntry({
      key: 'wsOutput',
      contexts: [],
      prompt: 'Do something',
      outputDescription: '   \t  \n  ',
      examples: [],
      sourceFile: 'f',
    })

    const result = assembler.assemble(collector, {
      originalCommand: 'hypergen run test',
    })

    expect(result).toContain('### `wsOutput`')
    expect(result).not.toContain('**Expected output format:**')
  })

  // ─── Special characters in key names ────────────────────────────────

  it('handles keys with dots, dashes, and underscores', () => {
    const collector = AiCollector.getInstance()
    const specialKeys = ['my.dotted.key', 'my-dashed-key', 'my_underscored_key']

    for (const key of specialKeys) {
      collector.addEntry({
        key,
        contexts: [],
        prompt: `Prompt for ${key}`,
        outputDescription: '',
        examples: [],
        sourceFile: 'f',
      })
    }

    const result = assembler.assemble(collector, {
      originalCommand: 'hypergen run test',
    })

    for (const key of specialKeys) {
      expect(result).toContain(`### \`${key}\``)
      expect(result).toContain(`Prompt for ${key}`)
      expect(result).toContain(`"${key}"`)
    }
  })

  // ─── Jig expressions in prompt/context are treated as literal text ──

  it('treats Jig-like syntax in prompt and context as literal text', () => {
    const collector = AiCollector.getInstance()
    const jigPrompt = 'Use @if(condition) to check and {{ variable }} for output'
    const jigContext = '@each(item in items) and @end are template directives'

    collector.addGlobalContext(jigContext)
    collector.addEntry({
      key: 'jigLiterals',
      contexts: ['Template uses @let(x = 5) syntax'],
      prompt: jigPrompt,
      outputDescription: '{{ someVar }}',
      examples: [],
      sourceFile: 'f',
    })

    const result = assembler.assemble(collector, {
      originalCommand: 'hypergen run test',
    })

    // The Jig expressions in the DATA should appear verbatim in the output,
    // because they are passed as context variables (strings), not as template code
    expect(result).toContain('@if(condition)')
    expect(result).toContain('{{ variable }}')
    expect(result).toContain('@each(item in items)')
    expect(result).toContain('@let(x = 5)')
    expect(result).toContain('{{ someVar }}')
  })

  // ─── Multiple entries ordering ──────────────────────────────────────

  it('preserves insertion order of entries', () => {
    const collector = AiCollector.getInstance()
    const orderedKeys = ['first', 'second', 'third', 'fourth']

    for (const key of orderedKeys) {
      collector.addEntry({
        key,
        contexts: [],
        prompt: `Prompt for ${key}`,
        outputDescription: '',
        examples: [],
        sourceFile: 'f',
      })
    }

    const result = assembler.assemble(collector, {
      originalCommand: 'hypergen run test',
    })

    // Verify ordering: each key should appear after the previous one
    let lastIdx = -1
    for (const key of orderedKeys) {
      const idx = result.indexOf(`### \`${key}\``)
      expect(idx).toBeGreaterThan(lastIdx)
      lastIdx = idx
    }
  })

  // ─── Response schema: mixed entries ─────────────────────────────────

  it('uses "<see format above>" for entries with outputDescription and "<your answer>" for those without', () => {
    const collector = AiCollector.getInstance()
    collector.addEntry({
      key: 'withDesc',
      contexts: [],
      prompt: 'Prompt A',
      outputDescription: '["a", "b"]',
      examples: [],
      sourceFile: 'f',
    })
    collector.addEntry({
      key: 'withoutDesc',
      contexts: [],
      prompt: 'Prompt B',
      outputDescription: '',
      examples: [],
      sourceFile: 'f',
    })
    collector.addEntry({
      key: 'alsoWithDesc',
      contexts: [],
      prompt: 'Prompt C',
      outputDescription: 'A JSON object with name and age',
      examples: [],
      sourceFile: 'f',
    })

    const result = assembler.assemble(collector, {
      originalCommand: 'hypergen run test',
    })

    // Parse the JSON schema block from the output
    const jsonMatch = result.match(/```json\s*([\s\S]*?)\s*```/)
    expect(jsonMatch).not.toBeNull()

    const schema = JSON.parse(jsonMatch![1])
    expect(schema['withDesc']).toBe('<see format above>')
    expect(schema['withoutDesc']).toBe('<your answer>')
    expect(schema['alsoWithDesc']).toBe('<see format above>')
  })

  // ─── Edge case: whitespace-only outputDescription in schema ─────────

  it('treats whitespace-only outputDescription as empty for schema placeholder', () => {
    const collector = AiCollector.getInstance()
    collector.addEntry({
      key: 'spacey',
      contexts: [],
      prompt: 'Do it',
      outputDescription: '   ',
      examples: [],
      sourceFile: 'f',
    })

    const result = assembler.assemble(collector, {
      originalCommand: 'hypergen run test',
    })

    const jsonMatch = result.match(/```json\s*([\s\S]*?)\s*```/)
    expect(jsonMatch).not.toBeNull()
    const schema = JSON.parse(jsonMatch![1])
    expect(schema['spacey']).toBe('<your answer>')
  })
})
