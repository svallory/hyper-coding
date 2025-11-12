// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import * as path from 'path';
import { FileSystem } from '@rushstack/node-core-library';
import {
  type CommandLineStringParameter,
  type ICommandLineActionOptions,
  CommandLineFlagParameter
} from '@rushstack/ts-command-line';
import { Colorize } from '@rushstack/terminal';

import { BaseAction } from './BaseAction';
import { TemplateMerger } from '../templates/TemplateMerger';
import { DocumentationError, ErrorCode } from '../errors/DocumentationError';

/**
 * CLI action to initialize a template directory with default templates
 */
export class InitTemplatesAction extends BaseAction {
  private readonly _templateDirParameter: CommandLineStringParameter;
  private readonly _forceParameter: CommandLineFlagParameter;

  public constructor() {
    super({
      actionName: 'init-templates',
      summary: 'Initialize a template directory with default Liquid templates',
      documentation:
        'Creates a template directory populated with default Liquid templates ' +
        'that can be customized to override the default documentation generation behavior.'
    });

    this._templateDirParameter = this.defineStringParameter({
      parameterLongName: '--template-dir',
      parameterShortName: '-t',
      argumentName: 'DIRECTORY',
      description:
        'Specifies the directory where templates should be created. ' +
        'If omitted, defaults to "./templates"',
      defaultValue: './templates'
    });

    this._forceParameter = this.defineFlagParameter({
      parameterLongName: '--force',
      parameterShortName: '-f',
      description:
        'Overwrite existing templates in the target directory'
    });
  }

  protected override async onExecuteAsync(): Promise<void> {
    const templateDir = this._templateDirParameter.value || './templates';
    const force = this._forceParameter.value || false;

    console.log();
    console.log(Colorize.bold('Initializing template directory: ') + Colorize.cyan(templateDir));
    console.log();

    try {
      // Check if directory exists and has files
      if (FileSystem.exists(templateDir)) {
        const files = FileSystem.readFolderItemNames(templateDir);
        const liquidFiles = files.filter(f => f.endsWith('.liquid'));

        if (liquidFiles.length > 0 && !force) {
          throw new DocumentationError(
            `Template directory "${templateDir}" already contains ${liquidFiles.length} template files. ` +
            'Use --force to overwrite existing templates.',
            ErrorCode.TEMPLATE_ERROR
          );
        }

        if (force) {
          console.log(Colorize.yellow(`Overwriting existing templates in ${templateDir}...`));
        }
      } else {
        // Create directory
        console.log(`Creating directory: ${templateDir}`);
        FileSystem.ensureFolder(templateDir);
      }

      // Get the default template directory
      const defaultTemplateDir = path.join(__dirname, '..', 'templates', 'defaults');

      if (!FileSystem.exists(defaultTemplateDir)) {
        throw new DocumentationError(
          `Default templates not found at ${defaultTemplateDir}`,
          ErrorCode.TEMPLATE_NOT_FOUND
        );
      }

      // Copy all default templates to user directory
      console.log('Copying default templates...');
      this._copyTemplates(defaultTemplateDir, templateDir);

      console.log();
      console.log(Colorize.green('✓ Template initialization completed successfully!'));
      console.log();
      console.log('You can now customize the templates in:');
      console.log(Colorize.cyan(`  ${path.resolve(templateDir)}`));
      console.log();
      console.log('To use your custom templates:');
      console.log('1. Modify the template files as needed');
      console.log('2. Run the documenter with: --template-dir ' + templateDir);
      console.log();
      console.log('For more information, see: https://docs.mintlify-tsdocs.com/templates');

    } catch (error) {
      if (error instanceof DocumentationError) {
        throw error;
      }
      throw new DocumentationError(
        `Failed to initialize templates: ${error instanceof Error ? error.message : String(error)}`,
        ErrorCode.TEMPLATE_ERROR,
        { cause: error instanceof Error ? error : new Error(String(error)) }
      );
    }
  }

  /**
   * Copy templates from source to destination directory
   */
  private _copyTemplates(sourceDir: string, destDir: string): void {
    const entries = FileSystem.readFolderItemNames(sourceDir);

    for (const entry of entries) {
      const sourcePath = path.join(sourceDir, entry);
      const destPath = path.join(destDir, entry);

      // Only copy .liquid files (skip other files like .ts, .js, etc.)
      if (entry.endsWith('.liquid')) {
        console.log(`  Copying: ${entry}`);

        const content = FileSystem.readFileToBuffer(sourcePath).toString();

        // Add a comment at the top of each template explaining it
        const headerComment = `<!--
  Mintlify TypeDoc Template

  This template controls how ${entry.replace('.liquid', '')} documentation is generated.

  Available variables:
  - apiItem: The API item being documented
  - page: Page metadata (title, description, icon, breadcrumb)
  - tables: Structured data for constructors, properties, methods, etc.
  - examples: Array of example code strings
  - heritageTypes: Inheritance information

  Learn more: https://docs.mintlify-tsdocs.com/templates
-->

`;

        const finalContent = headerComment + content;
        FileSystem.writeFile(destPath, finalContent);
      }
    }
  }
}