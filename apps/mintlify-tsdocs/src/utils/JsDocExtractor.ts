/**
 * Utility to extract JSDoc comments from TypeScript source code
 */
export class JsDocExtractor {
  private _propertyDescriptions: Map<string, string> = new Map();

  constructor() {
    this._loadActionStepDescriptions();
  }

  /**
   * Loads JSDoc descriptions for ActionStep nested properties
   */
  private _loadActionStepDescriptions(): void {
    // Hardcoded descriptions from the source file for now
    // In a real implementation, this would parse the actual TypeScript file
    this._propertyDescriptions.set('actionConfig', 'Action-specific configuration');
    this._propertyDescriptions.set('actionConfig.communication', 'Communication settings for multi-action workflows');
    this._propertyDescriptions.set('actionConfig.communication.actionId', 'ID for this action instance');
    this._propertyDescriptions.set('actionConfig.communication.subscribeTo', 'Message types this action listens for');
    this._propertyDescriptions.set('actionConfig.communication.reads', 'Shared data keys this action reads');
    this._propertyDescriptions.set('actionConfig.communication.writes', 'Shared data keys this action writes');
  }

  /**
   * Gets the JSDoc description for a property path
   */
  getDescription(propertyPath: string): string {
    return this._propertyDescriptions.get(propertyPath) || '';
  }

  /**
   * Gets description for nested properties in a hierarchical structure
   */
  enrichWithDescriptions(properties: any[], parentPath: string = ''): any[] {
    return properties.map(prop => {
      const fullPath = parentPath ? `${parentPath}.${prop.name}` : prop.name;
      const enrichedProp = {
        ...prop,
        description: this.getDescription(fullPath)
      };

      // Recursively enrich nested properties
      if (prop.nestedProperties && prop.nestedProperties.length > 0) {
        enrichedProp.nestedProperties = this.enrichWithDescriptions(prop.nestedProperties, fullPath);
      }

      return enrichedProp;
    });
  }
}