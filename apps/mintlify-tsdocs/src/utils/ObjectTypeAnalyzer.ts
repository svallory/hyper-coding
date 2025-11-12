/**
 * Represents a type analysis result
 */
export interface TypeAnalysis {
  type: 'primitive' | 'array' | 'union' | 'intersection' | 'generic' | 'object-literal' | 'unknown';
  name?: string;
  elementType?: TypeAnalysis;
  unionTypes?: TypeAnalysis[];
  intersectionTypes?: TypeAnalysis[];
  baseType?: string;
  typeParameters?: string[];
  properties?: PropertyAnalysis[];
}

/**
 * Represents a property analysis result
 */
export interface PropertyAnalysis {
  name: string;
  type: TypeAnalysis;
  optional: boolean;
}

/**
 * Analyzes TypeScript type strings to extract nested object properties
 */
import { TypeAnalysisCache } from '../cache/TypeAnalysisCache';

/**
 * Analyzes TypeScript type strings to extract nested object properties
 */
export class ObjectTypeAnalyzer {
  private readonly _cache: TypeAnalysisCache;

  constructor(cache?: TypeAnalysisCache) {
    this._cache = cache ?? new TypeAnalysisCache({ enabled: true, maxSize: 500 });
  }
  /**
   * Analyzes a type string and returns structured information
   */
  analyzeType(type: string): TypeAnalysis {
    // Check cache first
    const cached = this._cache.get(type);
    if (cached) {
      return cached;
    }

    const result = this._analyzeTypeInternal(type);

    // Cache the result
    this._cache.set(type, result);
    return result;
  }

  /**
   * Internal type analysis method (without caching)
   */
  private _analyzeTypeInternal(type: string): TypeAnalysis {
    if (!type || type.trim() === '') {
      return { type: 'unknown' };
    }

    type = type.trim();

    // Handle object literals with properties
    if (type.startsWith('{') && type.endsWith('}')) {
      return this._parseObjectLiteral(type);
    }

    // Handle array types
    if (type.endsWith('[]')) {
      const elementType = type.slice(0, -2);
      return {
        type: 'array',
        elementType: this.analyzeType(elementType) // Recursive call will use cache
      };
    }

    // Handle union types
    if (type.includes('|') && !type.startsWith('{')) {
      const unionTypes = type.split('|').map(t => this.analyzeType(t.trim())); // Recursive calls will use cache
      return {
        type: 'union',
        unionTypes
      };
    }

    // Handle intersection types
    if (type.includes('&') && !type.startsWith('{')) {
      const intersectionTypes = type.split('&').map(t => this.analyzeType(t.trim())); // Recursive calls will use cache
      return {
        type: 'intersection',
        intersectionTypes
      };
    }

    // Handle generic types
    const genericMatch = type.match(/^(\w+)<(.+)>$/);
    if (genericMatch) {
      const baseType = genericMatch[1];
      const typeParams = genericMatch[2];

      // Split type parameters, handling nested generics
      const typeParameters = this._splitTypeParameters(typeParams);

      return {
        type: 'generic',
        baseType,
        typeParameters
      };
    }

    // Handle primitive types and simple object references
    const primitiveTypes = ['string', 'number', 'boolean', 'void', 'any', 'never', 'unknown', 'null', 'undefined'];
    if (primitiveTypes.includes(type)) {
      return {
        type: 'primitive',
        name: type
      };
    }

    // Default to unknown type with the original name
    return {
      type: 'unknown',
      name: type
    };
  }

  /**
   * Parses object literal type strings to extract properties
   */
  private _parseObjectLiteral(objectLiteral: string): TypeAnalysis {
    const properties: PropertyAnalysis[] = [];

    // Remove outer braces
    const content = objectLiteral.slice(1, -1).trim();

    // Parse properties using a simple approach
    // This is a basic implementation that handles common cases
    const propertyMatches = this._parseProperties(content);

    for (const match of propertyMatches) {
      const { name, type, optional } = match;
      properties.push({
        name,
        type: this.analyzeType(type),
        optional
      });
    }

    return {
      type: 'object-literal',
      properties
    };
  }

  /**
   * Parses properties from object literal content
   */
  private _parseProperties(content: string): Array<{ name: string; type: string; optional: boolean }> {
    const properties: Array<{ name: string; type: string; optional: boolean }> = [];

    // Split by semicolons, but handle nested objects
    const propertyStrings = this._splitBySemicolons(content);

    for (const propString of propertyStrings) {
      const trimmed = propString.trim();
      if (!trimmed) continue;

      // Match property pattern: name?: type
      const match = trimmed.match(/^(\w+)\??\s*:\s*(.+)$/);
      if (match) {
        const name = match[1];
        const type = match[2].trim();
        const optional = trimmed.includes('?');

        properties.push({
          name,
          type,
          optional
        });
      }
    }

    return properties;
  }

  /**
   * Splits content by semicolons, handling nested objects
   */
  private _splitBySemicolons(content: string): string[] {
    const result: string[] = [];
    let current = '';
    let braceDepth = 0;

    for (let i = 0; i < content.length; i++) {
      const char = content[i];

      if (char === '{') {
        braceDepth++;
      } else if (char === '}') {
        braceDepth--;
      } else if (char === ';' && braceDepth === 0) {
        result.push(current.trim());
        current = '';
        continue;
      }

      current += char;
    }

    if (current.trim()) {
      result.push(current.trim());
    }

    return result;
  }

  /**
   * Splits type parameters for generic types, handling nested generics
   */
  private _splitTypeParameters(typeParams: string): string[] {
    const result: string[] = [];
    let current = '';
    let angleDepth = 0;

    for (let i = 0; i < typeParams.length; i++) {
      const char = typeParams[i];

      if (char === '<') {
        angleDepth++;
      } else if (char === '>') {
        angleDepth--;
      } else if (char === ',' && angleDepth === 0) {
        result.push(current.trim());
        current = '';
        continue;
      }

      current += char;
    }

    if (current.trim()) {
      result.push(current.trim());
    }

    return result;
  }
}