// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import * as path from 'path';
import { PackageName, FileSystem, NewlineKind } from '@rushstack/node-core-library';

import { SecurityUtils } from '../utils/SecurityUtils';
import { DocumentationError, ErrorCode, FileSystemError, ValidationError } from '../errors/DocumentationError';
import { ErrorBoundary } from '../errors/ErrorBoundary';
import { NavigationManager, NavigationItem } from '../navigation/NavigationManager';
import { CacheManager, getGlobalCacheManager } from '../cache/CacheManager';
import { getGlobalPerformanceMonitor } from '../performance/PerformanceMonitor';
import {
  DocSection,
  DocPlainText,
  DocLinkTag,
  type TSDocConfiguration,
  StringBuilder,
  DocNodeKind,
  DocParagraph,
  DocCodeSpan,
  DocFencedCode,
  StandardTags,
  type DocBlock,
  type DocComment,
  type DocNodeContainer
} from '@microsoft/tsdoc';
import {
  type ApiModel,
  type ApiItem,
  type ApiEnum,
  type ApiPackage,
  ApiItemKind,
  ApiReleaseTagMixin,
  ApiDocumentedItem,
  ApiClass,
  ReleaseTag,
  ApiStaticMixin,
  ApiPropertyItem,
  ApiInterface,
  type Excerpt,
  ApiAbstractMixin,
  ApiParameterListMixin,
  ApiReturnTypeMixin,
  ApiDeclaredItem,
  type ApiNamespace,
  ExcerptTokenKind,
  type IResolveDeclarationReferenceResult,
  ApiTypeAlias,
  type ExcerptToken,
  ApiOptionalMixin,
  ApiInitializerMixin,
  ApiProtectedMixin,
  ApiReadonlyMixin,
  type IFindApiItemsResult
} from '@microsoft/api-extractor-model';

import { CustomDocNodes } from '../nodes/CustomDocNodeKind';
import { DocHeading } from '../nodes/DocHeading';
import { DocTable } from '../nodes/DocTable';
import { DocEmphasisSpan } from '../nodes/DocEmphasisSpan';
import { DocTableRow } from '../nodes/DocTableRow';
import { DocTableCell } from '../nodes/DocTableCell';
import { DocNoteBox } from '../nodes/DocNoteBox';
import { Utilities } from '../utils/Utilities';
import { CustomMarkdownEmitter } from '../markdown/CustomMarkdownEmitter';
import { LiquidTemplateManager, TemplateDataConverter } from '../templates';

export interface IMarkdownDocumenterOptions {
  apiModel: ApiModel;
  outputFolder: string;
  docsJsonPath?: string;
  tabName?: string;
  groupName?: string;
  enableMenu?: boolean;
  convertReadme?: boolean;
  readmeTitle?: string;

  /**
   * Template configuration for customizing output
   */
  templates?: {
    /**
     * Directory containing user templates (Liquid files)
     */
    userTemplateDir?: string;

    /**
     * Individual template overrides - map template names to file paths
     * Example: `{ class: './my-templates/custom-class.liquid' \}`
     */
    overrides?: Record<string, string>;

    /**
     * Whether to enable template caching (default: true)
     */
    cache?: boolean;

    /**
     * Whether to use strict mode for templates (default: true)
     */
    strict?: boolean;
  };
}


/**
 * Core class for rendering API documentation in Mintlify-compatible MDX format.
 * 
 * This class takes TypeScript API model data and converts it into MDX files with proper
 * Mintlify frontmatter, navigation integration, and formatting suitable for documentation sites.
 * 
 * @public
 */
export class MarkdownDocumenter {
  private readonly _apiModel: ApiModel;
  private readonly _tsdocConfiguration: TSDocConfiguration;
  private readonly _markdownEmitter: CustomMarkdownEmitter;
  private readonly _outputFolder: string;
  private readonly _navigationManager: NavigationManager;
  private readonly _templateManager: LiquidTemplateManager;
  private readonly _templateDataConverter: TemplateDataConverter;
  private _convertReadme: boolean = false;
  private _readmeTitle: string = 'README';

  /**
   * Icon mapping for different API item types
   */
  private static readonly API_ITEM_ICONS: Partial<Record<ApiItemKind, string>> = {
    [ApiItemKind.Class]: 'box',
    [ApiItemKind.Interface]: 'plug',
    [ApiItemKind.Function]: 'function',
    [ApiItemKind.Method]: 'function',
    [ApiItemKind.Constructor]: 'function',
    [ApiItemKind.Property]: 'variable',
    [ApiItemKind.Enum]: 'list',
    [ApiItemKind.TypeAlias]: 'file-code',
    [ApiItemKind.Variable]: 'variable',
    [ApiItemKind.Namespace]: 'folder',
    [ApiItemKind.Package]: 'package',
    [ApiItemKind.Model]: 'book'
  };

  public constructor(options: IMarkdownDocumenterOptions) {
    this._apiModel = options.apiModel;
    this._outputFolder = options.outputFolder;
    this._convertReadme = options.convertReadme || false;
    this._readmeTitle = options.readmeTitle || 'README';
    this._tsdocConfiguration = CustomDocNodes.configuration;

    // Initialize template system
    this._templateDataConverter = new TemplateDataConverter();
    this._templateManager = new LiquidTemplateManager({
      userTemplateDir: options.templates?.userTemplateDir,
      overrides: options.templates?.overrides,
      cache: options.templates?.cache !== false,
      strict: options.templates?.strict !== false
    });

    // Initialize cache manager for performance
    const cacheManager = getGlobalCacheManager({
      enabled: true,
      enableStats: true,
      typeAnalysis: { maxSize: 1000, enabled: true },
      apiResolution: { maxSize: 500, enabled: true }
    });

    // Initialize performance monitoring
    const performanceMonitor = getGlobalPerformanceMonitor(true);

    // Create markdown emitter with caching
    this._markdownEmitter = new CustomMarkdownEmitter(this._apiModel);

    // Initialize navigation manager
    this._navigationManager = new NavigationManager({
      docsJsonPath: options.docsJsonPath,
      tabName: options.tabName,
      groupName: options.groupName,
      enableMenu: options.enableMenu,
      outputFolder: this._outputFolder
    });
  }

  public async generateFiles(): Promise<void> {
    const performanceMonitor = getGlobalPerformanceMonitor();
    const cacheManager = getGlobalCacheManager();

    await performanceMonitor.measureAsync('Documentation Generation', async () => {
      console.log();

      // Initialize template system
      await this._templateManager.initialize();

      try {
        this._deleteOldOutputFiles();

        // Copy Mintlify components to snippets folder
        this._copyMintlifyComponents();

        // Use the new template-based approach
        await this._writeApiItemPageTemplate(this._apiModel);

        // Convert README.md to index.mdx if requested
        if (this._convertReadme) {
          this._convertReadmeToIndex();
        }

        // Generate navigation after all pages are written
        const navigationConfig = this._navigationManager.getStats();
        if (navigationConfig.totalItems > 0) {
          this.generateNavigation();
        }

        // Print performance statistics
        performanceMonitor.printSummary();

        // Print cache statistics
        cacheManager.printStats();
      } finally {
        // Cleanup template resources
        await this._templateManager.cleanup();
      }
    });
  }

  /**
   * Write API item page (handles both template and legacy approaches)
   */
  private _writeApiItemPage(apiItem: ApiItem): void {
    // For now, use the legacy approach until we complete the template migration
    // This prevents breaking existing functionality
    this._writeApiItemPageLegacy(apiItem);
  }

  /**
   * Generate documentation page using templates (new approach)
   */
  private async _writeApiItemPageTemplate(apiItem: ApiItem): Promise<void> {
    const icon = this._getIconForApiItem(apiItem);
    const description = this._getDescription(apiItem) || `${apiItem.displayName} API documentation`;

    // Build breadcrumb
    const breadcrumb = this._buildBreadcrumb(apiItem);

    // Build navigation info for top-level items
    const navigation = this._buildNavigationInfo(apiItem);

    // Convert API item to template data
    const templateData = this._templateDataConverter.convertApiItem(apiItem, {
      pageTitle: this._getPageTitle(apiItem),
      pageDescription: description,
      pageIcon: icon,
      breadcrumb: breadcrumb,
      navigation: navigation,
      getLinkFilenameForApiItem: (item: ApiItem) => this._getLinkFilenameForApiItem(item)
    });

    // Render template
    const renderedContent = await this._templateManager.renderApiItem(apiItem, templateData);

    // Generate filename
    const safeFilename = this._getFilenameForApiItem(apiItem);
    const filename = path.join(this._outputFolder, safeFilename);

    // Validate and write file
    try {
      SecurityUtils.validateFilePath(this._outputFolder, filename);

      const maxFileSize = 50 * 1024 * 1024; // 50MB limit
      if (renderedContent.length > maxFileSize) {
        throw new ValidationError(
          `Generated content exceeds maximum file size of 50MB for ${filename}`,
          { resource: filename, operation: 'validateFileContent', data: { size: renderedContent.length } }
        );
      }

      FileSystem.writeFile(filename, renderedContent, {
        convertLineEndings: NewlineKind.CrLf
      });
    } catch (error) {
      if (error instanceof DocumentationError) {
        throw error;
      }
      throw new FileSystemError(
        `Failed to write documentation file: ${filename}`,
        ErrorCode.FILE_WRITE_ERROR,
        {
          resource: filename,
          operation: 'writeFile',
          cause: error instanceof Error ? error : new Error(String(error))
        }
      );
    }

    // Process child items recursively
    if ('members' in apiItem) {
      for (const member of (apiItem as any).members) {
        await this._writeApiItemPageTemplate(member);
      }
    }
  }

  /**
   * Get icon for API item
   */
  private _getIconForApiItem(apiItem: ApiItem): string {
    return MarkdownDocumenter.API_ITEM_ICONS[apiItem.kind] || 'file';
  }

  /**
   * Get group for API item in navigation
   */
  private _getGroupForApiItem(apiItem: ApiItem): string | undefined {
    // Group by item kind for better organization
    switch (apiItem.kind) {
      case ApiItemKind.Class:
        return 'Classes';
      case ApiItemKind.Interface:
        return 'Interfaces';
      case ApiItemKind.Function:
      case ApiItemKind.Method:
      case ApiItemKind.Constructor:
        return 'Functions & Methods';
      case ApiItemKind.Property:
        return 'Properties';
      case ApiItemKind.Enum:
        return 'Enumerations';
      case ApiItemKind.TypeAlias:
        return 'Type Aliases';
      case ApiItemKind.Variable:
        return 'Variables';
      case ApiItemKind.Namespace:
        return 'Namespaces';
      case ApiItemKind.Package:
        return 'Packages';
      default:
        return undefined;
    }
  }

  /**
   * Build breadcrumb navigation data for template
   */
  private _buildBreadcrumb(apiItem: ApiItem): Array<{ name: string; path?: string }> {
    const breadcrumb: Array<{ name: string; path?: string }> = [];
    const ancestors = apiItem.getHierarchy();

    for (const ancestor of ancestors) {
      if (ancestor === this._apiModel) {
        breadcrumb.push({ name: 'API Reference', path: undefined });
      } else {
        // Skip items with empty display names
        if (!ancestor.displayName || ancestor.displayName.trim().length === 0) {
          continue;
        }

        const filename = this._getLinkFilenameForApiItem(ancestor);
        breadcrumb.push({
          name: ancestor.displayName,
          path: filename
        });
      }
    }

    return breadcrumb;
  }

  /**
   * Build navigation info for top-level items
   */
  private _buildNavigationInfo(apiItem: ApiItem): { id: string; title: string; group?: string } | undefined {
    // Only add navigation for top-level items (packages, main namespaces)
    if (apiItem.parent === this._apiModel ||
        (apiItem.parent?.kind === ApiItemKind.Package && apiItem.parent.parent === this._apiModel)) {
      // Skip items with empty display names
      if (!apiItem.displayName || apiItem.displayName.trim().length === 0) {
        return undefined;
      }

      return {
        id: this._getFilenameForApiItem(apiItem),
        title: apiItem.displayName,
        group: this._getGroupForApiItem(apiItem)
      };
    }
    return undefined;
  }

  /**
   * Get page title for API item
   */
  private _getPageTitle(apiItem: ApiItem): string {
    const scopedName = apiItem.getScopedNameWithinPackage();

    switch (apiItem.kind) {
      case ApiItemKind.Class:
        return `${scopedName} class`;
      case ApiItemKind.Interface:
        return `${scopedName} interface`;
      case ApiItemKind.Function:
        return `${scopedName} function`;
      case ApiItemKind.Method:
      case ApiItemKind.MethodSignature:
        return `${scopedName} method`;
      case ApiItemKind.Constructor:
      case ApiItemKind.ConstructSignature:
        return scopedName;
      case ApiItemKind.Property:
      case ApiItemKind.PropertySignature:
        return `${scopedName} property`;
      case ApiItemKind.Enum:
        return `${scopedName} enum`;
      case ApiItemKind.TypeAlias:
        return `${scopedName} type`;
      case ApiItemKind.Variable:
        return `${scopedName} variable`;
      case ApiItemKind.Namespace:
        return `${scopedName} namespace`;
      case ApiItemKind.Package:
        const unscopedPackageName: string = PackageName.getUnscopedName(apiItem.displayName);
        return `${unscopedPackageName} package`;
      case ApiItemKind.Model:
        return 'API Reference';
      default:
        return scopedName;
    }
  }


  /**
   * Get text content from DocSection
   */
  private _getTextFromDocSection(docSection: DocSection): string {
    const stringBuilder = new StringBuilder();
    this._markdownEmitter.emit(stringBuilder, docSection, {
      contextApiItem: undefined,
      onGetFilenameForApiItem: () => undefined
    });
    return stringBuilder.toString().trim();
  }

  /**
   * DEPRECATED: Generate documentation page using DocNode building (old approach)
   * This method will be removed once template system is fully implemented
   */
  private _writeApiItemPageLegacy(apiItem: ApiItem): void {
    const configuration: TSDocConfiguration = this._tsdocConfiguration;
    const output: DocSection = new DocSection({ configuration });

    this._writeBreadcrumb(output, apiItem);

    const scopedName: string = apiItem.getScopedNameWithinPackage();

    switch (apiItem.kind) {
      case ApiItemKind.Class:
        output.appendNode(new DocHeading({ configuration, title: `${scopedName} class` }));
        break;
      case ApiItemKind.Enum:
        output.appendNode(new DocHeading({ configuration, title: `${scopedName} enum` }));
        break;
      case ApiItemKind.Interface:
        output.appendNode(new DocHeading({ configuration, title: `${scopedName} interface` }));
        break;
      case ApiItemKind.Constructor:
      case ApiItemKind.ConstructSignature:
        output.appendNode(new DocHeading({ configuration, title: scopedName }));
        break;
      case ApiItemKind.Method:
      case ApiItemKind.MethodSignature:
        output.appendNode(new DocHeading({ configuration, title: `${scopedName} method` }));
        break;
      case ApiItemKind.Function:
        output.appendNode(new DocHeading({ configuration, title: `${scopedName} function` }));
        break;
      case ApiItemKind.Model:
        output.appendNode(new DocHeading({ configuration, title: `API Reference` }));
        break;
      case ApiItemKind.Namespace:
        output.appendNode(new DocHeading({ configuration, title: `${scopedName} namespace` }));
        break;
      case ApiItemKind.Package:
        console.log(`Writing ${apiItem.displayName} package`);
        const unscopedPackageName: string = PackageName.getUnscopedName(apiItem.displayName);
        output.appendNode(new DocHeading({ configuration, title: `${unscopedPackageName} package` }));
        break;
      case ApiItemKind.Property:
      case ApiItemKind.PropertySignature:
        output.appendNode(new DocHeading({ configuration, title: `${scopedName} property` }));
        break;
      case ApiItemKind.TypeAlias:
        output.appendNode(new DocHeading({ configuration, title: `${scopedName} type` }));
        break;
      case ApiItemKind.Variable:
        output.appendNode(new DocHeading({ configuration, title: `${scopedName} variable` }));
        break;
      default:
        throw new Error('Unsupported API item kind: ' + apiItem.kind);
    }

    if (ApiReleaseTagMixin.isBaseClassOf(apiItem)) {
      if (apiItem.releaseTag === ReleaseTag.Alpha) {
        this._writeAlphaWarning(output);
      } else if (apiItem.releaseTag === ReleaseTag.Beta) {
        this._writeBetaWarning(output);
      }
    }

    const decoratorBlocks: DocBlock[] = [];

    if (apiItem instanceof ApiDocumentedItem) {
      const tsdocComment: DocComment | undefined = apiItem.tsdocComment;

      if (tsdocComment) {
        decoratorBlocks.push(
          ...tsdocComment.customBlocks.filter(
            (block) => block.blockTag.tagNameWithUpperCase === StandardTags.decorator.tagNameWithUpperCase
          )
        );

        if (tsdocComment.deprecatedBlock) {
          output.appendNode(
            new DocNoteBox({ configuration }, [
              new DocParagraph({ configuration }, [
                new DocPlainText({
                  configuration,
                  text: 'Warning: This API is now obsolete. '
                })
              ]),
              ...tsdocComment.deprecatedBlock.content.nodes
            ])
          );
        }

        this._appendSection(output, tsdocComment.summarySection);
      }
    }

    if (apiItem instanceof ApiDeclaredItem) {
      if (apiItem.excerpt.text.length > 0) {
        output.appendNode(
          new DocParagraph({ configuration }, [
            new DocEmphasisSpan({ configuration, bold: true }, [
              new DocPlainText({ configuration, text: 'Signature:' })
            ])
          ])
        );
        output.appendNode(
          new DocFencedCode({
            configuration,
            code: apiItem.getExcerptWithModifiers(),
            language: 'typescript'
          })
        );
      }

      this._writeHeritageTypes(output, apiItem);
    }

    if (decoratorBlocks.length > 0) {
      output.appendNode(
        new DocParagraph({ configuration }, [
          new DocEmphasisSpan({ configuration, bold: true }, [
            new DocPlainText({ configuration, text: 'Decorators:' })
          ])
        ])
      );
      for (const decoratorBlock of decoratorBlocks) {
        output.appendNodes(decoratorBlock.content.nodes);
      }
    }

    let appendRemarks: boolean = true;
    switch (apiItem.kind) {
      case ApiItemKind.Class:
      case ApiItemKind.Interface:
      case ApiItemKind.Namespace:
      case ApiItemKind.Package:
        this._writeRemarksSection(output, apiItem);
        appendRemarks = false;
        break;
    }

    switch (apiItem.kind) {
      case ApiItemKind.Class:
        this._writeClassTables(output, apiItem as ApiClass);
        break;
      case ApiItemKind.Enum:
        this._writeEnumTables(output, apiItem as ApiEnum);
        break;
      case ApiItemKind.Interface:
        this._writeInterfaceTables(output, apiItem as ApiInterface);
        break;
      case ApiItemKind.Constructor:
      case ApiItemKind.ConstructSignature:
      case ApiItemKind.Method:
      case ApiItemKind.MethodSignature:
      case ApiItemKind.Function:
        this._writeParameterTables(output, apiItem as ApiParameterListMixin);
        this._writeThrowsSection(output, apiItem);
        break;
      case ApiItemKind.Namespace:
        this._writePackageOrNamespaceTables(output, apiItem as ApiNamespace);
        break;
      case ApiItemKind.Model:
        this._writeModelTable(output, apiItem as ApiModel);
        break;
      case ApiItemKind.Package:
        this._writePackageOrNamespaceTables(output, apiItem as ApiPackage);
        break;
      case ApiItemKind.Property:
      case ApiItemKind.PropertySignature:
        break;
      case ApiItemKind.TypeAlias:
        break;
      case ApiItemKind.Variable:
        break;
      default:
        throw new Error('Unsupported API item kind: ' + apiItem.kind);
    }

    if (appendRemarks) {
      this._writeRemarksSection(output, apiItem);
    }

    // Validate the output folder path and generate safe filename
    const safeFilename = this._getFilenameForApiItem(apiItem);

    // Ensure the filename is safe and doesn't contain path traversal
    let filename: string;
    try {
      // Validate that the generated filename is safe
      const validatedFilename = SecurityUtils.validateFilename(safeFilename);

      // Validate the full path stays within the output folder
      filename = path.join(this._outputFolder, validatedFilename);
      const validatedPath = SecurityUtils.validateFilePath(this._outputFolder, filename);

      // Use the validated path for the actual filename
      filename = validatedPath;
    } catch (error) {
      throw new ValidationError(
        `Invalid filename generated for API item: ${apiItem.displayName}`,
        {
          resource: apiItem.displayName,
          operation: 'generateFilename',
          cause: error instanceof Error ? error : new Error(String(error)),
          suggestion: 'Check if the API item name contains special characters'
        }
      );
    }
    const stringBuilder: StringBuilder = new StringBuilder();

    // Add Mintlify frontmatter
    stringBuilder.append(this._generateFrontmatter(apiItem));
    stringBuilder.append('\n');
    
    stringBuilder.append(
      '{/* Do not edit this file. It is automatically generated by API Documenter. */}\n\n'
    );

    this._markdownEmitter.emit(stringBuilder, output, {
      contextApiItem: apiItem,
      onGetFilenameForApiItem: (apiItemForFilename: ApiItem) => {
        return this._getLinkFilenameForApiItem(apiItemForFilename);
      }
    });

    let pageContent: string = stringBuilder.toString();

    // Validate file path and content before writing
    try {
      // Validate that the filename is within the allowed output directory
      const validatedFilename = SecurityUtils.validateFilePath(this._outputFolder, filename);

      // Validate file content size (prevent DoS with huge files)
      const maxFileSize = 50 * 1024 * 1024; // 50MB limit
      if (pageContent.length > maxFileSize) {
        throw new ValidationError(
          `Generated content exceeds maximum file size of 50MB for ${filename}`,
          { resource: filename, operation: 'validateFileContent', data: { size: pageContent.length } }
        );
      }

      // Write file with error handling
      FileSystem.writeFile(validatedFilename, pageContent, {
        convertLineEndings: NewlineKind.CrLf
      });
    } catch (error) {
      if (error instanceof DocumentationError) {
        throw error;
      }
      throw new FileSystemError(
        `Failed to write documentation file: ${filename}`,
        ErrorCode.FILE_WRITE_ERROR,
        {
          resource: filename,
          operation: 'writeDocumentationFile',
          cause: error instanceof Error ? error : new Error(String(error)),
          suggestion: 'Check file permissions and available disk space'
        }
      );
    }

    // Add to navigation if this is a top-level item and navigation is configured
    const navigationConfig = this._navigationManager.getStats();
    if (navigationConfig.tabName && this._isTopLevelItem(apiItem)) {
      this._addToNavigation(apiItem, filename);
    }
  }

  private _writeHeritageTypes(output: DocSection, apiItem: ApiDeclaredItem): void {
    const configuration: TSDocConfiguration = this._tsdocConfiguration;

    if (apiItem instanceof ApiClass) {
      if (apiItem.extendsType) {
        const extendsParagraph: DocParagraph = new DocParagraph({ configuration }, [
          new DocEmphasisSpan({ configuration, bold: true }, [
            new DocPlainText({ configuration, text: 'Extends: ' })
          ])
        ]);
        this._appendExcerptWithHyperlinks(extendsParagraph, apiItem.extendsType.excerpt);
        output.appendNode(extendsParagraph);
      }
      if (apiItem.implementsTypes.length > 0) {
        const implementsParagraph: DocParagraph = new DocParagraph({ configuration }, [
          new DocEmphasisSpan({ configuration, bold: true }, [
            new DocPlainText({ configuration, text: 'Implements: ' })
          ])
        ]);
        let needsComma: boolean = false;
        for (const implementsType of apiItem.implementsTypes) {
          if (needsComma) {
            implementsParagraph.appendNode(new DocPlainText({ configuration, text: ', ' }));
          }
          this._appendExcerptWithHyperlinks(implementsParagraph, implementsType.excerpt);
          needsComma = true;
        }
        output.appendNode(implementsParagraph);
      }
    }

    if (apiItem instanceof ApiInterface) {
      if (apiItem.extendsTypes.length > 0) {
        const extendsParagraph: DocParagraph = new DocParagraph({ configuration }, [
          new DocEmphasisSpan({ configuration, bold: true }, [
            new DocPlainText({ configuration, text: 'Extends: ' })
          ])
        ]);
        let needsComma: boolean = false;
        for (const extendsType of apiItem.extendsTypes) {
          if (needsComma) {
            extendsParagraph.appendNode(new DocPlainText({ configuration, text: ', ' }));
          }
          this._appendExcerptWithHyperlinks(extendsParagraph, extendsType.excerpt);
          needsComma = true;
        }
        output.appendNode(extendsParagraph);
      }
    }

    if (apiItem instanceof ApiTypeAlias) {
      const refs: ExcerptToken[] = apiItem.excerptTokens.filter(
        (token) =>
          token.kind === ExcerptTokenKind.Reference &&
          token.canonicalReference &&
          this._apiModel.resolveDeclarationReference(token.canonicalReference, undefined).resolvedApiItem
      );
      if (refs.length > 0) {
        const referencesParagraph: DocParagraph = new DocParagraph({ configuration }, [
          new DocEmphasisSpan({ configuration, bold: true }, [
            new DocPlainText({ configuration, text: 'References: ' })
          ])
        ]);
        let needsComma: boolean = false;
        const visited: Set<string> = new Set();
        for (const ref of refs) {
          if (visited.has(ref.text)) {
            continue;
          }
          visited.add(ref.text);

          if (needsComma) {
            referencesParagraph.appendNode(new DocPlainText({ configuration, text: ', ' }));
          }

          this._appendExcerptTokenWithHyperlinks(referencesParagraph, ref);
          needsComma = true;
        }
        output.appendNode(referencesParagraph);
      }
    }
  }

  private _writeRemarksSection(output: DocSection, apiItem: ApiItem): void {
    const configuration: TSDocConfiguration = this._tsdocConfiguration;

    if (apiItem instanceof ApiDocumentedItem) {
      const tsdocComment: DocComment | undefined = apiItem.tsdocComment;

      if (tsdocComment) {
        // Write the @remarks block
        if (tsdocComment.remarksBlock) {
          output.appendNode(new DocHeading({ configuration, title: 'Remarks' }));
          this._appendSection(output, tsdocComment.remarksBlock.content);
        }

        // Write the @example blocks
        const exampleBlocks: DocBlock[] = tsdocComment.customBlocks.filter(
          (x) => x.blockTag.tagNameWithUpperCase === StandardTags.example.tagNameWithUpperCase
        );

        let exampleNumber: number = 1;
        for (const exampleBlock of exampleBlocks) {
          const heading: string = exampleBlocks.length > 1 ? `Example ${exampleNumber}` : 'Example';

          output.appendNode(new DocHeading({ configuration, title: heading }));

          this._appendSection(output, exampleBlock.content);

          ++exampleNumber;
        }
      }
    }
  }

  private _writeThrowsSection(output: DocSection, apiItem: ApiItem): void {
    const configuration: TSDocConfiguration = this._tsdocConfiguration;

    if (apiItem instanceof ApiDocumentedItem) {
      const tsdocComment: DocComment | undefined = apiItem.tsdocComment;

      if (tsdocComment) {
        // Write the @throws blocks
        const throwsBlocks: DocBlock[] = tsdocComment.customBlocks.filter(
          (x) => x.blockTag.tagNameWithUpperCase === StandardTags.throws.tagNameWithUpperCase
        );

        if (throwsBlocks.length > 0) {
          const heading: string = 'Exceptions';
          output.appendNode(new DocHeading({ configuration, title: heading }));

          for (const throwsBlock of throwsBlocks) {
            this._appendSection(output, throwsBlock.content);
          }
        }
      }
    }
  }

  /**
   * GENERATE PAGE: MODEL
   */
  private _writeModelTable(output: DocSection, apiModel: ApiModel): void {
    const configuration: TSDocConfiguration = this._tsdocConfiguration;

    const packagesTable: DocTable = new DocTable({
      configuration,
      headerTitles: ['Package', 'Description']
    });

    for (const apiMember of apiModel.members) {
      const row: DocTableRow = new DocTableRow({ configuration }, [
        this._createTitleCell(apiMember),
        this._createDescriptionCell(apiMember)
      ]);

      switch (apiMember.kind) {
        case ApiItemKind.Package:
          packagesTable.addRow(row);
          // Generate individual page for package
          this._writeApiItemPage(apiMember);
          break;
      }
    }

    if (packagesTable.rows.length > 0) {
      output.appendNode(new DocHeading({ configuration, title: 'Packages' }));
      output.appendNode(packagesTable);
    }
  }

  /**
   * GENERATE PAGE: PACKAGE or NAMESPACE
   */
  private _writePackageOrNamespaceTables(output: DocSection, apiContainer: ApiPackage | ApiNamespace): void {
    const configuration: TSDocConfiguration = this._tsdocConfiguration;

    const abstractClassesTable: DocTable = new DocTable({
      configuration,
      headerTitles: ['Abstract Class', 'Description']
    });

    const classesTable: DocTable = new DocTable({
      configuration,
      headerTitles: ['Class', 'Description']
    });

    const enumerationsTable: DocTable = new DocTable({
      configuration,
      headerTitles: ['Enumeration', 'Description']
    });

    const functionsTable: DocTable = new DocTable({
      configuration,
      headerTitles: ['Function', 'Description']
    });

    const interfacesTable: DocTable = new DocTable({
      configuration,
      headerTitles: ['Interface', 'Description']
    });

    const namespacesTable: DocTable = new DocTable({
      configuration,
      headerTitles: ['Namespace', 'Description']
    });

    const variablesTable: DocTable = new DocTable({
      configuration,
      headerTitles: ['Variable', 'Description']
    });

    const typeAliasesTable: DocTable = new DocTable({
      configuration,
      headerTitles: ['Type Alias', 'Description']
    });

    const apiMembers: ReadonlyArray<ApiItem> =
      apiContainer.kind === ApiItemKind.Package
        ? (apiContainer as ApiPackage).entryPoints[0].members
        : (apiContainer as ApiNamespace).members;

    for (const apiMember of apiMembers) {
      const row: DocTableRow = new DocTableRow({ configuration }, [
        this._createTitleCell(apiMember),
        this._createDescriptionCell(apiMember)
      ]);

      switch (apiMember.kind) {
        case ApiItemKind.Class:
          if (ApiAbstractMixin.isBaseClassOf(apiMember) && apiMember.isAbstract) {
            abstractClassesTable.addRow(row);
          } else {
            classesTable.addRow(row);
          }
          // Generate individual page for class
          this._writeApiItemPage(apiMember);
          break;

        case ApiItemKind.Enum:
          enumerationsTable.addRow(row);
          // Generate individual page for enum
          this._writeApiItemPage(apiMember);
          break;

        case ApiItemKind.Interface:
          interfacesTable.addRow(row);
          // Generate individual page for interface
          this._writeApiItemPage(apiMember);
          break;

        case ApiItemKind.Namespace:
          namespacesTable.addRow(row);
          // Generate individual page for namespace
          this._writeApiItemPage(apiMember);
          break;

        case ApiItemKind.Function:
          functionsTable.addRow(row);
          // Generate individual page for function
          this._writeApiItemPage(apiMember);
          break;

        case ApiItemKind.TypeAlias:
          typeAliasesTable.addRow(row);
          // Generate individual page for type alias
          this._writeApiItemPage(apiMember);
          break;

        case ApiItemKind.Variable:
          variablesTable.addRow(row);
          // Generate individual page for variable
          this._writeApiItemPage(apiMember);
          break;
      }
    }

    if (classesTable.rows.length > 0) {
      output.appendNode(new DocHeading({ configuration, title: 'Classes' }));
      output.appendNode(classesTable);
    }

    if (abstractClassesTable.rows.length > 0) {
      output.appendNode(new DocHeading({ configuration, title: 'Abstract Classes' }));
      output.appendNode(abstractClassesTable);
    }

    if (enumerationsTable.rows.length > 0) {
      output.appendNode(new DocHeading({ configuration, title: 'Enumerations' }));
      output.appendNode(enumerationsTable);
    }
    if (functionsTable.rows.length > 0) {
      output.appendNode(new DocHeading({ configuration, title: 'Functions' }));
      output.appendNode(functionsTable);
    }

    if (interfacesTable.rows.length > 0) {
      output.appendNode(new DocHeading({ configuration, title: 'Interfaces' }));
      output.appendNode(interfacesTable);
    }

    if (namespacesTable.rows.length > 0) {
      output.appendNode(new DocHeading({ configuration, title: 'Namespaces' }));
      output.appendNode(namespacesTable);
    }

    if (variablesTable.rows.length > 0) {
      output.appendNode(new DocHeading({ configuration, title: 'Variables' }));
      output.appendNode(variablesTable);
    }

    if (typeAliasesTable.rows.length > 0) {
      output.appendNode(new DocHeading({ configuration, title: 'Type Aliases' }));
      output.appendNode(typeAliasesTable);
    }
  }

  /**
   * GENERATE PAGE: CLASS
   */
  private _writeClassTables(output: DocSection, apiClass: ApiClass): void {
    const configuration: TSDocConfiguration = this._tsdocConfiguration;

    const eventsTable: DocTable = new DocTable({
      configuration,
      headerTitles: ['Property', 'Modifiers', 'Type', 'Description']
    });

    const constructorsTable: DocTable = new DocTable({
      configuration,
      headerTitles: ['Constructor', 'Modifiers', 'Description']
    });

    const propertiesTable: DocTable = new DocTable({
      configuration,
      headerTitles: ['Property', 'Modifiers', 'Type', 'Description']
    });

    const methodsTable: DocTable = new DocTable({
      configuration,
      headerTitles: ['Method', 'Modifiers', 'Description']
    });

    const apiMembers: readonly ApiItem[] = this._getMembersAndWriteIncompleteWarning(apiClass, output);
    for (const apiMember of apiMembers) {
      const isInherited: boolean = apiMember.parent !== apiClass;
      switch (apiMember.kind) {
        case ApiItemKind.Constructor: {
          constructorsTable.addRow(
            new DocTableRow({ configuration }, [
              this._createTitleCell(apiMember),
              this._createModifiersCell(apiMember),
              this._createDescriptionCell(apiMember, isInherited)
            ])
          );

          // Individual member pages removed - members are included in parent page
          break;
        }
        case ApiItemKind.Method: {
          methodsTable.addRow(
            new DocTableRow({ configuration }, [
              this._createTitleCell(apiMember),
              this._createModifiersCell(apiMember),
              this._createDescriptionCell(apiMember, isInherited)
            ])
          );

          // Individual member pages removed - members are included in parent page
          break;
        }
        case ApiItemKind.Property: {
          if ((apiMember as ApiPropertyItem).isEventProperty) {
            eventsTable.addRow(
              new DocTableRow({ configuration }, [
                this._createTitleCell(apiMember),
                this._createModifiersCell(apiMember),
                this._createPropertyTypeCell(apiMember),
                this._createDescriptionCell(apiMember, isInherited)
              ])
            );
          } else {
            propertiesTable.addRow(
              new DocTableRow({ configuration }, [
                this._createTitleCell(apiMember),
                this._createModifiersCell(apiMember),
                this._createPropertyTypeCell(apiMember),
                this._createDescriptionCell(apiMember, isInherited)
              ])
            );
          }

          // Individual member pages removed - members are included in parent page
          break;
        }
      }
    }

    if (eventsTable.rows.length > 0) {
      output.appendNode(new DocHeading({ configuration, title: 'Events' }));
      output.appendNode(eventsTable);
    }

    if (constructorsTable.rows.length > 0) {
      output.appendNode(new DocHeading({ configuration, title: 'Constructors' }));
      output.appendNode(constructorsTable);
    }

    if (propertiesTable.rows.length > 0) {
      output.appendNode(new DocHeading({ configuration, title: 'Properties' }));
      output.appendNode(propertiesTable);
    }

    if (methodsTable.rows.length > 0) {
      output.appendNode(new DocHeading({ configuration, title: 'Methods' }));
      output.appendNode(methodsTable);
    }
  }

  /**
   * GENERATE PAGE: ENUM
   */
  private _writeEnumTables(output: DocSection, apiEnum: ApiEnum): void {
    const configuration: TSDocConfiguration = this._tsdocConfiguration;

    const enumMembersTable: DocTable = new DocTable({
      configuration,
      headerTitles: ['Member', 'Value', 'Description']
    });

    for (const apiEnumMember of apiEnum.members) {
      enumMembersTable.addRow(
        new DocTableRow({ configuration }, [
          new DocTableCell({ configuration }, [
            new DocParagraph({ configuration }, [
              new DocPlainText({ configuration, text: Utilities.getConciseSignature(apiEnumMember) })
            ])
          ]),
          this._createInitializerCell(apiEnumMember),
          this._createDescriptionCell(apiEnumMember)
        ])
      );
    }

    if (enumMembersTable.rows.length > 0) {
      output.appendNode(new DocHeading({ configuration, title: 'Enumeration Members' }));
      output.appendNode(enumMembersTable);
    }
  }

  /**
   * GENERATE PAGE: INTERFACE
   */
  private _writeInterfaceTables(output: DocSection, apiInterface: ApiInterface): void {
    const configuration: TSDocConfiguration = this._tsdocConfiguration;

    const eventsTable: DocTable = new DocTable({
      configuration,
      headerTitles: ['Property', 'Modifiers', 'Type', 'Description']
    });

    const propertiesTable: DocTable = new DocTable({
      configuration,
      headerTitles: ['Property', 'Modifiers', 'Type', 'Description']
    });

    const methodsTable: DocTable = new DocTable({
      configuration,
      headerTitles: ['Method', 'Description']
    });

    const apiMembers: readonly ApiItem[] = this._getMembersAndWriteIncompleteWarning(apiInterface, output);
    for (const apiMember of apiMembers) {
      const isInherited: boolean = apiMember.parent !== apiInterface;
      switch (apiMember.kind) {
        case ApiItemKind.ConstructSignature:
        case ApiItemKind.MethodSignature: {
          methodsTable.addRow(
            new DocTableRow({ configuration }, [
              this._createTitleCell(apiMember),
              this._createDescriptionCell(apiMember, isInherited)
            ])
          );

          // Individual member pages removed - members are included in parent page
          break;
        }
        case ApiItemKind.PropertySignature: {
          if ((apiMember as ApiPropertyItem).isEventProperty) {
            eventsTable.addRow(
              new DocTableRow({ configuration }, [
                this._createTitleCell(apiMember),
                this._createModifiersCell(apiMember),
                this._createPropertyTypeCell(apiMember),
                this._createDescriptionCell(apiMember, isInherited)
              ])
            );
          } else {
            propertiesTable.addRow(
              new DocTableRow({ configuration }, [
                this._createTitleCell(apiMember),
                this._createModifiersCell(apiMember),
                this._createPropertyTypeCell(apiMember),
                this._createDescriptionCell(apiMember, isInherited)
              ])
            );
          }

          // Individual member pages removed - members are included in parent page
          break;
        }
      }
    }

    if (eventsTable.rows.length > 0) {
      output.appendNode(new DocHeading({ configuration, title: 'Events' }));
      output.appendNode(eventsTable);
    }

    if (propertiesTable.rows.length > 0) {
      output.appendNode(new DocHeading({ configuration, title: 'Properties' }));
      output.appendNode(propertiesTable);
    }

    if (methodsTable.rows.length > 0) {
      output.appendNode(new DocHeading({ configuration, title: 'Methods' }));
      output.appendNode(methodsTable);
    }
  }

  /**
   * GENERATE PAGE: FUNCTION-LIKE
   */
  private _writeParameterTables(output: DocSection, apiParameterListMixin: ApiParameterListMixin): void {
    const configuration: TSDocConfiguration = this._tsdocConfiguration;

    const parametersTable: DocTable = new DocTable({
      configuration,
      headerTitles: ['Parameter', 'Type', 'Description']
    });
    for (const apiParameter of apiParameterListMixin.parameters) {
      const parameterDescription: DocSection = new DocSection({ configuration });

      if (apiParameter.isOptional) {
        parameterDescription.appendNodesInParagraph([
          new DocEmphasisSpan({ configuration, italic: true }, [
            new DocPlainText({ configuration, text: '(Optional)' })
          ]),
          new DocPlainText({ configuration, text: ' ' })
        ]);
      }

      if (apiParameter.tsdocParamBlock) {
        this._appendAndMergeSection(parameterDescription, apiParameter.tsdocParamBlock.content);
      }

      parametersTable.addRow(
        new DocTableRow({ configuration }, [
          new DocTableCell({ configuration }, [
            new DocParagraph({ configuration }, [
              new DocPlainText({ configuration, text: apiParameter.name })
            ])
          ]),
          new DocTableCell({ configuration }, [
            this._createParagraphForTypeExcerpt(apiParameter.parameterTypeExcerpt)
          ]),
          new DocTableCell({ configuration }, parameterDescription.nodes)
        ])
      );
    }

    if (parametersTable.rows.length > 0) {
      output.appendNode(new DocHeading({ configuration, title: 'Parameters' }));
      output.appendNode(parametersTable);
    }

    if (ApiReturnTypeMixin.isBaseClassOf(apiParameterListMixin)) {
      const returnTypeExcerpt: Excerpt = apiParameterListMixin.returnTypeExcerpt;
      output.appendNode(
        new DocParagraph({ configuration }, [
          new DocEmphasisSpan({ configuration, bold: true }, [
            new DocPlainText({ configuration, text: 'Returns:' })
          ])
        ])
      );

      output.appendNode(this._createParagraphForTypeExcerpt(returnTypeExcerpt));

      if (apiParameterListMixin instanceof ApiDocumentedItem) {
        if (apiParameterListMixin.tsdocComment && apiParameterListMixin.tsdocComment.returnsBlock) {
          this._appendSection(output, apiParameterListMixin.tsdocComment.returnsBlock.content);
        }
      }
    }
  }

  private _createParagraphForTypeExcerpt(excerpt: Excerpt): DocParagraph {
    const configuration: TSDocConfiguration = this._tsdocConfiguration;

    const paragraph: DocParagraph = new DocParagraph({ configuration });

    if (!excerpt.text.trim()) {
      paragraph.appendNode(new DocPlainText({ configuration, text: '(not declared)' }));
    } else {
      // Check if the entire type signature is complex and should be treated as a code block
      const fullText = excerpt.text.trim();
      if (this._isComplexTypeSignature(fullText)) {
        // For very complex types, render as a single code span to avoid MDX parsing issues
        paragraph.appendNode(new DocCodeSpan({ configuration, code: fullText }));
      } else {
        this._appendExcerptWithHyperlinks(paragraph, excerpt);
      }
    }

    return paragraph;
  }

  private _appendExcerptWithHyperlinks(docNodeContainer: DocNodeContainer, excerpt: Excerpt): void {
    for (const token of excerpt.spannedTokens) {
      this._appendExcerptTokenWithHyperlinks(docNodeContainer, token);
    }
  }

  private _appendExcerptTokenWithHyperlinks(docNodeContainer: DocNodeContainer, token: ExcerptToken): void {
    const configuration: TSDocConfiguration = this._tsdocConfiguration;

    // Markdown doesn't provide a standardized syntax for hyperlinks inside code spans, so we will render
    // the type expression as DocPlainText.  Instead of creating multiple DocParagraphs, we can simply
    // discard any newlines and let the renderer do normal word-wrapping.
    const unwrappedTokenText: string = token.text.replace(/[\r\n]+/g, ' ');

    // If it's hyperlinkable, then append a DocLinkTag
    if (token.kind === ExcerptTokenKind.Reference && token.canonicalReference) {
      const apiItemResult: IResolveDeclarationReferenceResult = this._apiModel.resolveDeclarationReference(
        token.canonicalReference,
        undefined
      );

      if (apiItemResult.resolvedApiItem) {
        docNodeContainer.appendNode(
          new DocLinkTag({
            configuration,
            tagName: '@link',
            linkText: unwrappedTokenText,
            urlDestination: this._getLinkFilenameForApiItem(apiItemResult.resolvedApiItem)
          })
        );
        return;
      }
    }

    // For complex type signatures that might cause MDX parsing issues, wrap them in a code span
    // This is particularly important for types with curly braces, complex generics, or function signatures
    if (this._isComplexTypeSignature(unwrappedTokenText)) {
      docNodeContainer.appendNode(new DocCodeSpan({ configuration, code: unwrappedTokenText }));
    } else {
      // Otherwise append non-hyperlinked text
      docNodeContainer.appendNode(new DocPlainText({ configuration, text: unwrappedTokenText }));
    }
  }

  private _isComplexTypeSignature(text: string): boolean {
    // Check for patterns that commonly cause MDX parsing issues
    return (
      // Function signatures with constructor syntax
      text.includes('{ new (') ||
      // Complex generic types
      (text.includes('<') && text.includes('>') && text.includes('{')) ||
      // Multi-part object types
      (text.includes('{') && text.includes('}') && text.includes(':')) ||
      // Array types with complex generics
      (text.includes('[]') && text.includes('<')) ||
      // Union types with complex members
      (text.includes(' | ') && (text.includes('{') || text.includes('('))) ||
      // Very long type signatures that might wrap awkwardly
      text.length > 80
    );
  }

  private _createTitleCell(apiItem: ApiItem): DocTableCell {
    const configuration: TSDocConfiguration = this._tsdocConfiguration;

    let linkText: string = Utilities.getConciseSignature(apiItem);
    if (ApiOptionalMixin.isBaseClassOf(apiItem) && apiItem.isOptional) {
      linkText += '?';
    }

    return new DocTableCell({ configuration }, [
      new DocParagraph({ configuration }, [
        new DocLinkTag({
          configuration,
          tagName: '@link',
          linkText: linkText,
          urlDestination: this._getLinkFilenameForApiItem(apiItem)
        })
      ])
    ]);
  }

  /**
   * This generates a DocTableCell for an ApiItem including the summary section and "(BETA)" annotation.
   *
   * @remarks
   * We mostly assume that the input is an ApiDocumentedItem, but it's easier to perform this as a runtime
   * check than to have each caller perform a type cast.
   */
  private _createDescriptionCell(apiItem: ApiItem, isInherited: boolean = false): DocTableCell {
    const configuration: TSDocConfiguration = this._tsdocConfiguration;

    const section: DocSection = new DocSection({ configuration });

    if (ApiReleaseTagMixin.isBaseClassOf(apiItem)) {
      if (apiItem.releaseTag === ReleaseTag.Alpha || apiItem.releaseTag === ReleaseTag.Beta) {
        section.appendNodesInParagraph([
          new DocEmphasisSpan({ configuration, bold: true, italic: true }, [
            new DocPlainText({
              configuration,
              text: `(${apiItem.releaseTag === ReleaseTag.Alpha ? 'ALPHA' : 'BETA'})`
            })
          ]),
          new DocPlainText({ configuration, text: ' ' })
        ]);
      }
    }

    if (ApiOptionalMixin.isBaseClassOf(apiItem) && apiItem.isOptional) {
      section.appendNodesInParagraph([
        new DocEmphasisSpan({ configuration, italic: true }, [
          new DocPlainText({ configuration, text: '(Optional)' })
        ]),
        new DocPlainText({ configuration, text: ' ' })
      ]);
    }

    if (apiItem instanceof ApiDocumentedItem) {
      if (apiItem.tsdocComment !== undefined) {
        this._appendAndMergeSection(section, apiItem.tsdocComment.summarySection);
      }
    }

    if (isInherited && apiItem.parent) {
      section.appendNode(
        new DocParagraph({ configuration }, [
          new DocPlainText({ configuration, text: '(Inherited from ' }),
          new DocLinkTag({
            configuration,
            tagName: '@link',
            linkText: apiItem.parent.displayName,
            urlDestination: this._getLinkFilenameForApiItem(apiItem.parent)
          }),
          new DocPlainText({ configuration, text: ')' })
        ])
      );
    }

    return new DocTableCell({ configuration }, section.nodes);
  }

  private _createModifiersCell(apiItem: ApiItem): DocTableCell {
    const configuration: TSDocConfiguration = this._tsdocConfiguration;

    const section: DocSection = new DocSection({ configuration });

    // Output modifiers in syntactically correct order: first access modifier (here: `protected`), then
    // `static` or `abstract` (no member can be both, so the order between the two of them does not matter),
    // last `readonly`. If `override` was supported, it would go directly before `readonly`.

    if (ApiProtectedMixin.isBaseClassOf(apiItem)) {
      if (apiItem.isProtected) {
        section.appendNode(
          new DocParagraph({ configuration }, [new DocCodeSpan({ configuration, code: 'protected' })])
        );
      }
    }

    if (ApiStaticMixin.isBaseClassOf(apiItem)) {
      if (apiItem.isStatic) {
        section.appendNode(
          new DocParagraph({ configuration }, [new DocCodeSpan({ configuration, code: 'static' })])
        );
      }
    }

    if (ApiAbstractMixin.isBaseClassOf(apiItem)) {
      if (apiItem.isAbstract) {
        section.appendNode(
          new DocParagraph({ configuration }, [new DocCodeSpan({ configuration, code: 'abstract' })])
        );
      }
    }

    if (ApiReadonlyMixin.isBaseClassOf(apiItem)) {
      if (apiItem.isReadonly) {
        section.appendNode(
          new DocParagraph({ configuration }, [new DocCodeSpan({ configuration, code: 'readonly' })])
        );
      }
    }

    return new DocTableCell({ configuration }, section.nodes);
  }

  private _createPropertyTypeCell(apiItem: ApiItem): DocTableCell {
    const configuration: TSDocConfiguration = this._tsdocConfiguration;

    const section: DocSection = new DocSection({ configuration });

    if (apiItem instanceof ApiPropertyItem) {
      section.appendNode(this._createParagraphForTypeExcerpt(apiItem.propertyTypeExcerpt));
    }

    return new DocTableCell({ configuration }, section.nodes);
  }

  private _createInitializerCell(apiItem: ApiItem): DocTableCell {
    const configuration: TSDocConfiguration = this._tsdocConfiguration;

    const section: DocSection = new DocSection({ configuration });

    if (ApiInitializerMixin.isBaseClassOf(apiItem)) {
      if (apiItem.initializerExcerpt) {
        section.appendNodeInParagraph(
          new DocCodeSpan({ configuration, code: apiItem.initializerExcerpt.text })
        );
      }
    }

    return new DocTableCell({ configuration }, section.nodes);
  }

  private _writeBreadcrumb(output: DocSection, apiItem: ApiItem): void {
    const configuration: TSDocConfiguration = this._tsdocConfiguration;

    output.appendNodeInParagraph(
      new DocLinkTag({
        configuration,
        tagName: '@link',
        linkText: 'Home',
        urlDestination: this._getLinkFilenameForApiItem(this._apiModel)
      })
    );

    for (const hierarchyItem of apiItem.getHierarchy()) {
      switch (hierarchyItem.kind) {
        case ApiItemKind.Model:
        case ApiItemKind.EntryPoint:
          // We don't show the model as part of the breadcrumb because it is the root-level container.
          // We don't show the entry point because today API Extractor doesn't support multiple entry points;
          // this may change in the future.
          break;
        default:
          output.appendNodesInParagraph([
            new DocPlainText({
              configuration,
              text: ' > '
            }),
            new DocLinkTag({
              configuration,
              tagName: '@link',
              linkText: hierarchyItem.displayName,
              urlDestination: this._getLinkFilenameForApiItem(hierarchyItem)
            })
          ]);
      }
    }
  }

  private _writeAlphaWarning(output: DocSection): void {
    const configuration: TSDocConfiguration = this._tsdocConfiguration;
    const betaWarning: string =
      'This API is provided as an alpha preview for developers and may change' +
      ' based on feedback that we receive.  Do not use this API in a production environment.';
    output.appendNode(
      new DocNoteBox({ configuration }, [
        new DocParagraph({ configuration }, [new DocPlainText({ configuration, text: betaWarning })])
      ])
    );
  }

  private _writeBetaWarning(output: DocSection): void {
    const configuration: TSDocConfiguration = this._tsdocConfiguration;
    const betaWarning: string =
      'This API is provided as a beta preview for developers and may change' +
      ' based on feedback that we receive.  Do not use this API in a production environment.';
    output.appendNode(
      new DocNoteBox({ configuration }, [
        new DocParagraph({ configuration }, [new DocPlainText({ configuration, text: betaWarning })])
      ])
    );
  }

  private _appendSection(output: DocSection, docSection: DocSection): void {
    for (const node of docSection.nodes) {
      output.appendNode(node);
    }
  }

  private _appendAndMergeSection(output: DocSection, docSection: DocSection): void {
    let firstNode: boolean = true;
    for (const node of docSection.nodes) {
      if (firstNode) {
        if (node.kind === DocNodeKind.Paragraph) {
          output.appendNodesInParagraph(node.getChildNodes());
          firstNode = false;
          continue;
        }
      }
      firstNode = false;

      output.appendNode(node);
    }
  }

  private _getMembersAndWriteIncompleteWarning(
    apiClassOrInterface: ApiClass | ApiInterface,
    output: DocSection
  ): readonly ApiItem[] {
    const configuration: TSDocConfiguration = this._tsdocConfiguration;
    const showInheritedMembers: boolean = false; // Simplified: always false for clarity
    if (!showInheritedMembers) {
      return apiClassOrInterface.members;
    }

    const result: IFindApiItemsResult = apiClassOrInterface.findMembersWithInheritance();

    // If the result is potentially incomplete, write a short warning communicating this.
    if (result.maybeIncompleteResult) {
      output.appendNode(
        new DocParagraph({ configuration }, [
          new DocEmphasisSpan({ configuration, italic: true }, [
            new DocPlainText({
              configuration,
              text: '(Some inherited members may not be shown because they are not represented in the documentation.)'
            })
          ])
        ])
      );
    }

    // Log the messages for diagnostic purposes.
    for (const message of result.messages) {
      console.log(`Diagnostic message for findMembersWithInheritance: ${message.text}`);
    }

    return result.items;
  }

  private _getFilenameForApiItem(apiItem: ApiItem): string {
    if (apiItem.kind === ApiItemKind.Model) {
      return 'index.mdx';
    }

    let baseName: string = '';
    for (const hierarchyItem of apiItem.getHierarchy()) {
      // Skip items that should not be included in filename or have empty names
      switch (hierarchyItem.kind) {
        case ApiItemKind.Model:
        case ApiItemKind.EntryPoint:
        case ApiItemKind.EnumMember:
          continue;
        case ApiItemKind.Package:
          baseName = Utilities.getSafeFilenameForName(PackageName.getUnscopedName(hierarchyItem.displayName));
          continue;
      }

      // For overloaded methods, add a suffix such as "MyClass.myMethod_2".
      let qualifiedName: string = Utilities.getSafeFilenameForName(hierarchyItem.displayName);
      if (ApiParameterListMixin.isBaseClassOf(hierarchyItem)) {
        if (hierarchyItem.overloadIndex > 1) {
          // Subtract one for compatibility with earlier releases of API Documenter.
          // (This will get revamped when we fix GitHub issue #1308)
          qualifiedName += `_${hierarchyItem.overloadIndex - 1}`;
        }
      }

      baseName += '.' + qualifiedName;
    }
    return baseName + '.mdx';
  }

  private _getLinkFilenameForApiItem(apiItem: ApiItem): string {
    return './' + this._getFilenameForApiItem(apiItem);
  }

  private _generateFrontmatter(apiItem: ApiItem): string {
    const title = this._getTitle(apiItem);
    const icon = this._getIcon(apiItem);
    const description = this._getDescription(apiItem);

    const frontmatter: any = {
      title
    };

    if (icon) {
      frontmatter.icon = icon;
    }

    if (description) {
      frontmatter.description = description;
    }

    // Sanitize frontmatter values to prevent YAML injection
    try {
      const sanitizedEntries = Object.entries(frontmatter).map(([key, value]) => {
        if (typeof value === 'string') {
          // Use SecurityUtils to sanitize YAML text
          const sanitizedValue = SecurityUtils.sanitizeYamlText(value);
          return `${key}: ${sanitizedValue}`;
        } else {
          // For non-string values, use JSON.stringify but validate first
          const stringValue = JSON.stringify(value);
          // Validate the JSON string doesn't contain dangerous patterns
          if (stringValue.includes('__proto__') || stringValue.includes('constructor')) {
            throw new ValidationError(
              `Invalid frontmatter value for key "${key}": contains dangerous patterns`,
              { resource: key, operation: 'sanitizeFrontmatter' }
            );
          }
          return `${key}: ${stringValue}`;
        }
      });

      return '---\n' + sanitizedEntries.join('\n') + '\n---';
    } catch (error) {
      if (error instanceof DocumentationError) {
        throw error;
      }
      throw new DocumentationError(
        `Failed to generate frontmatter for ${apiItem.displayName}`,
        ErrorCode.RENDER_ERROR,
        {
          resource: apiItem.displayName,
          operation: 'generateFrontmatter',
          cause: error instanceof Error ? error : new Error(String(error))
        }
      );
    }
  }

  private _getTitle(apiItem: ApiItem): string {
    const scopedName: string = apiItem.getScopedNameWithinPackage();
    
    switch (apiItem.kind) {
      case ApiItemKind.Class:
        return `${scopedName} class`;
      case ApiItemKind.Enum:
        return `${scopedName} enum`;
      case ApiItemKind.Interface:
        return `${scopedName} interface`;
      case ApiItemKind.Constructor:
      case ApiItemKind.ConstructSignature:
        return scopedName;
      case ApiItemKind.Method:
      case ApiItemKind.MethodSignature:
        return `${scopedName} method`;
      case ApiItemKind.Function:
        return `${scopedName} function`;
      case ApiItemKind.Model:
        return 'API Reference';
      case ApiItemKind.Namespace:
        return `${scopedName} namespace`;
      case ApiItemKind.Package:
        const unscopedPackageName: string = PackageName.getUnscopedName(apiItem.displayName);
        return `${unscopedPackageName} package`;
      case ApiItemKind.Property:
      case ApiItemKind.PropertySignature:
        return `${scopedName} property`;
      case ApiItemKind.TypeAlias:
        return `${scopedName} type`;
      case ApiItemKind.Variable:
        return `${scopedName} variable`;
      default:
        return scopedName;
    }
  }

  private _getIcon(apiItem: ApiItem): string | undefined {
    const iconMap: Map<ApiItemKind, string> = new Map([
      [ApiItemKind.Class, 'box'],
      [ApiItemKind.Interface, 'square-dashed'],
      [ApiItemKind.Function, 'function'],
      [ApiItemKind.Method, 'function'],
      [ApiItemKind.Property, 'variable'],
      [ApiItemKind.Enum, 'list'],
      [ApiItemKind.TypeAlias, 'type'],
      [ApiItemKind.Namespace, 'folder'],
      [ApiItemKind.Package, 'package'],
      [ApiItemKind.Variable, 'variable']
    ]);

    return iconMap.get(apiItem.kind);
  }

  private _getDescription(apiItem: ApiItem): string | null {
    if (!(apiItem instanceof ApiDocumentedItem) || !apiItem.tsdocComment?.summarySection) {
      return null;
    }

    return this._renderDocSection(apiItem.tsdocComment.summarySection);
  }

  private _renderDocSection(section: DocSection): string {
    const stringBuilder: StringBuilder = new StringBuilder();
    this._markdownEmitter.emit(stringBuilder, section, {
      contextApiItem: this._apiModel,
      onGetFilenameForApiItem: (apiItemForFilename: ApiItem) => {
        return this._getLinkFilenameForApiItem(apiItemForFilename);
      }
    });
    return stringBuilder.toString().trim();
  }

  private _deleteOldOutputFiles(): void {
    console.log('Deleting old output from ' + this._outputFolder);

    // Additional safety check: ensure the folder is actually a documentation output folder
    // by checking if it contains expected files or is empty
    try {
      if (FileSystem.exists(this._outputFolder)) {
        const contents = FileSystem.readFolderItemNames(this._outputFolder);
        const hasExpectedFiles = contents.some(item =>
          item.endsWith('.mdx') ||
          item.endsWith('.md') ||
          item === 'docs.json' ||
          item === 'snippets'
        );

        if (!hasExpectedFiles && contents.length > 0) {
          console.warn(`Warning: Output folder ${this._outputFolder} contains unexpected files. Skipping deletion for safety.`);
          return;
        }
      }

      FileSystem.ensureEmptyFolder(this._outputFolder);
    } catch (error) {
      throw new FileSystemError(
        `Failed to clean output folder: ${this._outputFolder}`,
        ErrorCode.FILE_WRITE_ERROR,
        {
          resource: this._outputFolder,
          operation: 'deleteOldOutputFiles',
          cause: error instanceof Error ? error : new Error(String(error)),
          suggestion: 'Check folder permissions and ensure the path is correct'
        }
      );
    }
  }

  private _isTopLevelItem(apiItem: ApiItem): boolean {
    return [
      ApiItemKind.Class,
      ApiItemKind.Interface,
      ApiItemKind.Function,
      ApiItemKind.TypeAlias,
      ApiItemKind.Enum,
      ApiItemKind.Variable,
      ApiItemKind.Namespace
    ].includes(apiItem.kind);
  }

  private _addToNavigation(apiItem: ApiItem, filename: string): void {
    this._navigationManager.addApiItem(apiItem, filename);
  }

  public generateNavigation(): void {
    try {
      this._navigationManager.generateNavigation();
    } catch (error) {
      console.error('❌ Failed to generate navigation:', error);
      throw error;
    }
  }

  /**
   * Copy Mintlify components (like TypeTree) to the user's docs/snippets/tsdocs folder.
   * This allows generated MDX files to use these components.
   *
   * Note: Mintlify requires components to be in the docs/snippets folder.
   * They cannot be imported directly from npm packages.
   * We use a tsdocs subfolder to avoid conflicts with user's own components.
   */
  private _copyMintlifyComponents(): void {
    // Determine the snippets folder relative to the output folder
    // Typically output is ./docs/api and snippets should be ./docs/snippets/tsdocs
    const docsRoot = path.dirname(this._outputFolder);
    const snippetsFolder = path.join(docsRoot, 'snippets', 'tsdocs');

    // Source components directory in our package
    // When compiled, this will be in lib/documenters/, components will be in lib/components/
    const componentsSource = path.resolve(__dirname, '../components');

    // Ensure snippets folder exists
    FileSystem.ensureFolder(snippetsFolder);

    // List of components to copy
    const components = ['TypeTree.jsx'];

    console.log('📦 Installing Mintlify components...');

    for (const componentFile of components) {
      const sourcePath = path.join(componentsSource, componentFile);
      const targetPath = path.join(snippetsFolder, componentFile);

      // Check if source file exists
      if (!FileSystem.exists(sourcePath)) {
        // This should never happen in a properly built package
        throw new DocumentationError(
          `INTERNAL ERROR: Component source not found in package: ${componentFile}\n` +
          `Expected location: ${sourcePath}\n` +
          `This indicates the package was not built correctly. The build script should copy src/components/ to lib/components/.\n` +
          `Please report this issue at: https://github.com/anthropics/claude-code/issues`,
          ErrorCode.FILE_NOT_FOUND,
          {
            resource: sourcePath,
            operation: 'copyMintlifyComponents',
            suggestion: 'Rebuild the package with: bun run rebuild'
          }
        );
      }

      // Check if we should update the component
      let shouldCopy = true;
      if (FileSystem.exists(targetPath)) {
        // Component already exists - check version
        shouldCopy = this._shouldUpdateComponent(sourcePath, targetPath);
      }

      if (shouldCopy) {
        const componentContent = FileSystem.readFile(sourcePath);
        FileSystem.writeFile(targetPath, componentContent);
        console.log(`   ✓ Installed ${componentFile}`);
      } else {
        console.log(`   ✓ ${componentFile} is up to date`);
      }
    }
  }

  /**
   * Check if a component should be updated based on version comparison
   */
  private _shouldUpdateComponent(sourcePath: string, targetPath: string): boolean {
    try {
      const sourceContent = FileSystem.readFile(sourcePath);
      const targetContent = FileSystem.readFile(targetPath);

      // Extract version from @version JSDoc comment
      const versionRegex = /@version\s+([\d.]+)/;
      const sourceMatch = sourceContent.match(versionRegex);
      const targetMatch = targetContent.match(versionRegex);

      if (!sourceMatch || !targetMatch) {
        // If we can't determine versions, always update
        return true;
      }

      const sourceVersion = sourceMatch[1];
      const targetVersion = targetMatch[1];

      // Simple version comparison (assumes semantic versioning)
      return this._compareVersions(sourceVersion, targetVersion) > 0;
    } catch (error) {
      // On any error, default to updating
      return true;
    }
  }

  /**
   * Compare two semantic version strings
   * Returns: 1 if v1 \> v2, -1 if v1 \< v2, 0 if equal
   */
  private _compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const num1 = parts1[i] || 0;
      const num2 = parts2[i] || 0;

      if (num1 > num2) return 1;
      if (num1 < num2) return -1;
    }

    return 0;
  }

  private _convertReadmeToIndex(): void {
    console.log('🔍 Looking for README.md to convert to index.mdx...');
    
    // Find the API model's package to determine the source directory
    let sourceDirectory = '';
    
    // Check if we can determine source directory from the API model
    for (const apiMember of this._apiModel.members) {
      if (ApiItemKind.Package === apiMember.kind) {
        // Try to find README.md in the package's likely source directory
        // Common locations: current working directory, parent directories
        const possiblePaths = [
          path.resolve('.'),  // Current working directory
          path.resolve('..'), // Parent directory
          path.resolve('../..'), // Grandparent directory
        ];
        
        for (const candidatePath of possiblePaths) {
          const readmePath = path.join(candidatePath, 'README.md');
          if (FileSystem.exists(readmePath)) {
            sourceDirectory = candidatePath;
            console.log(`   ✓ Found README.md at: ${readmePath}`);
            break;
          }
        }
        break;
      }
    }
    
    if (!sourceDirectory) {
      console.log('   ❌ No README.md found in expected locations');
      return;
    }
    
    const readmePath = path.join(sourceDirectory, 'README.md');
    const indexPath = path.join(this._outputFolder, 'index.mdx');
    
    try {
      // Read the README content
      const readmeContent = FileSystem.readFile(readmePath);
      
      // Use custom title or default to 'README'
      const title = this._readmeTitle;
      
      // Convert to MDX with Mintlify frontmatter
      const mdxContent = this._convertReadmeToMdx(readmeContent, title);
      
      // Write the index.mdx file
      FileSystem.writeFile(indexPath, mdxContent);
      
      // Add to navigation if configured
      const navigationConfig = this._navigationManager.getStats();
      if (navigationConfig.docsJsonPath) {
        // Calculate relative path for navigation
        const docsJsonDir = path.dirname(navigationConfig.docsJsonPath);
        const relativePath = path.relative(docsJsonDir, this._outputFolder);
        const indexNavPath = path.posix.join(relativePath, 'index').replace(/\\/g, '/');

        // Add index page to navigation
        this._navigationManager.addNavigationItem({
          page: indexNavPath
        });
      }
      
      console.log(`   ✓ Converted README.md to index.mdx`);
      
    } catch (error) {
      console.error(`   ❌ Failed to convert README.md: ${error}`);
    }
  }
  
  private _convertReadmeToMdx(readmeContent: string, title: string): string {
    // Generate Mintlify frontmatter
    const frontmatter = [
      '---',
      `title: "${title}"`,
      'icon: "book-open"',
      'description: "Overview and introduction to the library"',
      '---'
    ].join('\n');
    
    // Convert HTML comments to MDX comments
    let mdxContent = readmeContent.replace(/<!--([\s\S]*?)-->/g, '{/* $1 */}');
    
    // Remove the first # heading since it's now in the frontmatter
    mdxContent = mdxContent.replace(/^#\s+.+$/m, '');
    
    // Clean up any leading whitespace after removing the heading
    mdxContent = mdxContent.replace(/^\s*\n/, '');
    
    // Add auto-generation notice
    const notice = '{/* This file was auto-generated from README.md by mintlify-tsdocs */}\n\n';
    
    return `${frontmatter}\n${notice}${mdxContent}`;
  }

}
