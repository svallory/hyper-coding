import path from 'path'
import fs from 'fs-extra'
import { FilterImplOptions, Liquid, Tag } from 'liquidjs'
import { JsonValue } from 'type-fest'
import type { TemplateEngine } from './types.js'

/**
 * LiquidJS Template Engine Implementation
 * 
 * Provides safe, fast template rendering using the LiquidJS engine.
 * This is the default template engine for Hypergen.
 */
export class LiquidTemplateEngine implements TemplateEngine {
  readonly name = 'liquidjs'

  readonly supportedExtensions = ['.liquid', '.liquid.t', '.liq', '.liq.t']
  
  private liquid: Liquid

  private configured = false

  constructor() {
    this.liquid = new Liquid({
      // Default configuration
      cache: true,
      // Enable file system access for includes and layouts
      fs: {
        exists: fs.exists,
        existsSync: fs.existsSync,
        readFile: async (file: string) => fs.readFile(file, 'utf8'),
        readFileSync: (file: string) => fs.readFileSync(file, 'utf8'),
        resolve: (root: string, file: string, ext: string) => path.resolve(root, file + ext),
      },
      greedy: true,
      outputDelimiterLeft: '{{',
      outputDelimiterRight: '}}',
      relativeReference: false,
      strictFilters: false,
      strictVariables: false,
      tagDelimiterLeft: '{%',
      tagDelimiterRight: '%}',
      trimOutputLeft: false,
      trimOutputRight: false,
      trimTagLeft: false,
      trimTagRight: false,
    })

    this.setupDefaultFilters()
  }

  async render(template: string, context: Record<string, JsonValue>): Promise<string> {
    try {
      // assuming returned value will ALWAYS be a string
      // see: https://github.com/harttle/liquidjs/issues/832
      return await (this.liquid.parseAndRender(template, context) as unknown as Promise<string>)
    } catch (error) {
      throw new Error(`LiquidJS template rendering failed: ${error.message}`)
    }
  }

  async renderFile(filePath: string, context: Record<string, JsonValue>): Promise<string> {
    try {
      // assuming returned value will ALWAYS be a string
      // see: https://github.com/harttle/liquidjs/issues/832
      return await (this.liquid.renderFile(filePath, context) as unknown as Promise<string>)
    } catch (error) {
      throw new Error(`LiquidJS file rendering failed (${filePath}): ${error.message}`)
    }
  }

  supports(extension: string): boolean {
    return this.supportedExtensions.includes(extension)
  }

  configure(options: Record<string, JsonValue>): void {
    // Create new Liquid instance with custom options
    this.liquid = new Liquid({
      ...this.liquid.options,
      ...options,
      fs: {
        exists: fs.exists,
        existsSync: fs.existsSync,
        readFile: async (file: string) => fs.readFile(file, 'utf8'),
        readFileSync: (file: string) => fs.readFileSync(file, 'utf8'),
        resolve: (root: string, file: string, ext: string) => path.resolve(root, file + ext),
      },
      relativeReference: false,
    })
    
    this.setupDefaultFilters()
    this.configured = true
  }

  /**
   * Get the underlying Liquid instance for advanced usage
   */
  getLiquidInstance(): Liquid {
    return this.liquid
  }

  /**
   * Register a custom filter
   */
  registerFilter(name: string, filter: FilterImplOptions): void {
    this.liquid.registerFilter(name, filter)
  }

  /**
   * Register a custom tag
   */
  registerTag(name: string, tag: Tag): void {
    this.liquid.registerTag(name, tag)
  }

  /**
   * Setup default filters that match Hypergen's existing helpers
   */
  private setupDefaultFilters(): void {
    // Change case filters (matching change-case library)
    this.liquid.registerFilter('camelCase', (str: string) => str.replace(/[\s_-]+(.)?/g, (_, char: string) => char ? char.toUpperCase() : ''))

    this.liquid.registerFilter('pascalCase', (str: string) => {
      const camelCased = str.replace(/[\s_-]+(.)?/g, (_, char: string) => char ? char.toUpperCase() : '')
      return camelCased.charAt(0).toUpperCase() + camelCased.slice(1)
    })

    this.liquid.registerFilter('snakeCase', (str: string) => str.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '').replace(/[\s-]+/g, '_'))

    this.liquid.registerFilter('kebabCase', (str: string) => str.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '').replace(/[\s_]+/g, '-'))

    this.liquid.registerFilter('constantCase', (str: string) => str.replace(/([A-Z])/g, '_$1').toUpperCase().replace(/^_/, '').replace(/[\s-]+/g, '_'))

    this.liquid.registerFilter('dotCase', (str: string) => str.replace(/([A-Z])/g, '.$1').toLowerCase().replace(/^\./, '').replace(/[\s_-]+/g, '.'))

    this.liquid.registerFilter('pathCase', (str: string) => str.replace(/([A-Z])/g, '/$1').toLowerCase().replace(/^\//, '').replace(/[\s_-]+/g, '/'))

    this.liquid.registerFilter('paramCase', (str: string) => str.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '').replace(/[\s_]+/g, '-'))

    // Inflection filters
    this.liquid.registerFilter('pluralize', (str: string) => {
      // Basic pluralization - could be enhanced with inflection library
      if (str.endsWith('y')) {
        return `${str.slice(0, -1)  }ies`
      }
      if (str.endsWith('s') || str.endsWith('x') || str.endsWith('z') || str.endsWith('ch') || str.endsWith('sh')) {
        return `${str  }es`
      }
      return `${str  }s`
    })

    this.liquid.registerFilter('singularize', (str: string) => {
      // Basic singularization - could be enhanced with inflection library
      if (str.endsWith('ies')) {
        return `${str.slice(0, -3)  }y`
      }
      if (str.endsWith('es')) {
        return str.slice(0, -2)
      }
      if (str.endsWith('s') && !str.endsWith('ss')) {
        return str.slice(0, -1)
      }
      return str
    })

    // Utility filters
    this.liquid.registerFilter('capitalize', (str: string) => str.charAt(0).toUpperCase() + str.slice(1))

    this.liquid.registerFilter('titleize', (str: string) => str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase()))

    this.liquid.registerFilter('humanize', (str: string) => str.replace(/[_-]/g, ' ').replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase()))
  }
}