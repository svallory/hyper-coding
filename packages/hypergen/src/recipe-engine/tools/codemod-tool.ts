/**
 * CodeMod Tool Implementation for Recipe Step System
 *
 * This tool provides AST-based code transformations and modifications using
 * the TypeScript compiler API for TypeScript/JavaScript files, with fallback
 * support for text-based transformations for other file types.
 */

import path from 'node:path';
import createDebug from 'debug';
import fs from 'fs-extra';
import { glob } from 'glob';
import * as ts from 'typescript';
import {
	ErrorCode,
	ErrorHandler,
	HypergenError,
	withErrorHandling,
} from '../../errors/hypergen-errors.js';
import {
	type CodeModExecutionResult,
	type CodeModStep,
	type StepContext,
	type StepExecutionOptions,
	type StepResult,
	isCodeModStep,
} from '../types.js';
import { Tool, type ToolValidationResult } from './base.js';

const debug = createDebug('hypergen:v8:recipe:tool:codemod');

/**
 * Supported CodeMod transformation types
 */
export type CodeModType =
	| 'add-import'
	| 'add-export'
	| 'modify-function'
	| 'add-property'
	| 'replace-text'
	| 'custom';

/**
 * CodeMod transformation parameters
 */
export interface CodeModParameters {
	// Add Import parameters
	import?: string;
	from?: string;
	importType?: 'default' | 'named' | 'namespace' | 'side-effect';
	alias?: string;

	// Add Export parameters
	export?: string;
	exportType?: 'default' | 'named';

	// Modify Function parameters
	functionName?: string;
	newSignature?: string;
	newBody?: string;

	// Add Property parameters
	className?: string;
	objectName?: string;
	propertyName?: string;
	propertyValue?: string;
	propertyType?: string;

	// Replace Text parameters
	find?: string | RegExp;
	replace?: string;
	global?: boolean;

	// Custom transformation
	transformFunction?:
		| string
		| ((sourceFile: ts.SourceFile, context: CodeModContext) => ts.SourceFile);
}

/**
 * CodeMod execution context
 */
export interface CodeModContext {
	/** File path being transformed */
	filePath: string;

	/** Original source code */
	sourceCode: string;

	/** TypeScript source file (if applicable) */
	sourceFile?: ts.SourceFile;

	/** TypeScript program (if applicable) */
	program?: ts.Program;

	/** Step context */
	stepContext: StepContext;

	/** CodeMod parameters */
	parameters: CodeModParameters;

	/** Whether this is a dry run */
	dryRun: boolean;

	/** Whether to force overwrite */
	force: boolean;
}

/**
 * File transformation result
 */
interface FileTransformationResult {
	/** Original file path */
	filePath: string;

	/** Whether file was modified */
	modified: boolean;

	/** Original content */
	originalContent: string;

	/** Transformed content */
	transformedContent: string;

	/** Backup file path (if created) */
	backupPath?: string;

	/** Transformation errors */
	errors: string[];

	/** Transformation warnings */
	warnings: string[];

	/** Applied transformations */
	transformations: Array<{
		type: string;
		description: string;
		line?: number;
		column?: number;
	}>;
}

/**
 * Built-in CodeMod transformations
 */
class CodeModTransformations {
	/**
	 * Add import statement to TypeScript/JavaScript file
	 */
	static addImport(
		sourceFile: ts.SourceFile,
		parameters: CodeModParameters,
	): ts.SourceFile {
		if (!parameters.import || !parameters.from) {
			throw new Error(
				'import and from parameters are required for add-import transformation',
			);
		}

		const factory = ts.factory;
		let importDeclaration: ts.ImportDeclaration;

		switch (parameters.importType || 'named') {
			case 'default':
				importDeclaration = factory.createImportDeclaration(
					undefined,
					factory.createImportClause(
						false,
						factory.createIdentifier(parameters.alias || parameters.import),
						undefined,
					),
					factory.createStringLiteral(parameters.from),
				);
				break;

			case 'named':
				importDeclaration = factory.createImportDeclaration(
					undefined,
					factory.createImportClause(
						false,
						undefined,
						factory.createNamedImports([
							factory.createImportSpecifier(
								false,
								parameters.alias
									? factory.createIdentifier(parameters.import)
									: undefined,
								factory.createIdentifier(parameters.alias || parameters.import),
							),
						]),
					),
					factory.createStringLiteral(parameters.from),
				);
				break;

			case 'namespace':
				importDeclaration = factory.createImportDeclaration(
					undefined,
					factory.createImportClause(
						false,
						undefined,
						factory.createNamespaceImport(
							factory.createIdentifier(parameters.alias || parameters.import),
						),
					),
					factory.createStringLiteral(parameters.from),
				);
				break;

			case 'side-effect':
				importDeclaration = factory.createImportDeclaration(
					undefined,
					undefined,
					factory.createStringLiteral(parameters.from),
				);
				break;

			default:
				throw new Error(`Unsupported import type: ${parameters.importType}`);
		}

		// Check if import already exists
		const existingImport = sourceFile.statements.find(
			(statement): statement is ts.ImportDeclaration =>
				ts.isImportDeclaration(statement) &&
				ts.isStringLiteral(statement.moduleSpecifier) &&
				statement.moduleSpecifier.text === parameters.from,
		);

		if (existingImport) {
			// TODO: Merge with existing import if needed
			debug('Import from %s already exists, skipping', parameters.from);
			return sourceFile;
		}

		// Add import at the top (after other imports)
		const lastImportIndex = sourceFile.statements.findLastIndex((statement) =>
			ts.isImportDeclaration(statement),
		);

		const insertIndex = lastImportIndex >= 0 ? lastImportIndex + 1 : 0;
		const newStatements = [...sourceFile.statements];
		newStatements.splice(insertIndex, 0, importDeclaration);

		return factory.updateSourceFile(sourceFile, newStatements);
	}

	/**
	 * Add export statement to TypeScript/JavaScript file
	 */
	static addExport(
		sourceFile: ts.SourceFile,
		parameters: CodeModParameters,
	): ts.SourceFile {
		if (!parameters.export) {
			throw new Error(
				'export parameter is required for add-export transformation',
			);
		}

		const factory = ts.factory;
		let exportDeclaration: ts.ExportDeclaration | ts.ExportAssignment;

		if (parameters.exportType === 'default') {
			exportDeclaration = factory.createExportAssignment(
				undefined,
				true,
				factory.createIdentifier(parameters.export),
			);
		} else {
			exportDeclaration = factory.createExportDeclaration(
				undefined,
				false,
				factory.createNamedExports([
					factory.createExportSpecifier(
						false,
						undefined,
						factory.createIdentifier(parameters.export),
					),
				]),
			);
		}

		// Add export at the end
		const newStatements = [...sourceFile.statements, exportDeclaration];
		return factory.updateSourceFile(sourceFile, newStatements);
	}

	/**
	 * Add property to class or object
	 */
	static addProperty(
		sourceFile: ts.SourceFile,
		parameters: CodeModParameters,
	): ts.SourceFile {
		if (!parameters.propertyName || !parameters.propertyValue) {
			throw new Error(
				'propertyName and propertyValue are required for add-property transformation',
			);
		}

		const factory = ts.factory;

		// Transform function to add property
		const transformer: ts.TransformerFactory<ts.SourceFile> = (context) => {
			return (rootNode) => {
				function visit(node: ts.Node): ts.Node {
					// Add to class
					if (
						parameters.className &&
						ts.isClassDeclaration(node) &&
						node.name?.text === parameters.className
					) {
						const newProperty = factory.createPropertyDeclaration(
							undefined,
							factory.createIdentifier(parameters.propertyName!),
							undefined,
							parameters.propertyType
								? factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword)
								: undefined, // Simplified
							factory.createStringLiteral(parameters.propertyValue!),
						);

						const newMembers = [...(node.members || []), newProperty];
						return factory.updateClassDeclaration(
							node,
							node.modifiers,
							node.name,
							node.typeParameters,
							node.heritageClauses,
							newMembers,
						);
					}

					// Add to object literal
					if (
						parameters.objectName &&
						ts.isVariableDeclaration(node) &&
						ts.isIdentifier(node.name) &&
						node.name.text === parameters.objectName &&
						node.initializer &&
						ts.isObjectLiteralExpression(node.initializer)
					) {
						const newProperty = factory.createPropertyAssignment(
							factory.createIdentifier(parameters.propertyName!),
							factory.createStringLiteral(parameters.propertyValue!),
						);

						const newProperties = [...node.initializer.properties, newProperty];
						const newInitializer = factory.updateObjectLiteralExpression(
							node.initializer,
							newProperties,
						);

						return factory.updateVariableDeclaration(
							node,
							node.name,
							node.exclamationToken,
							node.type,
							newInitializer,
						);
					}

					return ts.visitEachChild(node, visit, context);
				}

				return ts.visitNode(rootNode, visit) as ts.SourceFile;
			};
		};

		const result = ts.transform(sourceFile, [transformer]);
		const transformedFile = result.transformed[0];
		result.dispose();

		return transformedFile;
	}

	/**
	 * Replace text using regex or string matching
	 */
	static replaceText(content: string, parameters: CodeModParameters): string {
		if (parameters.find === undefined || parameters.replace === undefined) {
			throw new Error(
				'find and replace parameters are required for replace-text transformation',
			);
		}

		if (typeof parameters.find === 'string') {
			if (parameters.global) {
				return content.split(parameters.find).join(parameters.replace);
			}
			return content.replace(parameters.find, parameters.replace);
		}
		// RegExp
		const flags = parameters.global ? 'g' : '';
		const regex = new RegExp(parameters.find.source, flags);
		return content.replace(regex, parameters.replace);
	}
}

/**
 * CodeMod Tool for AST transformations and code modifications
 *
 * Features:
 * - TypeScript/JavaScript AST transformations using TypeScript compiler API
 * - Text-based transformations for other file types
 * - Built-in common transformations (add imports, exports, properties, etc.)
 * - Custom transformation functions
 * - Safe modification with backup and rollback
 * - Batch processing with glob patterns
 * - Comprehensive error handling and validation
 */
export class CodeModTool extends Tool<CodeModStep> {
	private tsConfigCache = new Map<string, ts.ParsedCommandLine>();
	private transformationCache = new Map<
		string,
		ts.TransformerFactory<ts.SourceFile>
	>();
	private backupFiles = new Set<string>();

	constructor(name = 'codemod-tool', options: Record<string, any> = {}) {
		super('codemod', name, options);
	}

	/**
	 * Initialize CodeMod tool
	 */
	protected async onInitialize(): Promise<void> {
		this.debug('Initializing CodeMod tool');

		try {
			// Register resource for cleanup of temporary files and caches
			this.registerResource({
				id: 'tsconfig-cache',
				type: 'cache',
				cleanup: () => {
					this.tsConfigCache.clear();
				},
				metadata: { cacheSize: 0 },
			});

			this.registerResource({
				id: 'transformation-cache',
				type: 'cache',
				cleanup: () => {
					this.transformationCache.clear();
				},
				metadata: { cacheSize: 0 },
			});

			this.registerResource({
				id: 'backup-files',
				type: 'file',
				cleanup: async () => {
					// Clean up backup files if they exist and cleanup is configured
					if (this.options.cleanupBackups) {
						for (const backupPath of this.backupFiles) {
							try {
								if (await fs.pathExists(backupPath)) {
									await fs.unlink(backupPath);
									this.debug('Cleaned up backup file: %s', backupPath);
								}
							} catch (error) {
								this.debug(
									'Failed to cleanup backup file %s: %s',
									backupPath,
									error,
								);
							}
						}
					}
					this.backupFiles.clear();
				},
				metadata: { backupCount: 0 },
			});

			this.debug('CodeMod tool initialized successfully');
		} catch (error) {
			throw ErrorHandler.createError(
				ErrorCode.INTERNAL_ERROR,
				`Failed to initialize CodeMod tool: ${error instanceof Error ? error.message : String(error)}`,
				{ phase: 'initialize', cause: error },
			);
		}
	}

	/**
	 * Validate CodeMod step configuration
	 */
	protected async onValidate(
		step: CodeModStep,
		context: StepContext,
	): Promise<ToolValidationResult> {
		const errors: string[] = [];
		const warnings: string[] = [];
		const suggestions: string[] = [];

		// Validate step is a CodeMod step
		if (!isCodeModStep(step)) {
			errors.push('Step is not a valid CodeModStep');
			return { isValid: false, errors, warnings, suggestions };
		}

		// Validate required fields
		if (!step.codemod) {
			errors.push('CodeMod identifier is required');
		}

		if (!step.files || step.files.length === 0) {
			errors.push('File patterns are required');
		}

		// Validate CodeMod type
		const validCodeModTypes: CodeModType[] = [
			'add-import',
			'add-export',
			'modify-function',
			'add-property',
			'replace-text',
			'custom',
		];
		if (
			step.codemod &&
			!validCodeModTypes.includes(step.codemod as CodeModType)
		) {
			errors.push(
				`Invalid CodeMod type: ${step.codemod}. Must be one of: ${validCodeModTypes.join(', ')}`,
			);
		}

		// Validate file patterns resolve to actual files
		if (step.files) {
			for (const pattern of step.files) {
				try {
					const resolvedPattern = path.resolve(context.projectRoot, pattern);
					const matches = await this.globFiles(resolvedPattern);

					if (matches.length === 0) {
						warnings.push(`No files found matching pattern: ${pattern}`);
					} else {
						this.debug('Pattern %s matches %d files', pattern, matches.length);
					}
				} catch (error) {
					errors.push(`Invalid file pattern: ${pattern}`);
				}
			}
		}

		// Validate parser setting
		if (
			step.parser &&
			!['typescript', 'javascript', 'json', 'auto'].includes(step.parser)
		) {
			errors.push(
				`Invalid parser: ${step.parser}. Must be 'typescript', 'javascript', 'json', or 'auto'`,
			);
		}

		// Validate parameters based on CodeMod type
		if (step.parameters) {
			const params = step.parameters as CodeModParameters;

			switch (step.codemod) {
				case 'add-import':
					if (!params.import || !params.from) {
						errors.push('add-import requires "import" and "from" parameters');
					}
					if (
						params.importType &&
						!['default', 'named', 'namespace', 'side-effect'].includes(
							params.importType,
						)
					) {
						errors.push(
							'importType must be one of: default, named, namespace, side-effect',
						);
					}
					break;

				case 'add-export':
					if (!params.export) {
						errors.push('add-export requires "export" parameter');
					}
					if (
						params.exportType &&
						!['default', 'named'].includes(params.exportType)
					) {
						errors.push('exportType must be "default" or "named"');
					}
					break;

				case 'add-property':
					if (!params.propertyName || !params.propertyValue) {
						errors.push(
							'add-property requires "propertyName" and "propertyValue" parameters',
						);
					}
					if (!params.className && !params.objectName) {
						errors.push(
							'add-property requires either "className" or "objectName" parameter',
						);
					}
					break;

				case 'replace-text':
					if (params.find === undefined || params.replace === undefined) {
						errors.push(
							'replace-text requires "find" and "replace" parameters',
						);
					}
					break;

				case 'custom':
					if (!params.transformFunction) {
						errors.push(
							'custom CodeMod requires "transformFunction" parameter',
						);
					}
					break;
			}
		}

		// Performance and complexity warnings
		if (step.files && step.files.length > 50) {
			warnings.push('Large number of file patterns may impact performance');
			suggestions.push(
				'Consider using more specific patterns or processing files in batches',
			);
		}

		// Backup recommendations
		if (step.backup === false) {
			warnings.push('Backup is disabled - consider enabling for safety');
			suggestions.push(
				'Set backup: true to create backup files before transformation',
			);
		}

		// Estimate execution time
		let estimatedTime = 200; // Base time in ms
		if (step.files) {
			estimatedTime += step.files.length * 100; // Time per file pattern
		}
		if (step.parser === 'typescript') {
			estimatedTime += 500; // TypeScript parsing overhead
		}

		const resourceRequirements = {
			memory: 20 * 1024 * 1024, // 20MB for TypeScript compiler
			disk: 1 * 1024 * 1024, // 1MB for backup files
			network: false,
			processes: 1,
		};

		return {
			isValid: errors.length === 0,
			errors,
			warnings,
			suggestions,
			estimatedExecutionTime: estimatedTime,
			resourceRequirements,
		};
	}

	/**
	 * Execute the CodeMod tool
	 */
	protected async onExecute(
		step: CodeModStep,
		context: StepContext,
		options?: StepExecutionOptions,
	): Promise<StepResult> {
		this.debug('Executing CodeMod step: %s -> %s', step.name, step.codemod);

		const startTime = new Date();
		const filesModified: string[] = [];
		const transformationResults: FileTransformationResult[] = [];
		const allErrors: string[] = [];
		const allWarnings: string[] = [];

		try {
			// Resolve all files matching the patterns
			const filesToProcess = await this.resolveFiles(
				step.files,
				context.projectRoot,
			);
			this.debug('Found %d files to process', filesToProcess.length);

			if (filesToProcess.length === 0) {
				this.logger.warn('No files found matching the specified patterns');
			}

			// Process each file
			for (const filePath of filesToProcess) {
				try {
					const result = await this.transformFile(
						filePath,
						step,
						context,
						options,
					);
					transformationResults.push(result);

					if (result.modified) {
						filesModified.push(filePath);
					}

					allErrors.push(...result.errors);
					allWarnings.push(...result.warnings);
				} catch (error) {
					const errorMessage =
						error instanceof Error ? error.message : String(error);
					this.debug('Failed to transform file %s: %s', filePath, errorMessage);
					allErrors.push(`Failed to transform ${filePath}: ${errorMessage}`);
				}
			}

			const endTime = new Date();
			const duration = endTime.getTime() - startTime.getTime();

			// Update resource metadata
			const backupResource = this.resources.get('backup-files');
			if (backupResource) {
				backupResource.metadata.backupCount = this.backupFiles.size;
			}

			// Create tool-specific result
			const codemodResult: CodeModExecutionResult = {
				codemodName: step.codemod,
				codemodPath: step.codemod, // Could be enhanced to support external codemods
				filesProcessed: filesToProcess,
				transformationsSummary: {
					totalFiles: filesToProcess.length,
					modifiedFiles: filesModified.length,
					errors: allErrors.length,
				},
				backupFiles: Array.from(this.backupFiles),
			};

			const stepResult: StepResult = {
				status: allErrors.length > 0 ? 'failed' : 'completed',
				stepName: step.name,
				toolType: 'codemod',
				startTime,
				endTime,
				duration,
				retryCount: 0,
				dependenciesSatisfied: true,
				toolResult: codemodResult,
				filesCreated: [], // CodeMods typically don't create new files
				filesModified,
				filesDeleted: [], // CodeMods typically don't delete files
				output: {
					codemodType: step.codemod,
					totalFiles: filesToProcess.length,
					modifiedFiles: filesModified.length,
					backupsCreated: this.backupFiles.size,
					transformations: transformationResults.map((r) => ({
						file: r.filePath,
						modified: r.modified,
						transformations: r.transformations,
					})),
				},
				metadata: {
					parser:
						filesToProcess.length > 0
							? this.determineParser(step.parser, filesToProcess[0])
							: step.parser || 'auto',
					backupEnabled: step.backup !== false,
					transformationResults:
						transformationResults.length > 10
							? transformationResults.slice(0, 10) // Truncate for large sets
							: transformationResults,
					cacheStats: {
						tsConfigCacheSize: this.tsConfigCache.size,
						transformationCacheSize: this.transformationCache.size,
					},
				},
			};

			// Add errors if any occurred
			if (allErrors.length > 0) {
				stepResult.error = {
					message: `CodeMod transformation failed with ${allErrors.length} errors`,
					code: 'CODEMOD_TRANSFORMATION_FAILED',
				};
			}

			return stepResult;
		} catch (error) {
			const endTime = new Date();
			const duration = endTime.getTime() - startTime.getTime();

			return {
				status: 'failed',
				stepName: step.name,
				toolType: 'codemod',
				startTime,
				endTime,
				duration,
				retryCount: 0,
				dependenciesSatisfied: true,
				filesCreated: [],
				filesModified,
				filesDeleted: [],
				error: {
					message: error instanceof Error ? error.message : String(error),
					code:
						error instanceof HypergenError
							? error.code
							: 'CODEMOD_EXECUTION_ERROR',
					stack: error instanceof Error ? error.stack : undefined,
					cause: error,
				},
				metadata: {
					codemodType: step.codemod,
					partialResults: transformationResults,
				},
			};
		}
	}

	/**
	 * Tool-specific cleanup logic
	 */
	protected async onCleanup(): Promise<void> {
		this.debug('Cleaning up CodeMod tool resources');
		// Cleanup is handled by registered resources
	}

	/**
	 * Resolve file patterns to actual file paths
	 */
	private async resolveFiles(
		patterns: string[],
		projectRoot: string,
	): Promise<string[]> {
		const allFiles = new Set<string>();

		for (const pattern of patterns) {
			const resolvedPattern = path.resolve(projectRoot, pattern);
			const matches = await this.globFiles(resolvedPattern);

			for (const file of matches) {
				allFiles.add(file);
			}
		}

		return Array.from(allFiles).sort();
	}

	/**
	 * Glob files with proper error handling
	 */
	private async globFiles(pattern: string): Promise<string[]> {
		try {
			return await glob(pattern, { absolute: true });
		} catch (error) {
			this.debug('Glob pattern failed: %s - %s', pattern, error);
			return [];
		}
	}

	/**
	 * Transform a single file
	 */
	private async transformFile(
		filePath: string,
		step: CodeModStep,
		context: StepContext,
		options?: StepExecutionOptions,
	): Promise<FileTransformationResult> {
		this.debug('Transforming file: %s', filePath);

		const originalContent = await fs.readFile(filePath, 'utf8');
		const parser = this.determineParser(step.parser, filePath);
		const isDryRun = options?.dryRun || context.dryRun || false;
		let transformedContent = originalContent;
		let modified = false;
		const errors: string[] = [];
		const warnings: string[] = [];
		const transformations: FileTransformationResult['transformations'] = [];

		try {
			// Create transformation context
			const transformContext: CodeModContext = {
				filePath,
				sourceCode: originalContent,
				stepContext: context,
				parameters: (step.parameters || {}) as CodeModParameters,
				dryRun: isDryRun,
				force: step.force || context.force || false,
			};

			// Apply transformation based on parser type and CodeMod type
			if (parser === 'typescript' || parser === 'javascript') {
				const result = await this.applyASTTransformation(
					transformContext,
					step,
					parser,
				);
				transformedContent = result.content;
				modified = result.modified;
				transformations.push(...result.transformations);
			} else {
				const result = await this.applyTextTransformation(
					transformContext,
					step,
				);
				transformedContent = result.content;
				modified = result.modified;
				transformations.push(...result.transformations);
			}

			// Create backup if file was modified and backup is enabled
			let backupPath: string | undefined;
			if (modified && !isDryRun && step.backup !== false) {
				backupPath = await this.createBackup(filePath, originalContent);
			}

			// Write transformed content if not dry run
			if (modified && !isDryRun) {
				await fs.writeFile(filePath, transformedContent, 'utf8');
				this.debug('File transformed successfully: %s', filePath);
			} else if (modified && isDryRun) {
				this.debug('Dry run: would transform file %s', filePath);
			}

			return {
				filePath,
				modified,
				originalContent,
				transformedContent,
				backupPath,
				errors,
				warnings,
				transformations,
			};
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			errors.push(`Transformation failed: ${errorMessage}`);

			return {
				filePath,
				modified: false,
				originalContent,
				transformedContent: originalContent,
				errors,
				warnings,
				transformations,
			};
		}
	}

	/**
	 * Apply AST-based transformation for TypeScript/JavaScript files
	 */
	private async applyASTTransformation(
		context: CodeModContext,
		step: CodeModStep,
		parser: 'typescript' | 'javascript',
	): Promise<{
		content: string;
		modified: boolean;
		transformations: Array<any>;
	}> {
		const transformations: Array<any> = [];

		try {
			// Parse source file
			const sourceFile = ts.createSourceFile(
				context.filePath,
				context.sourceCode,
				parser === 'typescript'
					? ts.ScriptTarget.Latest
					: ts.ScriptTarget.ES2015,
				true,
				parser === 'typescript' ? ts.ScriptKind.TS : ts.ScriptKind.JS,
			);

			// Check for basic syntax errors
			if (step.codemodConfig?.validation?.validateSyntax !== false) {
				// Simple check for obvious syntax errors like unmatched braces
				const openBraces = (context.sourceCode.match(/\{/g) || []).length;
				const closeBraces = (context.sourceCode.match(/\}/g) || []).length;
				if (openBraces !== closeBraces) {
					throw new Error('Unmatched braces detected in source code');
				}

				// Check for basic TypeScript/JavaScript syntax issues
				if (
					context.sourceCode.includes('{{{') ||
					context.sourceCode.includes('}}}')
				) {
					throw new Error('Invalid brace syntax detected');
				}
			}

			context.sourceFile = sourceFile;
			let transformedFile = sourceFile;

			// Apply built-in transformations
			switch (step.codemod) {
				case 'add-import':
					transformedFile = CodeModTransformations.addImport(
						transformedFile,
						context.parameters,
					);
					transformations.push({
						type: 'add-import',
						description: `Added import ${context.parameters.import} from ${context.parameters.from}`,
						line: 1,
					});
					break;

				case 'add-export':
					transformedFile = CodeModTransformations.addExport(
						transformedFile,
						context.parameters,
					);
					transformations.push({
						type: 'add-export',
						description: `Added export ${context.parameters.export}`,
						line: transformedFile.statements.length,
					});
					break;

				case 'add-property':
					transformedFile = CodeModTransformations.addProperty(
						transformedFile,
						context.parameters,
					);
					transformations.push({
						type: 'add-property',
						description: `Added property ${context.parameters.propertyName} to ${context.parameters.className || context.parameters.objectName}`,
					});
					break;

				case 'custom':
					if (typeof context.parameters.transformFunction === 'function') {
						transformedFile = context.parameters.transformFunction(
							transformedFile,
							context,
						);
						transformations.push({
							type: 'custom',
							description: 'Applied custom transformation function',
						});
					} else if (typeof context.parameters.transformFunction === 'string') {
						// Execute custom transformation function from string (with safety considerations)
						transformations.push({
							type: 'custom',
							description:
								'Custom transformation function not executed (string functions not supported for security)',
						});
						this.logger.warn(
							'String-based custom transformation functions are not supported for security reasons',
						);
					}
					break;

				default:
					throw new Error(
						`Unsupported AST transformation type: ${step.codemod}`,
					);
			}

			// Generate transformed content
			const printer = ts.createPrinter({
				newLine: ts.NewLineKind.LineFeed,
				removeComments: !step.codemodConfig?.transform?.includeComments,
			});

			const transformedContent = printer.printFile(transformedFile);
			const modified = transformedContent !== context.sourceCode;

			return {
				content: transformedContent,
				modified,
				transformations,
			};
		} catch (error) {
			throw ErrorHandler.createError(
				ErrorCode.CODEMOD_TRANSFORMATION_FAILED,
				`AST transformation failed: ${error instanceof Error ? error.message : String(error)}`,
				{
					filePath: context.filePath,
					codemodType: step.codemod,
					parser,
					cause: error,
				},
			);
		}
	}

	/**
	 * Apply text-based transformation for non-TypeScript files
	 */
	private async applyTextTransformation(
		context: CodeModContext,
		step: CodeModStep,
	): Promise<{
		content: string;
		modified: boolean;
		transformations: Array<any>;
	}> {
		const transformations: Array<any> = [];
		let transformedContent = context.sourceCode;

		try {
			switch (step.codemod) {
				case 'replace-text': {
					const originalContent = transformedContent;
					transformedContent = CodeModTransformations.replaceText(
						transformedContent,
						context.parameters,
					);

					if (transformedContent !== originalContent) {
						transformations.push({
							type: 'replace-text',
							description: `Replaced "${context.parameters.find}" with "${context.parameters.replace}"`,
						});
					}
					break;
				}

				default:
					throw new Error(
						`Unsupported text transformation type: ${step.codemod}`,
					);
			}

			return {
				content: transformedContent,
				modified: transformedContent !== context.sourceCode,
				transformations,
			};
		} catch (error) {
			throw ErrorHandler.createError(
				ErrorCode.CODEMOD_TRANSFORMATION_FAILED,
				`Text transformation failed: ${error instanceof Error ? error.message : String(error)}`,
				{
					filePath: context.filePath,
					codemodType: step.codemod,
					cause: error,
				},
			);
		}
	}

	/**
	 * Determine parser to use for file
	 */
	private determineParser(
		specifiedParser: string | undefined,
		filePath: string,
	): 'typescript' | 'javascript' | 'json' | 'text' {
		if (specifiedParser && specifiedParser !== 'auto') {
			return specifiedParser as 'typescript' | 'javascript' | 'json' | 'text';
		}

		const ext = path.extname(filePath).toLowerCase();

		switch (ext) {
			case '.ts':
			case '.tsx':
				return 'typescript';
			case '.js':
			case '.jsx':
			case '.mjs':
				return 'javascript';
			case '.json':
				return 'json';
			default:
				return 'text';
		}
	}

	/**
	 * Create backup of file before transformation
	 */
	private async createBackup(
		filePath: string,
		content: string,
	): Promise<string> {
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
		const backupPath = `${filePath}.backup.${timestamp}`;

		await fs.writeFile(backupPath, content, 'utf8');
		this.backupFiles.add(backupPath);

		this.debug('Created backup: %s', backupPath);
		return backupPath;
	}
}

/**
 * CodeMod Tool Factory
 */
export class CodeModToolFactory {
	create(
		name = 'codemod-tool',
		options: Record<string, any> = {},
	): CodeModTool {
		return new CodeModTool(name, options);
	}

	getToolType(): 'codemod' {
		return 'codemod';
	}

	validateConfig(config: Record<string, any>): ToolValidationResult {
		const errors: string[] = [];
		const warnings: string[] = [];
		const suggestions: string[] = [];

		// Validate backup cleanup setting
		if (
			config.cleanupBackups !== undefined &&
			typeof config.cleanupBackups !== 'boolean'
		) {
			warnings.push('cleanupBackups should be a boolean');
		}

		// Validate cache settings
		if (
			config.enableCaching !== undefined &&
			typeof config.enableCaching !== 'boolean'
		) {
			warnings.push('enableCaching should be a boolean');
		}

		// Performance suggestions
		if (!config.enableCaching) {
			suggestions.push(
				'Consider enabling caching for better performance with repeated transformations',
			);
		}

		if (config.cleanupBackups === undefined) {
			suggestions.push(
				'Consider setting cleanupBackups to control backup file cleanup behavior',
			);
		}

		return {
			isValid: errors.length === 0,
			errors,
			warnings,
			suggestions,
		};
	}
}

// Export default instance
export const codemodToolFactory = new CodeModToolFactory();
