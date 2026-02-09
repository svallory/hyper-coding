import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { resolveTransport } from '../../../../src/ai/transports/resolve-transport.js'
import { StdoutTransport } from '../../../../src/ai/transports/stdout-transport.js'
import { ApiTransport } from '../../../../src/ai/transports/api-transport.js'
import { CommandTransport } from '../../../../src/ai/transports/command-transport.js'
import type { AiServiceConfig } from '../../../../src/ai/ai-config.js'

describe('resolveTransport', () => {
  const savedEnv = { ...process.env }

  afterEach(() => {
    // Restore env vars
    process.env = { ...savedEnv }
  })

  describe('explicit modes', () => {
    it('returns StdoutTransport for mode=stdout', () => {
      const transport = resolveTransport({ mode: 'stdout' })
      expect(transport).toBeInstanceOf(StdoutTransport)
      expect(transport.name).toBe('stdout')
    })

    it('returns StdoutTransport for mode=off', () => {
      const transport = resolveTransport({ mode: 'off' })
      expect(transport).toBeInstanceOf(StdoutTransport)
      expect(transport.name).toBe('stdout')
    })

    it('returns ApiTransport for mode=api with valid config', () => {
      process.env.ANTHROPIC_API_KEY = 'test-key'
      const transport = resolveTransport({
        mode: 'api',
        provider: 'anthropic',
        apiKey: '$ANTHROPIC_API_KEY',
      })
      expect(transport).toBeInstanceOf(ApiTransport)
      expect(transport.name).toBe('api')
    })

    it('throws for mode=api without provider', () => {
      expect(() => resolveTransport({ mode: 'api' })).toThrow(/ai\.provider/)
    })

    it('throws for mode=api without API key', () => {
      expect(() => resolveTransport({
        mode: 'api',
        provider: 'anthropic',
      })).toThrow(/API key/)
    })

    it('returns CommandTransport for mode=command with command set', () => {
      const transport = resolveTransport({
        mode: 'command',
        command: 'echo test',
      })
      expect(transport).toBeInstanceOf(CommandTransport)
      expect(transport.name).toBe('command')
    })

    it('throws for mode=command without ai.command', () => {
      expect(() => resolveTransport({ mode: 'command' })).toThrow(/ai\.command/)
    })
  })

  describe('auto mode', () => {
    it('returns StdoutTransport when no config provided', () => {
      const transport = resolveTransport(undefined)
      expect(transport).toBeInstanceOf(StdoutTransport)
    })

    it('returns StdoutTransport for empty config', () => {
      const transport = resolveTransport({})
      expect(transport).toBeInstanceOf(StdoutTransport)
    })

    it('returns ApiTransport when provider and API key env var are set', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-test'
      const transport = resolveTransport({
        provider: 'anthropic',
        apiKey: '$ANTHROPIC_API_KEY',
      })
      expect(transport).toBeInstanceOf(ApiTransport)
    })

    it('returns ApiTransport when well-known env var is set', () => {
      process.env.OPENAI_API_KEY = 'sk-test'
      const transport = resolveTransport({
        provider: 'openai',
      })
      expect(transport).toBeInstanceOf(ApiTransport)
    })

    it('does not auto-detect api when env var reference is missing', () => {
      delete process.env.ANTHROPIC_API_KEY
      const transport = resolveTransport({
        provider: 'anthropic',
        apiKey: '$ANTHROPIC_API_KEY',
      })
      // Falls through to stdout since the env var doesn't exist
      expect(transport).toBeInstanceOf(StdoutTransport)
    })

    it('returns CommandTransport when command is set (no API key)', () => {
      delete process.env.ANTHROPIC_API_KEY
      delete process.env.OPENAI_API_KEY
      delete process.env.GOOGLE_GENERATIVE_AI_API_KEY
      const transport = resolveTransport({
        command: 'llm',
      })
      expect(transport).toBeInstanceOf(CommandTransport)
    })

    it('prefers API over command when both are configured', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-test'
      const transport = resolveTransport({
        provider: 'anthropic',
        apiKey: '$ANTHROPIC_API_KEY',
        command: 'llm',
      })
      expect(transport).toBeInstanceOf(ApiTransport)
    })

    it('auto mode with explicit mode=auto behaves same as unset', () => {
      const transport = resolveTransport({ mode: 'auto' })
      expect(transport).toBeInstanceOf(StdoutTransport)
    })
  })
})
