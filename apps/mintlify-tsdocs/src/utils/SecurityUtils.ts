/**
 * Security utilities for input validation, sanitization, and secure file operations.
 */

import * as path from 'path';

export class SecurityUtils {
  /**
   * Reserved filenames that should not be used for security reasons
   */
  private static readonly RESERVED_FILENAMES = new Set([
    // Windows reserved names
    'CON', 'PRN', 'AUX', 'NUL',
    'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
    'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
    // Common dangerous files
    '.htaccess', '.htpasswd', 'web.config', 'php.ini', 'robots.txt',
    // Git and system files
    '.git', '.gitignore', '.svn', '.DS_Store', 'Thumbs.db'
  ]);

  /**
   * Validates that a file path is within the allowed base directory.
   * Prevents path traversal attacks.
   *
   * @param basePath - The base directory that files must be within
   * @param filePath - The file path to validate
   * @returns The resolved and validated file path
   * @throws Error if path traversal is detected
   */
  public static validateFilePath(basePath: string, filePath: string): string {
    // Resolve both paths to absolute paths
    const resolvedBase = path.resolve(basePath);
    const resolvedFile = path.resolve(basePath, filePath);

    // Ensure the file path is within the base directory
    if (!resolvedFile.startsWith(resolvedBase)) {
      throw new Error(`Path traversal detected: "${filePath}" is outside allowed directory "${basePath}"`);
    }

    return resolvedFile;
  }

  /**
   * Validates that a filename is safe to use.
   * Prevents reserved names, path traversal, and dangerous characters.
   *
   * @param filename - The filename to validate
   * @returns The sanitized filename
   * @throws Error if filename is invalid or dangerous
   */
  public static validateFilename(filename: string): string {
    if (!filename || filename.trim().length === 0) {
      throw new Error('Filename cannot be empty');
    }

    // Remove any path components (prevent directory traversal)
    const basename = path.basename(filename);

    // Check for reserved filenames
    const upperName = basename.toUpperCase();
    if (this.RESERVED_FILENAMES.has(upperName)) {
      throw new Error(`Reserved filename detected: "${basename}"`);
    }

    // Check for path traversal patterns
    if (basename.includes('..') || basename.includes('~') || basename.startsWith('/')) {
      throw new Error(`Invalid filename: "${basename}" contains dangerous characters`);
    }

    // Validate filename length
    if (basename.length > 255) {
      throw new Error(`Filename too long: "${basename}" exceeds 255 characters`);
    }

    return basename;
  }

  /**
   * Sanitizes text for safe use in YAML frontmatter.
   * Prevents YAML injection and ensures proper formatting.
   *
   * @param text - The text to sanitize
   * @returns Sanitized text safe for YAML
   */
  public static sanitizeYamlText(text: string): string {
    if (!text) return '';

    // Escape special YAML characters
    let sanitized = text
      .replace(/\\/g, '\\\\')  // Escape backslashes first
      .replace(/"/g, '\\"')     // Escape double quotes
      .replace(/'/g, "\\'")     // Escape single quotes
      .replace(/\n/g, '\\n')     // Escape newlines
      .replace(/\r/g, '\\r')     // Escape carriage returns
      .replace(/\t/g, '\\t');    // Escape tabs

    // If text contains special characters or starts with reserved characters, wrap in quotes
    const needsQuotes = /^[\s\-\?:,\[\]{}#&*!|>'"%@`]/.test(sanitized) ||
                       /[:#@!|>]/.test(sanitized) ||
                       sanitized !== text;

    return needsQuotes ? `"${sanitized}"` : sanitized;
  }

  /**
   * Sanitizes text for safe use in JSX attributes.
   * Prevents JSX injection and ensures proper escaping.
   *
   * @param text - The text to sanitize
   * @param attributeName - The name of the JSX attribute (optional, for context-specific handling)
   * @returns Sanitized text safe for JSX attributes
   */
  public static sanitizeJsxAttribute(text: string, attributeName?: string): string {
    if (!text) return '';

    // Basic HTML entity encoding
    let sanitized = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');

    // Additional protection for specific attribute types
    if (attributeName === 'href' || attributeName === 'src') {
      // Prevent javascript: URLs and other dangerous protocols
      const dangerousProtocols = /^\s*(javascript|data|vbscript|file):/i;
      if (dangerousProtocols.test(text)) {
        throw new Error(`Dangerous protocol detected in ${attributeName}: "${text}"`);
      }
    }

    return sanitized;
  }

  /**
   * Sanitizes JSON data for safe embedding in JSX components.
   * Prevents JSON injection and ensures proper formatting.
   *
   * @param data - The data to serialize and sanitize
   * @returns Sanitized JSON string safe for JSX embedding
   */
  public static sanitizeJsonForJsx(data: unknown): string {
    try {
      // First serialize to JSON
      const jsonString = JSON.stringify(data);

      // Escape for safe use in JSX
      return jsonString
        .replace(/&/g, '\\u0026')  // Escape ampersands as Unicode
        .replace(/</g, '\\u003c')  // Escape less-than as Unicode
        .replace(/>/g, '\\u003e')  // Escape greater-than as Unicode
        .replace(/\u2028/g, '\\u2028') // Escape line separator
        .replace(/\u2029/g, '\\u2029'); // Escape paragraph separator
    } catch (error) {
      throw new Error(`Failed to sanitize JSON data: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Validates and sanitizes CLI input parameters.
   *
   * @param input - The input to validate
   * @param parameterName - The name of the parameter for error messages
   * @returns Sanitized input
   * @throws Error if input is invalid
   */
  public static validateCliInput(input: string, parameterName: string): string {
    if (!input || input.trim().length === 0) {
      throw new Error(`${parameterName} cannot be empty`);
    }

    // Remove leading/trailing whitespace
    let sanitized = input.trim();

    // Check for potential command injection
    const dangerousPatterns = [
      /[;&|`]/,           // Command separators and pipes
      /\$\(/,             // Command substitution
      /<.*>/,             // Redirection
      /\n|\r/             // Newlines that could break commands
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(sanitized)) {
        throw new Error(`${parameterName} contains invalid characters that could be used for command injection`);
      }
    }

    // Limit length to prevent buffer overflow
    if (sanitized.length > 1000) {
      throw new Error(`${parameterName} is too long (max 1000 characters)`);
    }

    return sanitized;
  }

  /**
   * Validates JSON content to ensure it's safe to parse.
   *
   * @param jsonString - The JSON string to validate
   * @returns The original JSON string if valid
   * @throws Error if JSON appears dangerous or malformed
   */
  public static validateJsonContent(jsonString: string): string {
    if (!jsonString || jsonString.trim().length === 0) {
      throw new Error('JSON content cannot be empty');
    }

    const trimmed = jsonString.trim();

    // Basic JSON structure validation
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      throw new Error('Invalid JSON: must start with { or [');
    }

    if (!trimmed.endsWith('}') && !trimmed.endsWith(']')) {
      throw new Error('Invalid JSON: must end with } or ]');
    }

    // Check for potentially dangerous content
    // Note: We allow "constructor" and "prototype" as they're legitimate in API documentation
    // Only check for actual code execution patterns
    const dangerousPatterns = [
      /__proto__/,        // Prototype pollution (still dangerous even in JSON keys)
      /eval\s*\(/,         // Code execution
      /Function\s*\(/,     // Function constructor
      /setTimeout\s*\(/,   // Timed code execution
      /setInterval\s*\(/   // Repeated code execution
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(trimmed)) {
        throw new Error('JSON content contains potentially dangerous patterns');
      }
    }

    // Limit size to prevent memory exhaustion
    if (trimmed.length > 10 * 1024 * 1024) { // 10MB limit
      throw new Error('JSON content is too large (max 10MB)');
    }

    return trimmed;
  }
}