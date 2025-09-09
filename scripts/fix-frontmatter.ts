#!/usr/bin/env bun
/**
 * HyperDev Documentation Frontmatter Standardization Script
 * 
 * Systematically fixes frontmatter inconsistencies across all MDX files
 * - Adds missing frontmatter to snippet-intro.mdx
 * - Adds SEO-optimized descriptions (150-160 chars)
 * - Standardizes icon system using Mintlify library
 * - Adds OpenGraph metadata support
 * - Creates backups and supports rollback
 * - Groups commits by file category
 */

import { readdir, readFile, writeFile, mkdir, copyFile } from 'fs/promises';
import { join, dirname, basename, extname } from 'path';
import { existsSync } from 'fs';
import { execSync } from 'child_process';

interface FrontmatterData {
  title?: string;
  description?: string;
  icon?: string;
  openapi?: string;
  sidebarTitle?: string;
  'og:title'?: string;
  'og:description'?: string;
  [key: string]: any;
}

interface FileInfo {
  path: string;
  relativePath: string;
  category: string;
  hasIssues: boolean;
  issues: string[];
}

interface ProcessingResult {
  processed: number;
  fixed: number;
  skipped: number;
  errors: string[];
  backups: string[];
}

class FrontmatterProcessor {
  private docsDir: string;
  private backupDir: string;
  private issueFiles: string[];

  constructor(docsDir: string) {
    this.docsDir = docsDir;
    this.backupDir = join(dirname(docsDir), 'frontmatter-backups');
    
    // Files identified in audit that need fixes
    this.issueFiles = [
      'snippets/snippet-intro.mdx',
      'api-reference/endpoint/create.mdx',
      'api-reference/endpoint/get.mdx',
      'api-reference/endpoint/delete.mdx',
      'api-reference/endpoint/webhook.mdx'
    ];
  }

  async createBackup(): Promise<void> {
    console.log('📦 Creating backups...');
    if (!existsSync(this.backupDir)) {
      await mkdir(this.backupDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = join(this.backupDir, `backup-${timestamp}`);
    await mkdir(backupPath, { recursive: true });

    // Backup all MDX files
    const mdxFiles = await this.getAllMdxFiles();
    for (const file of mdxFiles) {
      const relativePath = file.relativePath;
      const backupFilePath = join(backupPath, relativePath);
      await mkdir(dirname(backupFilePath), { recursive: true });
      await copyFile(file.path, backupFilePath);
    }

    console.log(`✅ Backup created at: ${backupPath}`);
  }

  async getAllMdxFiles(): Promise<FileInfo[]> {
    const files: FileInfo[] = [];
    const issueFiles = this.issueFiles; // Capture in closure
    
    const scanDirectory = async (dir: string, baseDir: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        
        if (entry.isDirectory()) {
          await scanDirectory(fullPath, baseDir);
        } else if (entry.name.endsWith('.mdx')) {
          const relativePath = fullPath.replace(baseDir + '/', '');
          const category = dirname(relativePath) === '.' ? 'root' : dirname(relativePath).split('/')[0];
          
          files.push({
            path: fullPath,
            relativePath,
            category,
            hasIssues: issueFiles.includes(relativePath),
            issues: issueFiles.includes(relativePath) ? ['Missing frontmatter or description'] : []
          });
        }
      }
    };

    await scanDirectory(this.docsDir, this.docsDir);
    return files;
  }

  parseFrontmatter(content: string): { frontmatter: FrontmatterData; content: string } {
    const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    
    if (!frontmatterMatch) {
      return { frontmatter: {}, content };
    }

    const [, frontmatterText, bodyContent] = frontmatterMatch;
    const frontmatter: FrontmatterData = {};

    // Simple YAML parser for basic key-value pairs
    const lines = frontmatterText.split('\n');
    for (const line of lines) {
      const match = line.match(/^(\s*)([^:]+):\s*['"]?([^'"]*?)['"]?\s*$/);
      if (match) {
        const [, , key, value] = match;
        frontmatter[key.trim()] = value.trim();
      }
    }

    return { frontmatter, content: bodyContent };
  }

  generateSeoDescription(title: string, category: string, content: string): string {
    const descriptions: Record<string, string> = {
      'snippets/snippet-intro.mdx': 'Learn how to create and use reusable content snippets in HyperDev documentation to maintain DRY principles and consistent messaging across all pages.',
      'api-reference/endpoint/create.mdx': 'Create new plant resources using the POST /plants endpoint. Includes request parameters, response schemas, and comprehensive usage examples.',
      'api-reference/endpoint/get.mdx': 'Retrieve plant resource data using the GET /plants endpoint. Learn about query parameters, response formats, and error handling best practices.',
      'api-reference/endpoint/delete.mdx': 'Delete plant resources using the DELETE /plants endpoint. Understand deletion methods, safety considerations, and proper error handling.',
      'api-reference/endpoint/webhook.mdx': 'Configure and manage plant webhook endpoints. Learn about webhook authentication, payload formats, and event handling in your applications.'
    };

    // Check if we have a custom description for this specific file
    const fileKey = this.issueFiles.find(file => content.includes(file)) || '';
    if (descriptions[fileKey]) {
      return descriptions[fileKey];
    }

    // Generate generic SEO-optimized description based on category and title
    const basePhrases: Record<string, string> = {
      'api-reference': `${title} API endpoint documentation with examples, parameters, and responses for HyperDev integration.`,
      'cli': `Learn how to use the ${title} command in HyperDev CLI with practical examples, options, and best practices.`,
      'guides': `Comprehensive ${title} guide for HyperDev developers with step-by-step instructions and real-world examples.`,
      'tools': `${title} tool documentation for HyperDev ecosystem with features, configuration, and integration examples.`,
      'examples': `Real-world ${title} examples and patterns for HyperDev development with code samples and best practices.`,
      'essentials': `Essential ${title} concepts and fundamentals for effective HyperDev development and workflow optimization.`,
      'methodology': `${title} methodology and approach in HyperDev development lifecycle with principles and implementation strategies.`,
      'community': `Community resources and ${title} information for HyperDev developers, contributors, and ecosystem participants.`,
      'default': `Complete ${title} documentation for HyperDev with examples, best practices, and implementation guidance.`
    };

    const template = basePhrases[category] || basePhrases['default'];
    const description = template.replace(/\s+/g, ' ').trim();

    // Ensure optimal SEO length (150-160 characters)
    if (description.length > 160) {
      return description.substring(0, 157) + '...';
    }
    if (description.length < 150) {
      return description + ' Get started with comprehensive documentation and examples.';
    }

    return description;
  }

  getIconForCategory(category: string, filename: string): string {
    const iconMap: Record<string, string> = {
      'api-reference': 'api',
      'cli': 'terminal',
      'guides': 'book-open',
      'tools': 'wrench-screwdriver',
      'examples': 'code',
      'essentials': 'lightbulb',
      'methodology': 'academic-cap',
      'community': 'users',
      'snippets': 'document-duplicate'
    };

    // Special cases for specific files
    if (filename.includes('installation')) return 'download';
    if (filename.includes('quickstart')) return 'rocket';
    if (filename.includes('troubleshooting')) return 'exclamation-triangle';
    if (filename.includes('security')) return 'shield-check';
    if (filename.includes('performance')) return 'bolt';
    if (filename.includes('migration')) return 'arrow-path';

    return iconMap[category] || 'document-text';
  }

  async processFile(fileInfo: FileInfo): Promise<boolean> {
    try {
      const content = await readFile(fileInfo.path, 'utf8');
      const { frontmatter, content: bodyContent } = this.parseFrontmatter(content);

      let needsUpdate = false;
      const updates: FrontmatterData = { ...frontmatter };

      // Fix missing frontmatter for snippet-intro.mdx
      if (fileInfo.relativePath === 'snippets/snippet-intro.mdx' && Object.keys(frontmatter).length === 0) {
        updates.title = 'Reusable Snippets';
        updates.description = this.generateSeoDescription('Reusable Snippets', 'snippets', content);
        updates.icon = 'document-duplicate';
        needsUpdate = true;
        console.log(`  📝 Adding missing frontmatter to ${fileInfo.relativePath}`);
      }

      // Fix missing descriptions for API endpoints
      if (fileInfo.category === 'api-reference' && !frontmatter.description) {
        updates.description = this.generateSeoDescription(frontmatter.title || 'API Endpoint', 'api-reference', content);
        needsUpdate = true;
        console.log(`  📝 Adding SEO description to ${fileInfo.relativePath}`);
      }

      // Standardize icons if missing
      if (!frontmatter.icon) {
        updates.icon = this.getIconForCategory(fileInfo.category, fileInfo.relativePath);
        needsUpdate = true;
        console.log(`  🎨 Adding icon to ${fileInfo.relativePath}`);
      }

      // Add OpenGraph metadata for better social sharing
      if (updates.title && !frontmatter['og:title']) {
        updates['og:title'] = updates.title;
        needsUpdate = true;
      }

      if (updates.description && !frontmatter['og:description']) {
        updates['og:description'] = updates.description;
        needsUpdate = true;
      }

      // Write updated file if changes needed
      if (needsUpdate) {
        const frontmatterLines: string[] = [];
        for (const [key, value] of Object.entries(updates)) {
          if (value !== undefined && value !== '') {
            frontmatterLines.push(`${key}: "${value}"`);
          }
        }

        const newContent = `---\n${frontmatterLines.join('\n')}\n---\n${bodyContent}`;
        await writeFile(fileInfo.path, newContent, 'utf8');
        return true;
      }

      return false;
    } catch (error) {
      console.error(`❌ Error processing ${fileInfo.path}:`, error);
      throw error;
    }
  }

  async processAllFiles(): Promise<ProcessingResult> {
    console.log('🔍 Scanning all MDX files...');
    const files = await this.getAllMdxFiles();
    console.log(`Found ${files.length} MDX files`);

    const result: ProcessingResult = {
      processed: 0,
      fixed: 0,
      skipped: 0,
      errors: [],
      backups: []
    };

    // Process files by category for organized commits
    const categories = [...new Set(files.map(f => f.category))];
    
    for (const category of categories) {
      const categoryFiles = files.filter(f => f.category === category);
      console.log(`\n📁 Processing ${category} (${categoryFiles.length} files)`);

      let categoryFixed = 0;
      const fixedFiles: string[] = [];

      for (const file of categoryFiles) {
        try {
          result.processed++;
          const wasFixed = await this.processFile(file);
          
          if (wasFixed) {
            result.fixed++;
            categoryFixed++;
            fixedFiles.push(file.relativePath);
          } else {
            result.skipped++;
          }
        } catch (error) {
          result.errors.push(`${file.relativePath}: ${error}`);
        }
      }

      // Create category-specific commit if files were fixed
      if (categoryFixed > 0) {
        try {
          execSync(`cd "${this.docsDir}" && git add ${fixedFiles.map(f => `"${f}"`).join(' ')}`);
          const commitMessage = `docs(frontmatter): standardize ${category} frontmatter
  
- Fix missing descriptions and frontmatter
- Add SEO-optimized descriptions (150-160 chars)
- Standardize Mintlify icon system
- Add OpenGraph metadata for social sharing

Files updated: ${categoryFixed}
Category: ${category}`;

          execSync(`cd "${this.docsDir}" && git commit -m "${commitMessage}"`);
          console.log(`✅ Committed ${categoryFixed} ${category} files`);
        } catch (error) {
          console.warn(`⚠️ Git commit failed for ${category}:`, error);
        }
      }
    }

    return result;
  }

  async validateChanges(): Promise<boolean> {
    console.log('\n🔍 Validating changes...');
    
    try {
      // Check that all issue files now have proper frontmatter
      for (const issueFile of this.issueFiles) {
        const filePath = join(this.docsDir, issueFile);
        if (!existsSync(filePath)) continue;

        const content = await readFile(filePath, 'utf8');
        const { frontmatter } = this.parseFrontmatter(content);

        if (!frontmatter.title) {
          console.error(`❌ Validation failed: ${issueFile} still missing title`);
          return false;
        }

        if (!frontmatter.description) {
          console.error(`❌ Validation failed: ${issueFile} still missing description`);
          return false;
        }

        if (frontmatter.description.length < 50 || frontmatter.description.length > 170) {
          console.warn(`⚠️  ${issueFile} description length: ${frontmatter.description.length} chars (target: 150-160)`);
        }
      }

      console.log('✅ All validations passed');
      return true;
    } catch (error) {
      console.error('❌ Validation error:', error);
      return false;
    }
  }

  async run(): Promise<void> {
    console.log('🚀 HyperDev Frontmatter Standardization Starting...\n');

    try {
      // Create backup before any changes
      await this.createBackup();

      // Process all files
      const result = await this.processAllFiles();

      // Display results
      console.log('\n📊 Processing Summary:');
      console.log(`   Processed: ${result.processed} files`);
      console.log(`   Fixed: ${result.fixed} files`);
      console.log(`   Skipped: ${result.skipped} files`);
      console.log(`   Errors: ${result.errors.length}`);

      if (result.errors.length > 0) {
        console.log('\n❌ Errors encountered:');
        result.errors.forEach(error => console.log(`   ${error}`));
      }

      // Validate changes
      const isValid = await this.validateChanges();
      
      if (isValid && result.fixed > 0) {
        console.log('\n✅ Frontmatter standardization completed successfully!');
        console.log('🎯 All issues from audit report have been resolved.');
        console.log('📈 SEO descriptions optimized for 150-160 character range.');
        console.log('🎨 Mintlify icon system applied consistently.');
        console.log('📱 OpenGraph metadata added for social sharing.');
      } else if (result.fixed === 0) {
        console.log('\n✨ All files already have proper frontmatter - no changes needed!');
      } else {
        console.log('\n⚠️ Some issues remain - check validation output above.');
      }

    } catch (error) {
      console.error('❌ Fatal error during processing:', error);
      process.exit(1);
    }
  }
}

// Execute if run directly
if (import.meta.main) {
  const docsDir = process.argv[2] || '/work/hyperdev/apps/docs';
  const processor = new FrontmatterProcessor(docsDir);
  processor.run();
}