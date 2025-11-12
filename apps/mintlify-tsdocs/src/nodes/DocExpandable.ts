// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { DocNode, DocSection, TSDocConfiguration } from '@microsoft/tsdoc';
import { CustomDocNodeKind } from './CustomDocNodeKind';

/**
 * Represents an Expandable component for Mintlify documentation.
 * Renders as: <Expandable title="...">...</Expandable>
 */
export class DocExpandable extends DocNode {
  public readonly title: string;
  public readonly content: DocSection;

  public constructor(
    parameters: {
      configuration: TSDocConfiguration;
      content?: DocSection;
    },
    title: string = 'Details'
  ) {
    super(parameters);
    this.title = title;
    this.content = parameters.content || new DocSection({ configuration: this.configuration });
  }

  /** @override */
  public get kind(): string {
    return CustomDocNodeKind.Expandable;
  }

  /** @override */
  public getChildNodes(): ReadonlyArray<DocNode> {
    return [this.content];
  }
}