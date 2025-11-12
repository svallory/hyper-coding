// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import * as path from 'path';
import * as fs from 'fs';
import * as ejs from 'ejs';
import { FileSystem } from '@rushstack/node-core-library';

import { DocumentationError, ErrorCode } from '../errors/DocumentationError';
import { SecurityUtils } from '../utils/SecurityUtils';

/**
 * Interface for template data that gets passed to EJS templates
 */
export interface ITemplateData {
  apiItem: {
    name: string;
    kind: string;
    displayName: string;
    description?: string;
    summary?: string;
    remarks?: string;
    signature?: string;
    isDeprecated?: boolean;
    isAlpha?: boolean;
    isBeta?: boolean;
    releaseTag?: string;
  };
  page: {
    title: string;
    description: string;
    icon: string;
    breadcrumb: Array<{
      name: string;
      path?: string;
    }>;
  };
  // Semantic variables for template data
  constructors?: ITableRow[];
  properties?: ITableRow[];
  methods?: ITableRow[];
  events?: ITableRow[];
  parameters?: ITableRow[];
  returnType?: IReturnData;
  members?: ITableRow[];
  typeAliases?: ITableRow[];
  namespaces?: ITableRow[];
  classes?: ITableRow[];
  interfaces?: ITableRow[];
  functions?: ITableRow[];
  variables?: ITableRow[];
  enumerations?: ITableRow[];
  abstractClasses?: ITableRow[];
  navigation?: {
    id: string;
    title: string;
    group?: string;
  };
  examples?: string[];
  heritageTypes?: Array<{
    name: string;
    path?: string;
  }>;
}

export interface ITableData {
  title: string;
  headers: string[];
  rows: ITableRow[];
}

export interface ITableRow {
  title: string;
  titlePath?: string;
  modifiers?: string[];
  type?: string;
  typePath?: string;
  description?: string;
  isOptional?: boolean;
  isInherited?: boolean;
  isDeprecated?: boolean;
  defaultValue?: string;
}

export interface IReturnData {
  type: string;
  typePath?: string;
  description?: string;
}

/**
 * Configuration for template engine
 */
export interface ITemplateEngineOptions {
  templateDir?: string;
  cache?: boolean;
  strict?: boolean;
}

/**
 * Template engine that processes EJS templates with API data
 */
export class TemplateEngine {
  private readonly _templateDir: string;
  private readonly _cache: boolean;
  private readonly _strict: boolean;
  private readonly _ejsOptions: ejs.Options;
  private readonly _templateCache: Map<string, ejs.TemplateFunction | ejs.AsyncTemplateFunction> = new Map();

  public constructor(options: ITemplateEngineOptions = {}) {
    this._templateDir = options.templateDir || path.join(__dirname, 'defaults');
    this._cache = options.cache !== false;
    this._strict = options.strict !== false;

    this._ejsOptions = {
      cache: this._cache,
      filename: '', // Will be set per template
      root: this._templateDir,
      strict: this._strict
    };
  }

  /**
   * Render a template with the provided data
   */
  public async render(templateName: string, data: ITemplateData): Promise<string> {
    try {
      const template = this._loadTemplate(templateName);
      const sanitizedData = this._sanitizeTemplateData(data);

      let result: string;
      const templateResult = template(sanitizedData);

      // Handle both sync and async templates
      if (typeof templateResult === 'string') {
        result = templateResult;
      } else {
        result = await templateResult;
      }

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
   * Check if a template exists (for user template override logic)
   */
  public hasTemplate(templateName: string): boolean {
    const templatePath = path.join(this._templateDir, `${templateName}.liquid`);
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
  private _loadTemplate(templateName: string): ejs.TemplateFunction | ejs.AsyncTemplateFunction {
    const cacheKey = templateName;

    if (this._cache && this._templateCache.has(cacheKey)) {
      return this._templateCache.get(cacheKey)!;
    }

    const templatePath = path.join(this._templateDir, `${templateName}.liquid`);

    if (!FileSystem.exists(templatePath)) {
      throw new DocumentationError(
        `Template '${templateName}' not found at ${templatePath}`,
        ErrorCode.TEMPLATE_NOT_FOUND
      );
    }

    try {
      const templateContent = FileSystem.readFileToBuffer(templatePath).toString();
      const template = ejs.compile(templateContent, {
        ...this._ejsOptions,
        filename: templatePath
      });

      if (this._cache) {
        this._templateCache.set(cacheKey, template);
      }

      return template;
    } catch (error) {
      throw new DocumentationError(
        `Failed to compile template '${templateName}': ${error instanceof Error ? error.message : String(error)}`,
        ErrorCode.TEMPLATE_COMPILE_ERROR
      );
    }
  }

  /**
   * Sanitize template data to prevent XSS and ensure valid output
   */
  private _sanitizeTemplateData(data: ITemplateData): ITemplateData {
    // Deep clone and sanitize strings
    const sanitize = (value: any): any => {
      if (typeof value === 'string') {
        return SecurityUtils.sanitizeYamlText(value);
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
    let processed = output;

    // Ensure proper MDX formatting
    processed = processed.trim();

    // Basic sanitization - remove script tags
    processed = processed.replace(/\u003cscript[^\u003e]*\u003e[\s\S]*?\u003c\/script\u003e/gi, '');
    processed = processed.replace(/javascript:/gi, '');

    return processed;
  }

  /**
   * Clear the template cache
   */
  public clearCache(): void {
    this._templateCache.clear();
  }
}