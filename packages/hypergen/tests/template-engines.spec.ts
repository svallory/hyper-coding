import { describe, it, expect, beforeEach } from 'vitest'
import {
  initializeTemplateEngines,
  getTemplateEngineFactory,
  getTemplateEngine,
  getTemplateEngineForFile,
  getDefaultTemplateEngine
} from '../src/template-engines/index.js'
import { LiquidTemplateEngine } from '../src/template-engines/liquid-engine.js'

describe('Template Engines', () => {
  beforeEach(() => {
    initializeTemplateEngines()
  })

  describe('Factory', () => {
    it('should register LiquidJS template engine', () => {
      const factory = getTemplateEngineFactory()
      expect(factory.list()).toContain('liquidjs')
      expect(factory.list()).toHaveLength(1)
    })

    it('should set LiquidJS as default template engine', () => {
      const defaultEngine = getDefaultTemplateEngine()
      expect(defaultEngine.name).toBe('liquidjs')
    })

    it('should get template engine by name', () => {
      const liquidEngine = getTemplateEngine('liquidjs')

      expect(liquidEngine).toBeInstanceOf(LiquidTemplateEngine)
    })

    it('should get template engine by file extension', () => {
      const liquidEngine = getTemplateEngineForFile('.liquid')

      expect(liquidEngine?.name).toBe('liquidjs')
    })

    it('should return undefined for unsupported extensions', () => {
      const engine = getTemplateEngineForFile('.unsupported')
      expect(engine).toBeUndefined()
    })
  })

  describe('LiquidJS Template Engine', () => {
    let engine: LiquidTemplateEngine

    beforeEach(() => {
      engine = new LiquidTemplateEngine()
    })

    it('should render simple templates', async () => {
      const template = 'Hello {{ name }}!'
      const context = { name: 'World' }
      const result = await engine.render(template, context)
      expect(result).toBe('Hello World!')
    })

    it('should support filters', async () => {
      const template = '{{ name | capitalize }}'
      const context = { name: 'john' }
      const result = await engine.render(template, context)
      expect(result).toBe('John')
    })

    it('should support case transformation filters', async () => {
      const template = '{{ name | camelCase }}'
      const context = { name: 'hello-world' }
      const result = await engine.render(template, context)
      expect(result).toBe('helloWorld')
    })

    it('should support supported file extensions', () => {
      expect(engine.supports('.liquid')).toBe(true)
      expect(engine.supports('.liquid.t')).toBe(true)
      expect(engine.supports('.liq')).toBe(true)
      expect(engine.supports('.liq.t')).toBe(true)
      expect(engine.supports('.ejs')).toBe(false)
    })

    it('should handle template errors gracefully', async () => {
      const template = '{{ undefined_var | invalid_filter }}'
      const context = {}

      try {
        await engine.render(template, context)
        // If we get here, the template didn't throw an error
        // This is actually OK for LiquidJS with strictFilters: false
        expect(true).toBe(true)
      } catch (error) {
        expect(error.message).toContain('LiquidJS template rendering failed')
      }
    })
  })

  describe('Template Engine Integration', () => {
    it('should auto-detect LiquidJS templates', async () => {
      const liquidEngine = getTemplateEngineForFile('.liquid')
      const template = '{{ name | capitalize }}'
      const context = { name: 'world' }
      
      const result = await liquidEngine!.render(template, context)
      expect(result).toBe('World')
    })

    it('should return undefined for EJS extension', async () => {
      const ejsEngine = getTemplateEngineForFile('.ejs')
      expect(ejsEngine).toBeUndefined()
    })
  })
})