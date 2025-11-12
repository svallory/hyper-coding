// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import * as path from 'path';
import * as fs from 'fs';
import { FileSystem } from '@rushstack/node-core-library';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

/**
 * Utility for merging user templates with default templates
 */
export class TemplateMerger {
  /**
   * Create a merged template directory by combining user templates with defaults
   * User templates override default templates when they have the same name
   */
  public static async createMergedTemplateDir(
    userTemplateDir?: string,
    defaultTemplateDir?: string
  ): Promise<string> {
    // Create temporary directory
    const tempDir = path.join(tmpdir(), `mintlify-tsdocs-templates-${randomBytes(8).toString('hex')}`);
    await fs.promises.mkdir(tempDir, { recursive: true });

    try {
      // Copy all default templates first
      if (defaultTemplateDir && FileSystem.exists(defaultTemplateDir)) {
        await this._copyDirectory(defaultTemplateDir, tempDir);
      }

      // Copy user templates, overriding defaults
      if (userTemplateDir && FileSystem.exists(userTemplateDir)) {
        await this._copyDirectory(userTemplateDir, tempDir, true);
      }

      return tempDir;
    } catch (error) {
      // Clean up temp directory on error
      try {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
  }

  /**
   * Clean up a temporary template directory
   */
  public static async cleanupTempDir(tempDir: string): Promise<void> {
    try {
      if (FileSystem.exists(tempDir)) {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      }
    } catch (error) {
      console.warn(`Warning: Failed to cleanup temp directory ${tempDir}:`, error);
    }
  }

  /**
   * Copy directory contents recursively
   */
  private static async _copyDirectory(
    srcDir: string,
    destDir: string,
    overwrite: boolean = false
  ): Promise<void> {
    const entries = await fs.promises.readdir(srcDir, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(srcDir, entry.name);
      const destPath = path.join(destDir, entry.name);

      if (entry.isDirectory()) {
        // Create subdirectory if it doesn't exist
        await fs.promises.mkdir(destPath, { recursive: true });
        // Recursively copy directory contents
        await this._copyDirectory(srcPath, destPath, overwrite);
      } else if (entry.isFile()) {
        // Only copy if file doesn't exist or overwrite is true
        if (overwrite || !FileSystem.exists(destPath)) {
          await fs.promises.copyFile(srcPath, destPath);
        }
      }
    }
  }

  /**
   * Get the list of available template names from a directory
   */
  public static getTemplateNames(templateDir: string): string[] {
    if (!FileSystem.exists(templateDir)) {
      return [];
    }

    try {
      const files = FileSystem.readFolderItemNames(templateDir);
      return files
        .filter((file: string) => file.endsWith('.liquid'))
        .map((file: string) => path.basename(file, '.liquid'));
    } catch {
      return [];
    }
  }

  /**
   * Check if a template exists in the merged directory
   */
  public static hasTemplate(templateDir: string, templateName: string): boolean {
    const templatePath = path.join(templateDir, `${templateName}.liquid`);
    return FileSystem.exists(templatePath);
  }
}