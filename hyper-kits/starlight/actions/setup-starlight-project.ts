import type { ActionContext, ActionResult } from 'hypergen/types';
import path from 'path';
import { mkdir, writeFile } from 'fs/promises';

export async function setupStarlightProject(context: ActionContext): Promise<ActionResult> {
  const { args, utils, logger } = context;
  
  logger.info('Setting up Starlight project structure...');
  
  try {
    // Create directory structure
    const projectPath = args.projectFolder || 'my-docs-site';
    const basePath = path.join(process.cwd(), projectPath);
    
    // Create necessary directories
    const directories = [
      'src/content/docs',
      'src/content/config.ts',
      'public',
      'astro'
    ];
    
    for (const dir of directories) {
      const fullPath = path.join(basePath, dir);
      await utils.createDirectory(fullPath);
      logger.info(`Created directory: ${dir}`);
    }
    
    // Create src/env.d.ts
    const envDtsContent = `/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />`;
    
    await utils.writeFile(path.join(basePath, 'src/env.d.ts'), envDtsContent);
    logger.info('Created src/env.d.ts');
    
    // Create astro integration files if needed
    if (args.enableTypedoc) {
      const typedocConfig = `export default {
  entryPoints: ["${args.entryPoint || 'src/index.ts'}"],
  out: "./src/content/docs/api",
  plugin: ["typedoc-plugin-markdown"],
  disableSources: true,
  hideBreadcrumbs: true,
  hideInPageTOC: true
};`;
      
      await utils.writeFile(path.join(basePath, 'typedoc.json'), typedocConfig);
      logger.info('Created typedoc.json configuration');
    }
    
    // Create .gitignore
    const gitignoreContent = `# Dependencies
node_modules/

# Build output
dist/
.output/

# Generated files
.astro/

# Environment variables
.env
.env.local
.env.*.local

# macOS-specific files
.DS_Store

# Editor directories and files
.vscode/*
!.vscode/extensions.json
.idea
*.suo
*.ntvs*
*.njsproj
*.sln
*.sw?

# TypeDoc output
docs/
`;
    
    await utils.writeFile(path.join(basePath, '.gitignore'), gitignoreContent);
    logger.info('Created .gitignore');
    
    logger.info(`✅ Successfully set up Starlight project structure in ${projectPath}`);
    
    return {
      success: true,
      files: directories.map(dir => path.join(projectPath, dir)),
      message: `Starlight project structure created in ${projectPath}`
    };
    
  } catch (error: any) {
    logger.error(`Failed to set up Starlight project: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}