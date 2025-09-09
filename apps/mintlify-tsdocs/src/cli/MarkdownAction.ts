// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import type { DocumenterCli } from './ApiDocumenterCommandLine';
import { BaseAction } from './BaseAction';
import { MarkdownDocumenter } from '../documenters/MarkdownDocumenter';
import { type CommandLineStringParameter, type CommandLineFlagParameter } from '@rushstack/ts-command-line';

/**
 * CLI action for generating Mintlify-compatible MDX documentation.
 * 
 * This action reads TypeScript API documentation from .api.json files produced by
 * api-extractor and converts them into MDX files with proper Mintlify frontmatter,
 * navigation integration, and content formatting.
 * 
 * Key features:
 * - Generates .mdx files with proper frontmatter (title, description)
 * - Integrates with Mintlify navigation via docs.json updates
 * - Supports organizing content with tabs and groups
 * - Can convert README.md to index.mdx for package overview
 * - Maintains proper cross-references between API items
 * 
 * @public
 */
export class MarkdownAction extends BaseAction {
  /** Command-line parameter for specifying the docs.json file path for navigation updates */
  private readonly _docsJsonParameter: CommandLineStringParameter;
  
  /** Command-line parameter for specifying the tab name in Mintlify navigation */
  private readonly _tabNameParameter: CommandLineStringParameter;
  
  /** Command-line parameter for specifying the group name within the tab */
  private readonly _groupParameter: CommandLineStringParameter;
  
  /** Command-line flag to enable menu for the group in navigation */
  private readonly _menuParameter: CommandLineFlagParameter;
  
  /** Command-line flag to convert README.md to index.mdx */
  private readonly _readmeParameter: CommandLineFlagParameter;
  
  /** Command-line parameter for custom README title (when --readme is used) */
  private readonly _readmeTitleParameter: CommandLineStringParameter;

  /**
   * Initializes the markdown action with all required command-line parameters.
   * 
   * @param parser - The parent CLI parser instance
   */
  public constructor(parser: DocumenterCli) {
    super({
      actionName: 'markdown',
      summary: 'Generate documentation as Mintlify-compatible MDX files (*.mdx)',
      documentation:
        'Generates API documentation as a collection of files in' +
        ' MDX format with Mintlify frontmatter, suitable for Mintlify documentation sites.'
    });
    
    this._docsJsonParameter = this.defineStringParameter({
      parameterLongName: '--docs-json',
      argumentName: 'PATH',
      description: 'Path to docs.json file to update with navigation'
    });
    
    this._tabNameParameter = this.defineStringParameter({
      parameterLongName: '--tab-name',
      argumentName: 'NAME',
      description: 'Tab name in Mintlify navigation (default: "API Reference")'
    });
    
    this._groupParameter = this.defineStringParameter({
      parameterLongName: '--group',
      argumentName: 'NAME',
      description: 'Group name within the tab for organizing pages'
    });
    
    this._menuParameter = this.defineFlagParameter({
      parameterLongName: '--menu',
      description: 'Enable menu for the group in navigation'
    });
    
    this._readmeParameter = this.defineFlagParameter({
      parameterLongName: '--readme',
      description: 'Convert project README.md to index.mdx (title will be "README")'
    });
    
    this._readmeTitleParameter = this.defineStringParameter({
      parameterLongName: '--readme-title',
      argumentName: 'TITLE',
      description: 'Custom title for the README page (only used with --readme)'
    });
  }

  /**
   * Executes the markdown documentation generation process.
   * 
   * This method:
   * 1. Builds the API model from .api.json files
   * 2. Creates a MarkdownDocumenter instance with user-specified options
   * 3. Generates all MDX files with proper frontmatter and navigation
   * 
   * @protected
   * @override
   */
  protected override async onExecuteAsync(): Promise<void> {
    const { apiModel, outputFolder } = this.buildApiModel();

    const markdownDocumenter: MarkdownDocumenter = new MarkdownDocumenter({
      apiModel,
      outputFolder,
      docsJsonPath: this._docsJsonParameter.value,
      tabName: this._tabNameParameter.value,
      groupName: this._groupParameter.value,
      enableMenu: this._menuParameter.value,
      convertReadme: this._readmeParameter.value,
      readmeTitle: this._readmeTitleParameter.value || 'README'
    });
    markdownDocumenter.generateFiles();
  }
}
