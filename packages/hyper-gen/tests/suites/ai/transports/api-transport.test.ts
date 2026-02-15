import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ApiTransport } from '#/ai/transports/api-transport'
import { AiCollector } from '#/ai/ai-collector'
import { AiService } from '#/ai/ai-service'
import type { TransportContext } from '#/ai/transports/types'
import type { AIExecutionResult } from '#/ai/ai-config'

describe('ApiTransport', () => {
  const savedEnv = { ...process.env }

  beforeEach(() => {
    AiCollector.reset()
    AiService.reset()
    process.env.ANTHROPIC_API_KEY = 'test-key'
  })

  afterEach(() => {
    AiService.reset()
    process.env = { ...savedEnv }
  })

  function makeCollector(): AiCollector {
    const collector = AiCollector.getInstance()
    collector.collectMode = true
    collector.addEntry({
      key: 'component',
      contexts: ['React project'],
      prompt: 'Generate a Button component',
      outputDescription: 'JSX code',
      typeHint: 'jsx-fragment',
      examples: ['<button>Click</button>'],
      sourceFile: 'component.jig',
    })
    collector.addEntry({
      key: 'styles',
      contexts: [],
      prompt: 'Generate CSS for the button',
      outputDescription: 'CSS code',
      typeHint: 'css',
      examples: [],
      sourceFile: 'styles.jig',
    })
    return collector
  }

  function makeContext(collector: AiCollector): TransportContext {
    return {
      collector,
      config: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        apiKeyEnvVar: 'ANTHROPIC_API_KEY',
      },
      originalCommand: 'hypergen recipe run test.yml',
      answersPath: './ai-answers.json',
      projectRoot: '/tmp/test',
    }
  }

  it('has name "api"', () => {
    expect(new ApiTransport().name).toBe('api')
  })

  it('returns resolved answers from AiService', async () => {
    const mockResult: AIExecutionResult = {
      output: JSON.stringify({
        component: '<button className="btn">Click me</button>',
        styles: '.btn { color: blue; }',
      }),
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      costUsd: 0.001,
      model: 'claude-sonnet-4-5',
      provider: 'anthropic',
      retryAttempts: 0,
      durationMs: 500,
    }

    // Mock AiService.generate
    const generateSpy = vi.fn().mockResolvedValue(mockResult)
    vi.spyOn(AiService, 'getInstance').mockReturnValue({
      generate: generateSpy,
      getCostSummary: vi.fn(),
      getCostReport: vi.fn(),
    } as any)

    const collector = makeCollector()
    const transport = new ApiTransport()
    const result = await transport.resolve(makeContext(collector))

    expect(result.status).toBe('resolved')
    if (result.status === 'resolved') {
      expect(result.answers.component).toBe('<button className="btn">Click me</button>')
      expect(result.answers.styles).toBe('.btn { color: blue; }')
    }

    // Verify generate was called with a system prompt requesting JSON
    expect(generateSpy).toHaveBeenCalledOnce()
    const callArgs = generateSpy.mock.calls[0][0]
    expect(callArgs.system).toContain('JSON')
    expect(callArgs.system).toContain('component')
    expect(callArgs.system).toContain('styles')
  })

  it('strips markdown fences from response', async () => {
    const mockResult: AIExecutionResult = {
      output: '```json\n{"component": "code1", "styles": "code2"}\n```',
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      costUsd: 0.001,
      model: 'claude-sonnet-4-5',
      provider: 'anthropic',
      retryAttempts: 0,
      durationMs: 500,
    }

    vi.spyOn(AiService, 'getInstance').mockReturnValue({
      generate: vi.fn().mockResolvedValue(mockResult),
      getCostSummary: vi.fn(),
      getCostReport: vi.fn(),
    } as any)

    const collector = makeCollector()
    const transport = new ApiTransport()
    const result = await transport.resolve(makeContext(collector))

    expect(result.status).toBe('resolved')
    if (result.status === 'resolved') {
      expect(result.answers.component).toBe('code1')
      expect(result.answers.styles).toBe('code2')
    }
  })

  it('throws on invalid JSON response', async () => {
    const mockResult: AIExecutionResult = {
      output: 'This is not JSON at all',
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      costUsd: 0.001,
      model: 'test',
      provider: 'test',
      retryAttempts: 0,
      durationMs: 500,
    }

    vi.spyOn(AiService, 'getInstance').mockReturnValue({
      generate: vi.fn().mockResolvedValue(mockResult),
      getCostSummary: vi.fn(),
      getCostReport: vi.fn(),
    } as any)

    const collector = makeCollector()
    const transport = new ApiTransport()
    await expect(transport.resolve(makeContext(collector))).rejects.toThrow(/Failed to parse JSON/)
  })

  it('throws on missing keys in response', async () => {
    const mockResult: AIExecutionResult = {
      output: JSON.stringify({ component: 'code' }), // Missing 'styles'
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      costUsd: 0.001,
      model: 'test',
      provider: 'test',
      retryAttempts: 0,
      durationMs: 500,
    }

    vi.spyOn(AiService, 'getInstance').mockReturnValue({
      generate: vi.fn().mockResolvedValue(mockResult),
      getCostSummary: vi.fn(),
      getCostReport: vi.fn(),
    } as any)

    const collector = makeCollector()
    const transport = new ApiTransport()
    await expect(transport.resolve(makeContext(collector))).rejects.toThrow(/missing expected keys.*styles/)
  })

  it('coerces non-string values to JSON strings', async () => {
    const mockResult: AIExecutionResult = {
      output: JSON.stringify({
        component: { type: 'div', props: {} },
        styles: 42,
      }),
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      costUsd: 0.001,
      model: 'test',
      provider: 'test',
      retryAttempts: 0,
      durationMs: 500,
    }

    vi.spyOn(AiService, 'getInstance').mockReturnValue({
      generate: vi.fn().mockResolvedValue(mockResult),
      getCostSummary: vi.fn(),
      getCostReport: vi.fn(),
    } as any)

    const collector = makeCollector()
    const transport = new ApiTransport()
    const result = await transport.resolve(makeContext(collector))

    expect(result.status).toBe('resolved')
    if (result.status === 'resolved') {
      expect(result.answers.component).toBe('{"type":"div","props":{}}')
      expect(result.answers.styles).toBe('42')
    }
  })
})
