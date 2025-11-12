/**
 * Navigation management for Mintlify documentation sites.
 * Handles docs.json structure, navigation generation, and hierarchical organization.
 */

import { FileSystem } from '@rushstack/node-core-library';
import { ApiItemKind } from '@microsoft/api-extractor-model';
import * as path from 'path';
import { SecurityUtils } from '../utils/SecurityUtils';
import { DocumentationError, ErrorCode, ValidationError } from '../errors/DocumentationError';

/**
 * Navigation item interface for Mintlify docs.json structure
 */
export interface NavigationItem {
  group?: string;
  pages?: Array<string | NavigationItem>;
  icon?: string;
  page?: string;
  apiKind?: ApiItemKind;
}

/**
 * Configuration options for navigation manager
 */
export interface NavigationManagerOptions {
  /**
   * Path to the docs.json file
   */
  docsJsonPath?: string;

  /**
   * Tab name in Mintlify navigation (default: "API Reference")
   */
  tabName?: string;

  /**
   * Group name within the tab
   */
  groupName?: string;

  /**
   * Enable menu for the group in navigation
   */
  enableMenu?: boolean;

  /**
   * Output folder path for path calculations
   */
  outputFolder?: string;
}

/**
 * Manages Mintlify navigation structure including docs.json updates and hierarchical organization
 */
export class NavigationManager {
  private readonly _docsJsonPath: string;
  private readonly _tabName: string;
  private readonly _groupName: string;
  private readonly _enableMenu: boolean;
  private readonly _outputFolder: string;
  private readonly _navigationItems: NavigationItem[] = [];

  /**
   * Category display names and icon mapping for different API item types
   */
  private static readonly CATEGORY_INFO: Record<string, { displayName: string; icon: string }> = {
    [ApiItemKind.Class]: { displayName: 'Classes', icon: 'box' },
    [ApiItemKind.Interface]: { displayName: 'Interfaces', icon: 'plug' },
    [ApiItemKind.Function]: { displayName: 'Functions', icon: 'function' },
    [ApiItemKind.TypeAlias]: { displayName: 'Types', icon: 'file-code' },
    [ApiItemKind.Variable]: { displayName: 'Variables', icon: 'variable' },
    [ApiItemKind.Enum]: { displayName: 'Enums', icon: 'list' },
    [ApiItemKind.Namespace]: { displayName: 'Namespaces', icon: 'folder' }
  };

  constructor(options: NavigationManagerOptions = {}) {
    this._docsJsonPath = options.docsJsonPath || '';
    this._tabName = options.tabName || 'API Reference';
    this._groupName = options.groupName || '';
    this._enableMenu = options.enableMenu || false;
    this._outputFolder = options.outputFolder || '';
  }

  /**
   * Add a navigation item to the manager
   */
  public addNavigationItem(item: NavigationItem): void {
    // Prevent duplicate entries
    const exists = this._navigationItems.some(existing =>
      existing.page === item.page && existing.group === item.group
    );

    if (!exists) {
      this._navigationItems.push(item);
    }
  }

  /**
   * Add an API item to navigation with automatic categorization
   */
  public addApiItem(apiItem: any, filename: string): void {
    if (!this._isTopLevelItem(apiItem)) {
      return;
    }

    try {
      // Calculate relative path from docs.json to the output file
      const docsJsonDir = path.dirname(this._docsJsonPath);
      const fullOutputPath = path.resolve(this._outputFolder, filename);
      const relativePath = path.relative(docsJsonDir, fullOutputPath);
      const normalizedPath = relativePath.replace(/\\/g, '/'); // Normalize path separators

      const navigationItem: NavigationItem = {
        page: normalizedPath,
        apiKind: apiItem.kind
      };

      this.addNavigationItem(navigationItem);
    } catch (error) {
      throw new DocumentationError(
        `Failed to add API item to navigation: ${apiItem.displayName}`,
        ErrorCode.NAVIGATION_ERROR,
        {
          resource: apiItem.displayName,
          operation: 'addApiItem',
          cause: error instanceof Error ? error : new Error(String(error))
        }
      );
    }
  }

  /**
   * Generate and write navigation to docs.json file
   */
  public async generateNavigation(): Promise<void> {
    if (!this._docsJsonPath || this._navigationItems.length === 0) {
      return;
    }

    console.log(`📋 Generating navigation in ${this._docsJsonPath}...`);

    try {
      // Resolve to absolute path (allow parent directories in monorepo context)
      const validatedDocsJsonPath = path.resolve(process.cwd(), this._docsJsonPath);

      // Read existing docs.json if it exists
      let docsJson: any = {};
      try {
        if (FileSystem.exists(validatedDocsJsonPath)) {
          const existingContent = FileSystem.readFile(validatedDocsJsonPath);
          SecurityUtils.validateJsonContent(existingContent);
          docsJson = JSON.parse(existingContent);
        }
      } catch (error) {
        // File doesn't exist or is invalid, start with empty object
        console.log('   Creating new docs.json file...');
      }

      // Generate navigation structure
      this._updateDocsJsonNavigation(docsJson);

      // Validate and write the updated docs.json
      const jsonString = JSON.stringify(docsJson, null, 2);
      const maxJsonSize = 10 * 1024 * 1024; // 10MB limit

      if (jsonString.length > maxJsonSize) {
        throw new ValidationError(
          `Generated docs.json exceeds maximum size of 10MB`,
          { resource: this._docsJsonPath, operation: 'validateDocsJsonSize', data: { size: jsonString.length } }
        );
      }

      SecurityUtils.validateJsonContent(jsonString);

      // Ensure output directory exists
      const docsJsonDir = path.dirname(validatedDocsJsonPath);
      FileSystem.ensureFolder(docsJsonDir);

      // Write updated docs.json
      FileSystem.writeFile(validatedDocsJsonPath, jsonString);

      console.log(`   ✓ Generated navigation for ${this._navigationItems.length} pages`);
    } catch (error) {
      if (error instanceof DocumentationError) {
        throw error;
      }
      throw new DocumentationError(
        `Failed to generate navigation: ${error instanceof Error ? error.message : String(error)}`,
        ErrorCode.NAVIGATION_ERROR,
        {
          resource: this._docsJsonPath,
          operation: 'generateNavigation',
          cause: error instanceof Error ? error : new Error(String(error)),
          suggestion: 'Check file permissions and ensure the docs.json path is correct'
        }
      );
    }
  }

  /**
   * Generate hierarchical navigation structure with categories
   */
  public generateHierarchicalNavigation(): any[] {
    if (this._groupName) {
      // Generate the hierarchical structure using default logic
      const hierarchicalGroups = this._generateDefaultHierarchicalNavigation();

      return [{
        group: this._groupName,
        icon: this._enableMenu ? 'code' : undefined,
        pages: hierarchicalGroups
      }];
    } else {
      // Return flat navigation if no group name specified
      return this._navigationItems.map(item => item.page);
    }
  }

  /**
   * Get navigation statistics
   */
  public getStats(): { totalItems: number; hasHierarchical: boolean; tabName: string; groupName: string; docsJsonPath: string } {
    return {
      totalItems: this._navigationItems.length,
      hasHierarchical: this._groupName !== '',
      tabName: this._tabName,
      groupName: this._groupName,
      docsJsonPath: this._docsJsonPath
    };
  }

  /**
   * Clear all navigation items
   */
  public clear(): void {
    this._navigationItems.length = 0;
  }

  /**
   * Update docs.json navigation structure
   */
  private _updateDocsJsonNavigation(docsJson: any): void {
    // Handle different docs.json structures
    if (docsJson.navigation && docsJson.navigation.tabs) {
      // Mintlify v4 structure with tabs
      this._updateTabStructure(docsJson);
    } else {
      // Simple navigation array structure
      this._updateSimpleStructure(docsJson);
    }
  }

  /**
   * Update Mintlify v4 tab structure
   */
  private _updateTabStructure(docsJson: any): void {
    if (!Array.isArray(docsJson.navigation.tabs)) {
      docsJson.navigation.tabs = [];
    }

    // Find existing tab or create new one
    let existingTab = docsJson.navigation.tabs.find((tab: any) =>
      tab.tab === this._tabName
    );

    if (!existingTab) {
      existingTab = {
        tab: this._tabName,
        groups: []
      };
      docsJson.navigation.tabs.push(existingTab);
    }

    // Merge hierarchical navigation with existing groups
    const newGroups = this.generateHierarchicalNavigation();

    // Update or add groups
    for (const newGroup of newGroups) {
      const groupIndex = existingTab.groups.findIndex((group: any) =>
        group.group === newGroup.group
      );

      if (groupIndex >= 0) {
        existingTab.groups[groupIndex] = newGroup;
        console.log(`   ✓ Updated existing "${newGroup.group}" group`);
      } else {
        existingTab.groups.push(newGroup);
        console.log(`   ✓ Added new "${newGroup.group}" group`);
      }
    }
  }

  /**
   * Update simple navigation array structure
   */
  private _updateSimpleStructure(docsJson: any): void {
    if (!docsJson.navigation) {
      docsJson.navigation = [];
    }

    if (!Array.isArray(docsJson.navigation)) {
      docsJson.navigation = [];
    }

    // Find or create our group
    let groupIndex = -1;
    if (this._groupName) {
      groupIndex = docsJson.navigation.findIndex((item: any) =>
        item.group === this._groupName
      );
    }

    const groupEntry = {
      group: this._groupName || 'API Reference',
      icon: this._enableMenu ? 'code' : undefined,
      pages: this.generateHierarchicalNavigation()
    };

    if (groupIndex >= 0) {
      docsJson.navigation[groupIndex] = groupEntry;
      console.log(`   ✓ Updated existing "${this._groupName}" group`);
    } else {
      docsJson.navigation.push(groupEntry);
      console.log(`   ✓ Added new "${this._groupName}" group`);
    }
  }

  /**
   * Generate default hierarchical navigation grouped by API item types
   */
  private _generateDefaultHierarchicalNavigation(): any[] {
    const groups = new Map<string, string[]>();

    // Categorize navigation items by API kind
    for (const item of this._navigationItems) {
      if (item.apiKind) {
        const categoryInfo = NavigationManager.CATEGORY_INFO[item.apiKind] ||
          { displayName: 'Miscellaneous', icon: 'file-text' };

        if (!groups.has(categoryInfo.displayName)) {
          groups.set(categoryInfo.displayName, []);
        }

        if (item.page) {
          groups.get(categoryInfo.displayName)!.push(item.page);
        }
      }
    }

    // Convert to array format
    const result: any[] = [];
    for (const [groupName, pages] of groups) {
      const categoryInfo = Object.values(NavigationManager.CATEGORY_INFO).find(
        cat => cat.displayName === groupName
      ) || { displayName: groupName, icon: 'file-text' };

      result.push({
        group: groupName,
        icon: categoryInfo.icon,
        pages: pages.sort() // Sort pages alphabetically
      });
    }

    // Sort groups by display name
    return result.sort((a, b) => a.group.localeCompare(b.group));
  }

  /**
   * Determine if an API item should be included in top-level navigation
   */
  private _isTopLevelItem(apiItem: any): boolean {
    return [
      ApiItemKind.Class,
      ApiItemKind.Interface,
      ApiItemKind.Enum,
      ApiItemKind.Namespace,
      ApiItemKind.Function,
      ApiItemKind.TypeAlias,
      ApiItemKind.Variable
    ].includes(apiItem.kind);
  }
}