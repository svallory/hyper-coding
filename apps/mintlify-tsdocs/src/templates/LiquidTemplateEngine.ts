// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import * as path from 'path';
import * as fs from 'fs';
import { FileSystem } from '@rushstack/node-core-library';
import { Liquid } from 'liquidjs';

import { DocumentationError, ErrorCode } from '../errors/DocumentationError';
import type { ITemplateData, ITemplateEngineOptions } from './TemplateEngine';

/**
 * LiquidJS-based template engine implementation
 */
export class LiquidTemplateEngine {
  private readonly _templateDir: string;
  private readonly _cache: boolean;
  private readonly _strict: boolean;
  private readonly _liquid: Liquid;
  private readonly _templateCache: Map<string, string> = new Map();

  public constructor(options: ITemplateEngineOptions = {}) {
    // Default templates are in src/templates/defaults, accessible from compiled code
    this._templateDir = options.templateDir || path.join(__dirname, '..', '..', 'src', 'templates', 'defaults');
    this._cache = options.cache !== false;
    this._strict = options.strict !== false;

    this._liquid = new Liquid({
      root: this._templateDir,
      cache: this._cache,
      extname: '.liquid',
      // NOTE: strictVariables disabled because we have many optional properties in template data
      // Data is already sanitized by _sanitizeTemplateData()
      strictVariables: false,
      strictFilters: this._strict,
      // NOTE: dynamicPartials must be enabled for layout tag to work
      // This is safe in our context because:
      // 1. Template data comes from API Extractor, not user input
      // 2. Templates are either our defaults or user-provided (already trusted)
      // 3. Paths are constrained to the template directory by LiquidJS
      dynamicPartials: true,
      // Custom filters can be added here
      globals: {
        // Add any global variables that should be available in all templates
      }
    });

    // Register custom filters
    this._registerCustomFilters();
  }

  /**
   * Render a template with the provided data
   */
  public async render(templateName: string, data: ITemplateData): Promise<string> {
    try {
      const sanitizedData = this._sanitizeTemplateData(data);

      // Use renderFile instead of parseAndRender to properly support layout tags
      const result = await this._liquid.renderFile(templateName, sanitizedData);

      // Post-process to ensure valid MDX
      return this._postProcessOutput(result);
    } catch (error) {
      throw new DocumentationError(
        `Failed to render template '${templateName}': ${error instanceof Error ? error.message : String(error)}`,
        ErrorCode.TEMPLATE_RENDER_ERROR
      );
    }
  }

  /**
   * Check if a template exists
   */
  public hasTemplate(templateName: string): boolean {
    const templatePath = this._getTemplatePath(templateName);
    return FileSystem.exists(templatePath);
  }

  /**
   * Get available template names from the template directory
   */
  public getAvailableTemplates(): string[] {
    if (!FileSystem.exists(this._templateDir)) {
      return [];
    }

    try {
      const files = FileSystem.readFolderItemNames(this._templateDir);
      return files
        .filter((file: string) => file.endsWith('.liquid'))
        .map((file: string) => path.basename(file, '.liquid'));
    } catch {
      return [];
    }
  }

  /**
   * Load a template (with caching)
   */
  private async _loadTemplate(templateName: string): Promise<string> {
    const cacheKey = templateName;

    if (this._cache && this._templateCache.has(cacheKey)) {
      return this._templateCache.get(cacheKey)!;
    }

    const templatePath = this._getTemplatePath(templateName);

    if (!FileSystem.exists(templatePath)) {
      throw new DocumentationError(
        `Template '${templateName}' not found at ${templatePath}`,
        ErrorCode.TEMPLATE_NOT_FOUND
      );
    }

    try {
      const content = FileSystem.readFileToBuffer(templatePath).toString();

      if (this._cache) {
        this._templateCache.set(cacheKey, content);
      }

      return content;
    } catch (error) {
      throw new DocumentationError(
        `Failed to read template '${templateName}': ${error instanceof Error ? error.message : String(error)}`,
        ErrorCode.TEMPLATE_ERROR
      );
    }
  }

  /**
   * Get the Liquid engine for direct access
   */
  public get liquid(): Liquid {
    return this._liquid;
  }

  /**
   * Post-process template output (public for template manager)
   */
  public postProcessOutput(output: string): string {
    return this._postProcessOutput(output);
  }

  /**
   * Get the template directory (public for template manager)
   */
  public get templateDir(): string {
    return this._templateDir;
  }

  /**
   * Get the full path for a template
   */
  private _getTemplatePath(templateName: string): string {
    // Try with .liquid extension first, then without extension
    const liquidPath = path.join(this._templateDir, `${templateName}.liquid`);
    if (FileSystem.exists(liquidPath)) {
      return liquidPath;
    }

    // For backward compatibility, also try the path as-is
    const directPath = path.join(this._templateDir, templateName);
    if (FileSystem.exists(directPath)) {
      return directPath;
    }

    return liquidPath; // Return the expected path for error messages
  }

  /**
   * Sanitize template data to prevent XSS and ensure valid output
   */
  private _sanitizeTemplateData(data: ITemplateData): ITemplateData {
    // Deep clone and sanitize strings
    const sanitize = (value: any): any => {
      if (typeof value === 'string') {
        // Basic HTML escaping for security
        return value
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }
      if (Array.isArray(value)) {
        return value.map(sanitize);
      }
      if (typeof value === 'object' && value !== null) {
        const sanitized: any = {};
        for (const key in value) {
          sanitized[key] = sanitize(value[key]);
        }
        return sanitized;
      }
      return value;
    };

    return sanitize(data) as ITemplateData;
  }

  /**
   * Post-process template output to ensure valid MDX
   */
  private _postProcessOutput(output: string): string {
    // Remove any potentially harmful content
    let processed = output.trim();

    // Remove script tags and javascript: protocols
    processed = processed.replace(/<script[^\u003e]*>[\s\S]*?<\/script\u003e/gi, '');
    processed = processed.replace(/javascript:/gi, '');

    return processed;
  }

  /**
   * Register custom Liquid filters
   */
  private _registerCustomFilters(): void {
    // Add a 'markdown' filter for converting text to markdown
    this._liquid.registerFilter('markdown', (input: string) => {
      // Basic markdown escaping
      return input.replace(/[\`*_{}[\]()#+\-.!]/g, '\\$\u0026');
    });

    // Add a 'kebab_case' filter
    this._liquid.registerFilter('kebab_case', (input: string) => {
      return input.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
    });

    // Add a 'snake_case' filter
    this._liquid.registerFilter('snake_case', (input: string) => {
      return input.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
    });

    // Add a 'title_case' filter
    this._liquid.registerFilter('title_case', (input: string) => {
      return input.replace(/([A-Z])/g, ' $1').trim();
    });

    // Add a 'pluralize' filter
    this._liquid.registerFilter('pluralize', (input: string, count: number) => {
      if (count === 1) return input;
      // Simple pluralization rules
      if (input.endsWith('y')) return input.slice(0, -1) + 'ies';
      if (input.endsWith('s') || input.endsWith('x') || input.endsWith('z') || input.endsWith('ch') || input.endsWith('sh')) {
        return input + 'es';
      }
      return input + 's';
    });

    // Add a 'truncate' filter
    this._liquid.registerFilter('truncate', (input: string, length: number = 100, suffix: string = '...') => {
      if (input.length <= length) return input;
      return input.substring(0, length - suffix.length) + suffix;
    });
  }

  /**
   * Clear the template cache
   */
  public clearCache(): void {
    this._templateCache.clear();
  }
}