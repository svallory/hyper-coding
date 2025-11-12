// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { CommandLineParser } from '@rushstack/ts-command-line';
import { MarkdownAction } from './MarkdownAction';
import { InitTemplatesAction } from './InitTemplatesAction';

/**
 * Main CLI parser for the mintlify-tsdocs tool.
 * 
 * This class sets up the command-line interface for generating Mintlify-compatible
 * MDX documentation from TypeScript API documentation. The tool currently supports
 * only one action: `markdown`, which generates MDX files with proper frontmatter
 * and navigation integration for Mintlify documentation sites.
 * 
 * @public
 */
export class DocumenterCli extends CommandLineParser {
  /**
   * Initializes the CLI parser with tool metadata and available actions.
   */
  public constructor() {
    super({
      toolFilename: 'mintlify-tsdocs',
      toolDescription:
        'Reads *.api.json files produced by api-extractor and generates ' +
        'Mintlify-compatible MDX documentation with proper frontmatter and navigation.'
    });
    this._populateActions();
  }

  /**
   * Registers all available CLI actions.
   * Supports the `markdown` action for MDX generation and `init-templates` for template initialization.
   *
   * @private
   */
  private _populateActions(): void {
    this.addAction(new MarkdownAction(this));
    this.addAction(new InitTemplatesAction());
  }
}
