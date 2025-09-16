/**
 * Main transformer that converts TypeDoc markdown to Mintlify-compatible MDX
 */
import { MarkdownPageEvent } from 'typedoc-plugin-markdown';
import { Reflection } from 'typedoc';

export function transformToMintlify(page: MarkdownPageEvent<Reflection>): string {
  let content = page.contents || '';
  
  // Generate and add frontmatter
  const frontmatter = generateFrontmatter(page);
  
  // Remove the first h1 heading since it's now in frontmatter
  content = content.replace(/^#\s+.+$/m, '');
  
  // Apply component transformations
  content = transformComponents(content, page);
  
  // Enhance code blocks
  content = enhanceCodeBlocks(content);
  
  // Clean up extra whitespace
  content = content.replace(/\n{3,}/g, '\n\n').trim();
  
  return `${frontmatter}\n\n${content}`;
}

function generateFrontmatter(page: MarkdownPageEvent<Reflection>): string {
  const model = page.model;
  
  // Extract title from the model and clean it for YAML
  let title = model.name || 'API Reference';
  
  // Generate description from comment or model type
  let description = '';
  if (model.comment?.summary) {
    description = model.comment.summary
      .map(part => part.text || part.toString())
      .join(' ')
      .replace(/\n/g, ' ')
      .trim()
      .slice(0, 160);
  }
  
  if (!description) {
    // Fallback descriptions based on model kind
    description = generateFallbackDescription(title, model);
  }
  
  // Clean title and description for YAML compatibility
  title = cleanForYAML(title);
  description = cleanForYAML(description);
  
  return `---
title: "${title}"
description: "${description}"
---`;
}

/**
 * Clean text for YAML frontmatter compatibility
 */
function cleanForYAML(text: string): string {
  return text
    // Remove angle brackets completely which cause YAML issues
    .replace(/[<>]/g, '')
    // Escape double quotes
    .replace(/"/g, '\\"')
    // Remove any control characters
    .replace(/[\x00-\x1F\x7F]/g, '')
    // Trim whitespace
    .trim();
}

function generateFallbackDescription(title: string, model: Reflection): string {
  switch (model.kind) {
    case 128: // Class
      return `${title} class reference and API documentation`;
    case 256: // Interface  
      return `${title} interface definition and usage guide`;
    case 64: // Function
      return `${title} function documentation and examples`;
    case 4194304: // TypeAlias
      return `${title} type alias definition and usage`;
    case 32: // Variable
      return `${title} variable documentation and reference`;
    case 8: // Enum
      return `${title} enumeration values and usage`;
    case 2: // Module
      return `${title} module documentation and exports`;
    default:
      return `API documentation for ${title}`;
  }
}

function transformComponents(content: string, page: MarkdownPageEvent<Reflection>): string {
  // Remove any inappropriate REST API components first
  content = removeInappropriateComponents(content);
  
  // Clean up problematic expressions that break MDX parsing
  content = cleanMDXExpressions(content);
  
  // Transform parameter tables to structured content (not API ParamField)
  content = transformParameterSections(content);
  
  // Transform property tables (simplified without components)
  content = transformPropertyTables(content);
  
  // Transform method groups with cleaner structure
  content = transformMethodGroups(content);
  
  // Add appropriate alert components for special sections
  content = transformAlertSections(content);
  
  return content;
}

function cleanMDXExpressions(content: string): string {
  // Fix problematic expressions that break MDX parsing
  return content
    // Fix unclosed JSX expressions 
    .replace(/\{[^}]*$/gm, '')
    // Remove problematic characters that break MDX 
    .replace(/<%/g, '&lt;%')
    .replace(/%>/g, '%&gt;')
    // Clean up malformed inline code with brackets
    .replace(/`([^`]*)<([^>]*)>`/g, '`$1&lt;$2&gt;`')
    // Remove any standalone { or } that might break JSX
    .replace(/^[\s]*[\{\}][\s]*$/gm, '');
}

function removeInappropriateComponents(content: string): string {
  // Remove any REST API components that shouldn't be in code documentation
  return content
    .replace(/<ResponseField[^>]*>[\s\S]*?<\/ResponseField>/g, '')
    .replace(/<ParamField[^>]*>[\s\S]*?<\/ParamField>/g, '')
    .replace(/<ApiRef[^>]*>[\s\S]*?<\/ApiRef>/g, '')
    .replace(/<OpenApiResponse[^>]*>[\s\S]*?<\/OpenApiResponse>/g, '');
}

function transformParameterSections(content: string): string {
  // Transform parameter tables to structured lists
  return content.replace(/## Parameters?\n\n([\s\S]*?)(?=\n## |$)/g, (match, params) => {
    if (params.includes('| ')) {
      // It's a table, convert to structured list
      const rows = params.split('\n').filter((line: string) => line.includes('|') && !line.includes('---'));
      if (rows.length > 1) {
        const paramList = rows.slice(1).map((row: string) => {
          const cells = row.split('|').map((cell: string) => cell.trim()).filter(Boolean);
          if (cells.length >= 3) {
            const [name, type, description] = cells;
            return `**\`${name}\`** \`${type}\`\n\n${description}`;
          }
          return '';
        }).filter(Boolean);
        
        return `## Parameters\n\n${paramList.join('\n\n')}\n\n`;
      }
    }
    return match;
  });
}

function transformPropertyTables(content: string): string {
  // For now, disable Expandable components to avoid MDX parsing issues
  // Just clean up the Properties section without wrapping in components
  return content.replace(/## Properties\n\n([\s\S]*?)(?=\n## |$)/g, (match, properties) => {
    // Clean the properties content
    const cleanProperties = properties
      .replace(/<ResponseField[^>]*>[\s\S]*?<\/ResponseField>/g, '')
      .replace(/#### Returns\n\n`([^`]+)`/g, '**Returns:** `$1`')
      .trim();
    
    return `## Properties\n\n${cleanProperties}\n\n`;
  });
}

function transformMethodGroups(content: string): string {
  // Transform methods section to use cleaner structure without complex accordions
  return content.replace(/## Methods\n\n([\s\S]*?)(?=\n## |$)/g, (match, methods) => {
    // Simple method organization - just clean up the formatting
    const cleanMethods = methods
      // Remove any malformed ResponseField components
      .replace(/<ResponseField[^>]*>[\s\S]*?<\/ResponseField>/g, '')
      // Clean up return type formatting
      .replace(/#### Returns\n\n`([^`]+)`/g, '**Returns:** `$1`')
      // Clean up parameter formatting
      .replace(/##### (\w+)\n\n`([^`]+)`/g, '**`$1`** `$2`');
    
    return `## Methods\n\n${cleanMethods}`;
  });
}

function transformAlertSections(content: string): string {
  // Transform deprecated sections to Warning components
  content = content.replace(/## ⚠️ Deprecated/g, '## Deprecated');
  content = content.replace(/^> ⚠️ (.+)$/gm, '<Warning>$1</Warning>');
  
  // Transform note sections to Info components  
  content = content.replace(/^> ℹ️ (.+)$/gm, '<Info>$1</Info>');
  content = content.replace(/^> 💡 (.+)$/gm, '<Tip>$1</Tip>');
  
  // Transform example sections to be more prominent
  content = content.replace(/## Example/g, '## Examples');
  
  return content;
}

function enhanceCodeBlocks(content: string): string {
  // Ensure TypeScript code blocks are properly labeled
  content = content.replace(/```(\n|ts\n|typescript\n)/g, '```typescript\n');
  
  // Ensure JavaScript code blocks are properly labeled
  content = content.replace(/```js\n/g, '```javascript\n');
  
  // Group multiple related code examples
  content = groupCodeExamples(content);
  
  return content;
}

function groupCodeExamples(content: string): string {
  // Look for multiple code blocks that could be grouped
  return content.replace(/(```\w+\n[\s\S]*?```)\n\n(```\w+\n[\s\S]*?```)/g, (match, block1, block2) => {
    // Check if these are related examples (both typescript/javascript)
    if ((block1.includes('typescript') || block1.includes('javascript')) && 
        (block2.includes('typescript') || block2.includes('javascript'))) {
      return `<CodeGroup>\n\n${block1}\n\n${block2}\n\n</CodeGroup>`;
    }
    return match;
  });
}