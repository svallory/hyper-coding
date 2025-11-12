// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { ApiParameterListMixin, type ApiItem } from '@microsoft/api-extractor-model';
import { SecurityUtils } from './SecurityUtils';
import { DocumentationError, ErrorCode } from '../errors/DocumentationError';

export class Utilities {
  private static readonly _badFilenameCharsRegExp: RegExp = /[^a-z0-9_\-\.]/gi;
  /**
   * Generates a concise signature for a function.  Example: "getArea(width, height)"
   */
  public static getConciseSignature(apiItem: ApiItem): string {
    if (ApiParameterListMixin.isBaseClassOf(apiItem)) {
      return apiItem.displayName + '(' + apiItem.parameters.map((x) => x.name).join(', ') + ')';
    }
    return apiItem.displayName;
  }

  /**
   * Converts bad filename characters to underscores.
   * Validates filename to prevent security vulnerabilities.
   */
  public static getSafeFilenameForName(name: string): string {
    // Use the SecurityUtils for comprehensive filename validation
    try {
      // First validate the name as a safe filename
      const validatedName = SecurityUtils.validateFilename(name);

      // Then apply the original sanitization logic for consistency
      return validatedName.replace(Utilities._badFilenameCharsRegExp, '_').toLowerCase();
    } catch (error) {
      // If validation fails, provide a secure fallback
      console.warn(`Warning: Invalid filename "${name}" detected, using sanitized fallback`);

      // Remove path traversal patterns and dangerous characters
      const sanitized = name
        .replace(/\.{2,}/g, '') // Remove multiple dots
        .replace(/[~\/\\]/g, '') // Remove path characters
        .replace(Utilities._badFilenameCharsRegExp, '_')
        .toLowerCase()
        .substring(0, 50); // Limit length

      if (!sanitized || sanitized.length === 0) {
        throw new DocumentationError(
          `Cannot create safe filename from: "${name}"`,
          ErrorCode.INVALID_FILENAME,
          { resource: name, operation: 'getSafeFilenameForName' }
        );
      }

      return sanitized;
    }
  }
}
