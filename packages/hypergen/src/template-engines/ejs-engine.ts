import ejs from 'ejs'
import fs from 'fs-extra'
import type { TemplateEngine } from './types.js'

/**
 * EJS Template Engine Implementation
 * 
 * Provides EJS templating support as one of Hypergen's supported template engines.
 * This engine offers full EJS functionality alongside LiquidJS.
 */
export class EJSTemplateEngine implements TemplateEngine {
  readonly name = 'ejs'
  readonly supportedExtensions = ['.ejs', '.ejs.t', '.t']
  
  private options: ejs.Options = {}

  constructor() {
    // Default EJS options for optimal performance and functionality
    this.options = {
      async: true,
      cache: false, // Disable cache for string templates
      rmWhitespace: false,
      strict: false,
      _with: true,
      localsName: 'locals',
      // Enable file system access for includes
      filename: undefined,
      root: undefined,
      views: [],
      compileDebug: process.env.NODE_ENV !== 'production',
      delimiter: '%',
      openDelimiter: '<',
      closeDelimiter: '>',
    }
  }

  async render(template: string, context: Record<string, any>): Promise<string> {
    try {
      const result = await ejs.render(template, context, this.options)
      return result
    } catch (error) {
      throw new Error(`EJS template rendering failed: ${error.message}`)
    }
  }

  async renderFile(filePath: string, context: Record<string, any>): Promise<string> {
    try {
      const result = await ejs.renderFile(filePath, context, this.options)
      return result
    } catch (error) {
      throw new Error(`EJS file rendering failed (${filePath}): ${error.message}`)
    }
  }

  supports(extension: string): boolean {
    return this.supportedExtensions.includes(extension)
  }

  configure(options: Record<string, any>): void {
    this.options = {
      ...this.options,
      ...options,
    }
  }

  /**
   * Get the current EJS options
   */
  getOptions(): ejs.Options {
    return { ...this.options }
  }

  /**
   * Set specific EJS options
   */
  setOptions(options: ejs.Options): void {
    this.options = {
      ...this.options,
      ...options,
    }
  }

  /**
   * Set the root directory for includes
   */
  setRoot(root: string): void {
    this.options.root = root
  }

  /**
   * Add a view directory for includes
   */
  addViewPath(viewPath: string): void {
    if (!this.options.views) {
      this.options.views = []
    }
    if (Array.isArray(this.options.views)) {
      this.options.views.push(viewPath)
    }
  }

  /**
   * Set multiple view directories
   */
  setViewPaths(viewPaths: string[]): void {
    this.options.views = [...viewPaths]
  }
}