// src/cli/commands/template.ts

import { TemplateParser } from '../../config/template-parser.js';
import { ErrorCode, ErrorHandler } from '../../errors/hypergen-errors.js';

export class TemplateCommand {
	/**
	 * Handle template-related commands
	 * Usage: hypergen template <subcommand> [args...]
	 */
	async execute(
		args: string[],
	): Promise<{ success: boolean; message?: string }> {
		const [subcommand, ...subArgs] = args;

		switch (subcommand) {
			case 'validate':
				return this.validateTemplate(subArgs);

			case 'info':
				return this.showTemplateInfo(subArgs);

			case 'list':
				return this.listTemplates(subArgs);

			case 'examples':
				return this.showTemplateExamples(subArgs);

			default:
				return {
					success: false,
					message:
						'Template subcommand required. Available: validate, info, list, examples',
				};
		}
	}

	/**
	 * Validate a template.yml file
	 */
	private async validateTemplate(
		args: string[],
	): Promise<{ success: boolean; message?: string }> {
		const [templatePath] = args;

		if (!templatePath) {
			const error = ErrorHandler.createError(
				ErrorCode.TEMPLATE_INVALID_SYNTAX,
				'Template path required',
				{},
				[
					{
						title: 'Provide template path',
						description: 'Specify the path to the template.yml file',
						command: 'hypergen template validate <path>',
					},
					{
						title: 'List available templates',
						description: 'See all available templates',
						command: 'hypergen template list',
					},
				],
			);
			return {
				success: false,
				message: ErrorHandler.formatError(error),
			};
		}

		try {
			const result = await TemplateParser.parseTemplateFile(templatePath);

			if (result.isValid) {
				let message = `✅ Template validation successful: ${result.config.name}\n`;
				message += `Description: ${
					result.config.description || 'No description'
				}\n`;
				message += `Version: ${result.config.version || 'No version'}\n`;
				message += `Variables: ${
					Object.keys(result.config.variables).length
				}\n`;
				message += `Examples: ${result.config.examples?.length || 0}\n`;

				if (result.warnings.length > 0) {
					message += '\n⚠️  Warnings:\n';
					for (const warning of result.warnings) {
						message += `  • ${warning}\n`;
					}
				}
				return { success: true, message };
			}
			const error = ErrorHandler.createError(
				ErrorCode.TEMPLATE_INVALID_SYNTAX,
				'Template validation failed',
				{ file: templatePath },
				[
					{
						title: 'Fix template errors',
						description: 'Review and fix the validation errors listed above',
					},
					{
						title: 'Check template syntax',
						description: 'Verify the YAML syntax is correct',
						url: 'https://hypergen.dev/docs/template-syntax',
					},
					{
						title: 'See template examples',
						description: 'Look at working template examples',
						command: 'hypergen recipe list examples/recipes',
					},
				],
			);

			let message = `${ErrorHandler.formatError(error)}\n\n`;
			message += 'Validation errors:\n';
			for (const error of result.errors) {
				message += `  • ${error}\n`;
			}
			if (result.warnings.length > 0) {
				message += '\nWarnings:\n';
				for (const warning of result.warnings) {
					message += `  • ${warning}\n`;
				}
			}
			return { success: false, message };
		} catch (error: any) {
			const hypergenError = ErrorHandler.createError(
				ErrorCode.TEMPLATE_NOT_FOUND,
				error.message || 'Failed to validate template',
				{ file: templatePath },
			);
			return {
				success: false,
				message: ErrorHandler.formatError(hypergenError),
			};
		}
	}

	/**
	 * Show template information
	 */
	private async showTemplateInfo(
		args: string[],
	): Promise<{ success: boolean; message?: string }> {
		const [templatePath] = args;

		if (!templatePath) {
			return {
				success: false,
				message: 'Template path required. Usage: hypergen template info <path>',
			};
		}

		try {
			const result = await TemplateParser.parseTemplateFile(templatePath);

			if (!result.isValid) {
				return {
					success: false,
					message: `❌ Template file is invalid. Use 'hypergen template validate' to see errors.`,
				};
			}

			const config = result.config;
			let message = `📋 Template: ${config.name}\n`;

			if (config.description) {
				message += `Description: ${config.description}\n`;
			}

			if (config.version) {
				message += `Version: ${config.version}\n`;
			}

			if (config.author) {
				message += `Author: ${config.author}\n`;
			}

			if (config.category) {
				message += `Category: ${config.category}\n`;
			}

			if (config.tags?.length) {
				message += `Tags: ${config.tags.join(', ')}\n`;
			}

			message += `\nVariables (${Object.keys(config.variables).length}):\n`;

			for (const [varName, varConfig] of Object.entries(config.variables)) {
				message += `  • ${varName} (${varConfig.type})`;

				if (varConfig.required) {
					message += ' *required*';
				}

				if (varConfig.default !== undefined) {
					message += ` [default: ${varConfig.default}]`;
				}

				if (varConfig.description) {
					message += ` - ${varConfig.description}`;
				}

				message += '\n';
			}

			if (config.examples?.length) {
				message += `\nExamples (${config.examples.length}):\n`;

				for (const example of config.examples) {
					message += `  • ${example.title}\n`;

					if (example.description) {
						message += `    ${example.description}\n`;
					}

					message += `    Variables: ${Object.keys(example.variables).join(
						', ',
					)}\n`;
				}
			}

			return { success: true, message };
		} catch (error: any) {
			return {
				success: false,
				message: `❌ Failed to read template: ${error.message}`,
			};
		}
	}

	/**
	 * List templates in directory
	 */
	private async listTemplates(
		args: string[],
	): Promise<{ success: boolean; message?: string }> {
		const [directory] = args;
		const templatesDir = directory || 'recipes';

		try {
			const templates =
				await TemplateParser.parseTemplateDirectory(templatesDir);

			if (templates.length === 0) {
				return {
					success: true,
					message: `📝 No templates found in ${templatesDir}`,
				};
			}

			let message = `📝 Templates found in ${templatesDir} (${templates.length}):\n`;

			for (const template of templates) {
				message += `  • ${template.config.name || 'Unknown'}`;

				if (template.config.description) {
					message += ` - ${template.config.description}`;
				}

				if (!template.isValid) {
					message += ' ❌ (invalid)';
				}

				message += '\n';
			}

			const invalidCount = templates.filter((t) => !t.isValid).length;
			if (invalidCount > 0) {
				message += `\n⚠️  ${invalidCount} template(s) have validation errors. Use 'hypergen template validate' to check.`;
			}

			return { success: true, message };
		} catch (error: any) {
			return {
				success: false,
				message: `❌ Failed to list templates: ${error.message}`,
			};
		}
	}

	/**
	 * Show template examples
	 */
	private async showTemplateExamples(
		args: string[],
	): Promise<{ success: boolean; message?: string }> {
		const [templatePath] = args;

		if (!templatePath) {
			return {
				success: false,
				message:
					'Template path required. Usage: hypergen template examples <path>',
			};
		}

		try {
			const result = await TemplateParser.parseTemplateFile(templatePath);

			if (!result.isValid) {
				return {
					success: false,
					message: `❌ Template file is invalid. Use 'hypergen template validate' to see errors.`,
				};
			}

			const config = result.config;

			if (!config.examples?.length) {
				return {
					success: true,
					message: `📝 No examples found for template: ${config.name}`,
				};
			}

			let message = `📝 Examples for template: ${config.name}\n`;

			for (const [index, example] of config.examples.entries()) {
				message += `\n${index + 1}. ${example.title}\n`;

				if (example.description) {
					message += `   ${example.description}\n`;
				}

				message += `   hypergen action ${config.name}`;

				for (const [key, value] of Object.entries(example.variables)) {
					message += ` --${key}=${JSON.stringify(value)}`;
				}

				message += '\n';
			}

			return { success: true, message };
		} catch (error: any) {
			return {
				success: false,
				message: `❌ Failed to show examples: ${error.message}`,
			};
		}
	}
}
