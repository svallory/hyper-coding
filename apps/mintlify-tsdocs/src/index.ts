// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

/**
 * Mintlify-TSdocs generates Mintlify-compatible MDX documentation from .api.json files created by API Extractor.
 * The `mintlify-tsdocs` package provides the command-line tool for generating documentation with proper frontmatter
 * and navigation integration for Mintlify documentation sites.
 *
 * @packageDocumentation
 */

// Main exports for the tool
export { MarkdownDocumenter } from './documenters/MarkdownDocumenter';
export type { IMarkdownDocumenterOptions } from './documenters/MarkdownDocumenter';
export { CustomMarkdownEmitter } from './markdown/CustomMarkdownEmitter';
export type { ICustomMarkdownEmitterOptions } from './markdown/CustomMarkdownEmitter';
export type { IMarkdownEmitterContext, IMarkdownEmitterOptions } from './markdown/MarkdownEmitter';
