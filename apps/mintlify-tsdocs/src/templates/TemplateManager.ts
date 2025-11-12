// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import * as path from 'path';
import { FileSystem } from '@rushstack/node-core-library';

import { TemplateEngine, ITemplateData, ITemplateEngineOptions } from './TemplateEngine';
import { DocumentationError, ErrorCode } from '../errors/DocumentationError';
import { ApiItemKind } from '@microsoft/api-extractor-model';
import type { ApiItem } from '@microsoft/api-extractor-model';
import * as ejs from 'ejs';

/**
 * Configuration for template manager
 */
export interface ITemplateManagerOptions extends ITemplateEngineOptions {
  userTemplateDir?: string;
  defaultTemplateDir?: string;
  /**
   * Individual template overrides - map template names to file paths
   */
  overrides?: Record<string, string>;
}

/**
 * Maps API item kinds to template names
 */
const API_ITEM_TEMPLATE_MAP: Partial<Record<ApiItemKind, string>> = {
  [ApiItemKind.Class]: 'class',
  [ApiItemKind.Interface]: 'interface',
  [ApiItemKind.Function]: 'function',
  [ApiItemKind.Method]: 'method',
  [ApiItemKind.Constructor]: 'constructor',
  [ApiItemKind.Property]: 'property',
  [ApiItemKind.Enum]: 'enum',
  [ApiItemKind.EnumMember]: 'enum-member',
  [ApiItemKind.TypeAlias]: 'type-alias',
  [ApiItemKind.Variable]: 'variable',
  [ApiItemKind.Namespace]: 'namespace',
  [ApiItemKind.Package]: 'package',
  [ApiItemKind.EntryPoint]: 'entry-point',
  [ApiItemKind.Model]: 'model'
};

/**
 * Manages template resolution and rendering with user override support
 */
export class TemplateManager {
  private readonly _userEngine?: TemplateEngine;
  private readonly _defaultEngine: TemplateEngine;
  private readonly _userTemplateDir?: string;
  private readonly _overrides: Record<string, string>;

  public constructor(options: ITemplateManagerOptions = {}) {
    this._userTemplateDir = options.userTemplateDir;
    this._overrides = options.overrides || {};

    // Initialize default template engine
    const defaultTemplateDir = options.defaultTemplateDir || path.join(__dirname, 'defaults');
    this._defaultEngine = new TemplateEngine({
      templateDir: defaultTemplateDir,
      cache: options.cache,
      strict: options.strict
    });

    // Initialize user template engine if directory provided
    if (this._userTemplateDir && FileSystem.exists(this._userTemplateDir)) {
      this._userEngine = new TemplateEngine({
        templateDir: this._userTemplateDir,
        cache: options.cache,
        strict: options.strict
      });
    }
  }

  /**
   * Render an API item using the appropriate template
   */
  public async renderApiItem(apiItem: ApiItem, data: ITemplateData): Promise<string> {
    const templateName = this._getTemplateName(apiItem);
    return this.renderTemplate(templateName, data);
  }

  /**
   * Render a template with user override support
   */
  public async renderTemplate(templateName: string, data: ITemplateData): Promise<string> {
    // Check for individual template override first
    if (this._overrides[templateName]) {
      try {
        const overrideContent = await this._loadOverrideTemplate(templateName);
        return await this._renderTemplateContent(overrideContent, data, templateName);
      } catch (error) {
        console.warn(`Template override '${templateName}' failed, falling back to standard templates:`, error);
      }
    }

    // Try user template directory next
    if (this._userEngine && this._userEngine.hasTemplate(templateName)) {
      try {
        return await this._userEngine.render(templateName, data);
      } catch (error) {
        // If user template fails, fall back to default
        console.warn(`User template '${templateName}' failed, falling back to default:`, error);
      }
    }

    // Use default template
    if (this._defaultEngine.hasTemplate(templateName)) {
      return await this._defaultEngine.render(templateName, data);
    }

    throw new DocumentationError(
      `No template found for '${templateName}'. Available templates: ${this.getAvailableTemplates().join(', ')}`,
      ErrorCode.TEMPLATE_NOT_FOUND
    );
  }

  /**
   * Render a layout template
   */
  public async renderLayout(data: ITemplateData): Promise<string> {
    return this.renderTemplate('layout', data);
  }

  /**
   * Get available template names (both user and default)
   */
  public getAvailableTemplates(): string[] {
    const templates = new Set<string>();

    // Add default templates
    const defaultTemplates = this._defaultEngine.getAvailableTemplates();
    defaultTemplates.forEach(template => templates.add(template));

    // Add user templates
    if (this._userEngine) {
      const userTemplates = this._userEngine.getAvailableTemplates();
      userTemplates.forEach(template => templates.add(template));
    }

    return Array.from(templates).sort();
  }

  /**
   * Check if a user template exists for a given template name
   */
  public hasUserTemplate(templateName: string): boolean {
    return this._userEngine ? this._userEngine.hasTemplate(templateName) : false;
  }

  /**
   * Get template name for an API item
   */
  private _getTemplateName(apiItem: ApiItem): string {
    const kind = apiItem.kind;

    // Check if we have a specific template for this kind
    if (API_ITEM_TEMPLATE_MAP[kind]) {
      return API_ITEM_TEMPLATE_MAP[kind]!;
    }

    // Fallback to generic template
    return 'generic';
  }

  /**
   * Get the template mapping for debugging/information purposes
   */
  public getTemplateMapping(): Partial<Record<ApiItemKind, string>> {
    return { ...API_ITEM_TEMPLATE_MAP };
  }

  /**
   * Clear all template caches
   */
  public clearCache(): void {
    this._defaultEngine.clearCache();
    if (this._userEngine) {
      this._userEngine.clearCache();
    }
  }

  /**
   * Load override template content from file
   */
  private async _loadOverrideTemplate(templateName: string): Promise<string> {
    const overridePath = this._overrides[templateName];
    if (!overridePath) {
      throw new Error(`No override path configured for template '${templateName}'`);
    }

    if (!FileSystem.exists(overridePath)) {
      throw new DocumentationError(
        `Template override file not found: ${overridePath}`,
        ErrorCode.TEMPLATE_NOT_FOUND
      );
    }

    try {
      return FileSystem.readFileToBuffer(overridePath).toString();
    } catch (error) {
      throw new DocumentationError(
        `Failed to read template override file: ${overridePath}`,
        ErrorCode.TEMPLATE_ERROR,
        { cause: error instanceof Error ? error : new Error(String(error)) }
      );
    }
  }

  /**
   * Render template content directly (for overrides)
   */
  private async _renderTemplateContent(content: string, data: ITemplateData, templateName: string): Promise<string> {
    try {
      // We need to manually compile and render since this isn't a file-based template
      const template = ejs.compile(content, {
        filename: this._overrides[templateName],
        cache: false,
        strict: true
      });

      const sanitizedData = this._sanitizeTemplateDataForOverride(data);

      let result: string;
      const templateResult = template(sanitizedData);

      // Handle both sync and async templates
      if (typeof templateResult === 'string') {
        result = templateResult;
      } else {
        result = await templateResult;
      }

      return this._postProcessOverrideOutput(result);
    } catch (error) {
      throw new DocumentationError(
        `Failed to render template override '${templateName}': ${error instanceof Error ? error.message : String(error)}`,
        ErrorCode.TEMPLATE_RENDER_ERROR
      );
    }
  }

  /**
   * Sanitize template data for override templates (simplified version)
   */
  private _sanitizeTemplateDataForOverride(data: ITemplateData): ITemplateData {
    // Basic sanitization for override templates
    const sanitize = (value: any): any => {
      if (typeof value === 'string') {
        return value.replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
   * Post-process override template output
   */
  private _postProcessOverrideOutput(output: string): string {
    // Basic post-processing for override templates
    let processed = output.trim();

    // Remove potentially harmful content
    processed = processed.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    processed = processed.replace(/javascript:/gi, '');

    return processed;
  }

  public getTemplateStats(): {
    userTemplates: string[];
    defaultTemplates: string[];
    userTemplateDir?: string;
    defaultTemplateDir: string;
  } {
    return {
      userTemplates: this._userEngine ? this._userEngine.getAvailableTemplates() : [],
      defaultTemplates: this._defaultEngine.getAvailableTemplates(),
      userTemplateDir: this._userTemplateDir,
      defaultTemplateDir: this._defaultEngine['_templateDir'] // Access private field for debugging
    };
  }
}