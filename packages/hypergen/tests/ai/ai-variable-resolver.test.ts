import { describe, it, expect, beforeEach } from 'vitest'
import {
  AiVariableResolver,
  type UnresolvedVariable,
  type RecipeMetadata,
} from '#/ai/ai-variable-resolver'
import type { TemplateVariable } from '#/config/template-parser'

describe('AiVariableResolver', () => {
  let resolver: AiVariableResolver

  const defaultAiConfig = {
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    mode: 'api' as const,
  }

  const recipeMeta: RecipeMetadata = {
    name: 'test-recipe',
    description: 'A test recipe for CRUD scaffolding',
  }

  beforeEach(() => {
    resolver = new AiVariableResolver(defaultAiConfig)
  })

  describe('buildPrompt', () => {
    it('should include recipe name and description', () => {
      const vars: UnresolvedVariable[] = [
        { name: 'name', config: { type: 'string', required: true } },
      ]

      const prompt = resolver.buildPrompt(vars, {}, recipeMeta)

      expect(prompt).toContain('test-recipe')
      expect(prompt).toContain('A test recipe for CRUD scaffolding')
    })

    it('should include already-resolved variables as context', () => {
      const vars: UnresolvedVariable[] = [
        { name: 'slug', config: { type: 'string', required: true } },
      ]
      const resolvedVars = { name: 'Organization', model: 'Org' }

      const prompt = resolver.buildPrompt(vars, resolvedVars, recipeMeta)

      expect(prompt).toContain('Already Known Variables')
      expect(prompt).toContain('"Organization"')
      expect(prompt).toContain('"Org"')
    })

    it('should not include Already Known Variables section when none resolved', () => {
      const vars: UnresolvedVariable[] = [
        { name: 'slug', config: { type: 'string' } },
      ]

      const prompt = resolver.buildPrompt(vars, {}, recipeMeta)

      expect(prompt).not.toContain('Already Known Variables')
    })

    it('should describe each unresolved variable with its constraints', () => {
      const vars: UnresolvedVariable[] = [
        {
          name: 'port',
          config: {
            type: 'number',
            required: true,
            description: 'Server port number',
            min: 1024,
            max: 65535,
          },
        },
        {
          name: 'framework',
          config: {
            type: 'enum',
            values: ['react', 'vue', 'angular'],
            suggestion: 'react',
          },
        },
      ]

      const prompt = resolver.buildPrompt(vars, {}, recipeMeta)

      expect(prompt).toContain('`port`')
      expect(prompt).toContain('**Type:** number')
      expect(prompt).toContain('**Required:** yes')
      expect(prompt).toContain('Server port number')
      expect(prompt).toContain('**Min:** 1024')
      expect(prompt).toContain('**Max:** 65535')
      expect(prompt).toContain('`framework`')
      expect(prompt).toContain('`react`')
      expect(prompt).toContain('`vue`')
      expect(prompt).toContain('`angular`')
      expect(prompt).toContain('**Suggestion:**')
    })

    it('should include default value as "skipped" when noDefaults is active', () => {
      const vars: UnresolvedVariable[] = [
        {
          name: 'color',
          config: { type: 'string', default: 'blue' },
          defaultValue: 'blue',
        },
      ]

      const prompt = resolver.buildPrompt(vars, {}, recipeMeta)

      expect(prompt).toContain('**Default (skipped):** `"blue"`')
    })

    it('should include project context when provided', () => {
      const vars: UnresolvedVariable[] = [
        { name: 'x', config: { type: 'string' } },
      ]

      const prompt = resolver.buildPrompt(vars, {}, recipeMeta, 'This is a Next.js project using TypeScript.')

      expect(prompt).toContain('Project Context')
      expect(prompt).toContain('This is a Next.js project using TypeScript.')
    })

    it('should include pattern constraints for string variables', () => {
      const vars: UnresolvedVariable[] = [
        {
          name: 'componentName',
          config: { type: 'string', pattern: '^[A-Z][a-zA-Z0-9]*$' },
        },
      ]

      const prompt = resolver.buildPrompt(vars, {}, recipeMeta)

      expect(prompt).toContain('**Pattern:** `^[A-Z][a-zA-Z0-9]*$`')
    })
  })

  describe('buildSystemPrompt', () => {
    it('should list expected keys', () => {
      const vars: UnresolvedVariable[] = [
        { name: 'name', config: { type: 'string' } },
        { name: 'port', config: { type: 'number' } },
      ]

      const system = resolver.buildSystemPrompt(vars)

      expect(system).toContain('"name"')
      expect(system).toContain('"port"')
      expect(system).toContain('ONLY a valid JSON object')
    })

    it('should include type coercion instructions', () => {
      const vars: UnresolvedVariable[] = [
        { name: 'x', config: { type: 'string' } },
      ]

      const system = resolver.buildSystemPrompt(vars)

      expect(system).toContain('For string values')
      expect(system).toContain('suggestion')
    })
  })

  describe('parseResponse', () => {
    const vars: UnresolvedVariable[] = [
      { name: 'name', config: { type: 'string', required: true } },
      { name: 'port', config: { type: 'number' } },
      { name: 'verbose', config: { type: 'boolean' } },
    ]

    it('should parse a clean JSON response', () => {
      const result = resolver.parseResponse(
        '{"name": "MyApp", "port": 3000, "verbose": true}',
        vars
      )

      expect(result).toEqual({ name: 'MyApp', port: 3000, verbose: true })
    })

    it('should strip markdown code fences', () => {
      const result = resolver.parseResponse(
        '```json\n{"name": "MyApp", "port": 3000, "verbose": false}\n```',
        vars
      )

      expect(result).toEqual({ name: 'MyApp', port: 3000, verbose: false })
    })

    it('should return empty object on invalid JSON', () => {
      const result = resolver.parseResponse('this is not json', vars)
      expect(result).toEqual({})
    })

    it('should return empty object on non-object JSON', () => {
      const result = resolver.parseResponse('[1, 2, 3]', vars)
      expect(result).toEqual({})
    })

    it('should return empty object for JSON null', () => {
      const result = resolver.parseResponse('null', vars)
      expect(result).toEqual({})
    })

    it('should skip missing keys', () => {
      const result = resolver.parseResponse('{"name": "X"}', vars)
      expect(result).toEqual({ name: 'X' })
      expect(result).not.toHaveProperty('port')
    })

    it('should coerce number values from strings', () => {
      const result = resolver.parseResponse('{"name": "X", "port": "8080", "verbose": true}', vars)
      expect(result.port).toBe(8080)
    })

    it('should coerce boolean strings', () => {
      const result = resolver.parseResponse('{"name": "X", "port": 80, "verbose": "true"}', vars)
      expect(result.verbose).toBe(true)
    })

    it('should reject invalid boolean strings', () => {
      const result = resolver.parseResponse('{"name": "X", "port": 80, "verbose": "maybe"}', vars)
      expect(result).not.toHaveProperty('verbose')
    })

    it('should validate enum values against allowed list', () => {
      const enumVars: UnresolvedVariable[] = [
        {
          name: 'framework',
          config: { type: 'enum', values: ['react', 'vue', 'angular'] },
        },
      ]

      const good = resolver.parseResponse('{"framework": "react"}', enumVars)
      expect(good).toEqual({ framework: 'react' })

      const bad = resolver.parseResponse('{"framework": "svelte"}', enumVars)
      expect(bad).toEqual({})
    })

    it('should handle multi-select enum values (array)', () => {
      const enumVars: UnresolvedVariable[] = [
        {
          name: 'methods',
          config: { type: 'enum', values: ['GET', 'POST', 'PUT', 'DELETE'], multiple: true },
        },
      ]

      const result = resolver.parseResponse('{"methods": ["GET", "POST"]}', enumVars)
      expect(result).toEqual({ methods: ['GET', 'POST'] })
    })

    it('should filter invalid values in multi-select enum', () => {
      const enumVars: UnresolvedVariable[] = [
        {
          name: 'methods',
          config: { type: 'enum', values: ['GET', 'POST', 'PUT', 'DELETE'], multiple: true },
        },
      ]

      const result = resolver.parseResponse('{"methods": ["GET", "PATCH"]}', enumVars)
      expect(result).toEqual({ methods: ['GET'] })
    })

    it('should handle array type', () => {
      const arrVars: UnresolvedVariable[] = [
        { name: 'tags', config: { type: 'array' } },
      ]

      const result = resolver.parseResponse('{"tags": ["alpha", "beta"]}', arrVars)
      expect(result).toEqual({ tags: ['alpha', 'beta'] })
    })

    it('should coerce comma-separated string to array', () => {
      const arrVars: UnresolvedVariable[] = [
        { name: 'tags', config: { type: 'array' } },
      ]

      const result = resolver.parseResponse('{"tags": "alpha, beta, gamma"}', arrVars)
      expect(result).toEqual({ tags: ['alpha', 'beta', 'gamma'] })
    })

    it('should handle object type', () => {
      const objVars: UnresolvedVariable[] = [
        { name: 'config', config: { type: 'object' } },
      ]

      const result = resolver.parseResponse('{"config": {"key": "val"}}', objVars)
      expect(result).toEqual({ config: { key: 'val' } })
    })

    it('should reject array for object type', () => {
      const objVars: UnresolvedVariable[] = [
        { name: 'config', config: { type: 'object' } },
      ]

      const result = resolver.parseResponse('{"config": [1, 2]}', objVars)
      expect(result).toEqual({})
    })

    it('should coerce non-string to string for string type', () => {
      const result = resolver.parseResponse('{"name": 42, "port": 80, "verbose": true}', vars)
      expect(result.name).toBe('42')
    })

    it('should skip null values', () => {
      const result = resolver.parseResponse('{"name": null, "port": 80, "verbose": true}', vars)
      expect(result).not.toHaveProperty('name')
    })

    it('should handle file and directory types as strings', () => {
      const fileVars: UnresolvedVariable[] = [
        { name: 'input', config: { type: 'file' } },
        { name: 'outDir', config: { type: 'directory' } },
      ]

      const result = resolver.parseResponse('{"input": "./src/index.ts", "outDir": "./dist"}', fileVars)
      expect(result).toEqual({ input: './src/index.ts', outDir: './dist' })
    })

    it('should reject NaN for number type', () => {
      const numVars: UnresolvedVariable[] = [
        { name: 'count', config: { type: 'number' } },
      ]

      const result = resolver.parseResponse('{"count": "not-a-number"}', numVars)
      expect(result).toEqual({})
    })
  })

  describe('resolveBatch (without real AiService)', () => {
    it('should return empty object for empty vars list', async () => {
      const result = await resolver.resolveBatch([], {}, recipeMeta)
      expect(result).toEqual({})
    })

    // Note: Full resolveBatch testing with mocked AiService is covered
    // in the integration tests (variable-resolution.test.ts), since
    // mock.module would pollute the AiService singleton across test files.
  })
})
