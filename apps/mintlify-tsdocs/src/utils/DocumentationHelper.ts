import { ObjectTypeAnalyzer } from './ObjectTypeAnalyzer';
import { JsDocExtractor } from './JsDocExtractor';

/**
 * Interface for property information
 */
export interface PropertyInfo {
  name: string;
  type: string;
  description: string;
  required: boolean;
  deprecated: boolean;
  nestedProperties?: PropertyInfo[];
}

/**
 * Helper class for generating consistent documentation with Mintlify components
 */
export class DocumentationHelper {
  private _typeAnalyzer: ObjectTypeAnalyzer;
  private _jsDocExtractor: JsDocExtractor;

  constructor() {
    this._typeAnalyzer = new ObjectTypeAnalyzer();
    this._jsDocExtractor = new JsDocExtractor();
  }

  /**
   * Analyzes a type string and extracts property information with nested object support
   */
  analyzeTypeProperties(type: string, description: string = '', propertyPath: string = ''): PropertyInfo {
    if (!type) {
      return {
        name: '',
        type: 'any',
        description,
        required: true,
        deprecated: false
      };
    }

    const typeAnalysis = this._typeAnalyzer.analyzeType(type);

    // Debug: Log the type analysis for actionConfig
    if (type.includes('communication')) {
      console.log(`    DEBUG DocumentationHelper.analyzeTypeProperties:`);
      console.log(`      Input type: "${type}"`);
      console.log(`      Type analysis result:`, JSON.stringify(typeAnalysis, null, 2));
      console.log(`      Properties count: ${typeAnalysis.properties?.length || 0}`);
      if (typeAnalysis.properties) {
        typeAnalysis.properties.forEach((prop: any, i: number) => {
          console.log(`      Property ${i}: ${prop.name} = ${JSON.stringify(prop.type)}`);
        });
      }
    }

    // If it's an object literal with properties, show "object" and extract nested properties
    if (typeAnalysis.type === 'object-literal' && typeAnalysis.properties && typeAnalysis.properties.length > 0) {
      return {
        name: '',
        type: 'object',
        description,
        required: true,
        deprecated: false,
        nestedProperties: typeAnalysis.properties?.map((prop: any) => {
          // Build the full property path for JSDoc lookup
          const currentPath = propertyPath ? `${propertyPath}.${prop.name}` : prop.name;
          const propDescription = this._jsDocExtractor.getDescription(currentPath);

          // If the property type is itself an object literal with properties, preserve that structure
          if (prop.type.type === 'object-literal' && prop.type.properties && prop.type.properties.length > 0) {
            console.log(`        DEBUG: Property ${prop.name} is object literal with ${prop.type.properties.length} properties`);
            console.log(`        DEBUG: Property path "${currentPath}" has description: "${propDescription}"`);

            return {
              name: prop.name,
              type: 'object',
              description: propDescription,
              required: !prop.optional,
              deprecated: false,
              nestedProperties: prop.type.properties.map((nestedProp: any) => {
                const nestedPath = `${currentPath}.${nestedProp.name}`;
                const nestedDescription = this._jsDocExtractor.getDescription(nestedPath);
                console.log(`        DEBUG: Nested property ${nestedProp.name} path "${nestedPath}" has description: "${nestedDescription}"`);

                return {
                  name: nestedProp.name,
                  type: this._getPropertyTypeString(nestedProp.type),
                  description: nestedDescription,
                  required: !nestedProp.optional,
                  deprecated: false
                };
              })
            };
          } else {
            // For non-object-literal types, use the original recursive approach
            const nestedInfo = this.analyzeTypeProperties(this._getPropertyTypeString(prop.type), '', currentPath);
            console.log(`        DEBUG: Processing property ${prop.name} with type "${this._getPropertyTypeString(prop.type)}"`);
            console.log(`        DEBUG: Property path "${currentPath}" has description: "${propDescription}"`);
            console.log(`        DEBUG: Nested info has ${nestedInfo.nestedProperties?.length || 0} nested properties`);

            return {
              name: prop.name,
              type: nestedInfo.type,
              description: propDescription,
              required: !prop.optional,
              deprecated: false,
              nestedProperties: nestedInfo.nestedProperties // Recursively include nested properties
            };
          }
        })
      };
    }

    return {
      name: '',
      type: this._getPropertyTypeString(typeAnalysis),
      description,
      required: true,
      deprecated: false
    };
  }

  /**
   * Converts a type analysis result to a string for display
   */
  private _getPropertyTypeString(typeAnalysis: any): string {
    if (typeAnalysis.type === 'primitive') {
      return typeAnalysis.name;
    }
    if (typeAnalysis.type === 'array') {
      return this._getPropertyTypeString(typeAnalysis.elementType) + '[]';
    }
    if (typeAnalysis.type === 'union') {
      return typeAnalysis.unionTypes.map((t: any) => this._getPropertyTypeString(t)).join(' | ');
    }
    if (typeAnalysis.type === 'intersection') {
      return typeAnalysis.intersectionTypes.map((t: any) => this._getPropertyTypeString(t)).join(' & ');
    }
    if (typeAnalysis.type === 'generic') {
      return `${typeAnalysis.baseType}<${typeAnalysis.typeParameters.join(', ')}>`;
    }
    if (typeAnalysis.type === 'object-literal') {
      return 'object';
    }
    return typeAnalysis.name || 'any';
  }

  /**
   * Checks if a type string represents an object literal with properties
   */
  isObjectLiteral(type: string): boolean {
    if (!type) return false;

    const typeAnalysis = this._typeAnalyzer.analyzeType(type);
    return typeAnalysis.type === 'object-literal' && !!typeAnalysis.properties && typeAnalysis.properties.length > 0;
  }

  /**
   * Extracts nested properties from an object literal type string
   */
  extractNestedProperties(type: string): PropertyInfo[] {
    if (!type) return [];

    const typeAnalysis = this._typeAnalyzer.analyzeType(type);
    if (typeAnalysis.type !== 'object-literal') return [];

    return typeAnalysis.properties?.map((prop: any) => ({
      name: prop.name,
      type: this._getPropertyTypeString(prop.type),
      description: '', // Could be enhanced to extract descriptions
      required: !prop.optional,
      deprecated: false
    })) || [];
  }
}