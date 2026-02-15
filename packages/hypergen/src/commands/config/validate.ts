/**
 * Config Validate command - Validate configuration file
 */

import { Args } from "@oclif/core";
import { existsSync } from "fs";
import { resolve } from "path";
import { BaseCommand } from "#/lib/base-command";
import { outputFlags, validationFlags } from "#/lib/flags";
import { HypergenConfigLoader } from "#/config/hypergen-config";

export default class ConfigValidate extends BaseCommand<typeof ConfigValidate> {
	static description = "Validate a hypergen configuration file";

	static examples = [
		"<%= config.bin %> <%= command.id %>",
		"<%= config.bin %> <%= command.id %> hypergen.config.js",
		"<%= config.bin %> <%= command.id %> --strict",
	];

	static flags = {
		...outputFlags,
		...validationFlags,
	};

	static args = {
		path: Args.string({
			description: "Path to configuration file",
			required: false,
		}),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(ConfigValidate);

		let configPath = args.path;

		// If no path provided, search for config files
		if (!configPath) {
			const configFiles = [
				"hypergen.config.js",
				"hypergen.config.mjs",
				"hypergen.config.ts",
				".hypergenrc.js",
				".hypergenrc.json",
			];

			for (const file of configFiles) {
				const path = resolve(flags.cwd, file);
				if (existsSync(path)) {
					configPath = path;
					break;
				}
			}
		}

		if (!configPath) {
			if (flags.json) {
				this.log(
					JSON.stringify(
						{
							valid: false,
							error: "No configuration file found",
						},
						null,
						2,
					),
				);
				this.exit(1);
			}
			this.error('No configuration file found. Create one with "hypergen config init"');
		}

		configPath = resolve(flags.cwd, configPath);

		if (!existsSync(configPath)) {
			if (flags.json) {
				this.log(
					JSON.stringify(
						{
							valid: false,
							error: `Configuration file not found: ${configPath}`,
						},
						null,
						2,
					),
				);
				this.exit(1);
			}
			this.error(`Configuration file not found: ${configPath}`);
		}

		const errors: string[] = [];
		const warnings: string[] = [];

		try {
			const result = await HypergenConfigLoader.loadConfig(configPath, flags.cwd);

			if (!result) {
				errors.push("Failed to load configuration");
			} else {
				// Validate required fields
				const templatesArray = result.templates || [];
				if (templatesArray.length === 0) {
					warnings.push("No templates directory specified");
				} else {
					for (const templateDir of templatesArray) {
						const templatesPath = resolve(flags.cwd, templateDir);
						if (!existsSync(templatesPath)) {
							warnings.push(`Templates directory does not exist: ${templatesPath}`);
						}
					}
				}

				// Strict mode validations
				if (flags.strict) {
					if (!result.templates || result.templates.length === 0) {
						errors.push("templates field is required in strict mode");
					}
				}
			}

			const valid = errors.length === 0;

			if (flags.json) {
				this.log(
					JSON.stringify(
						{
							valid,
							path: configPath,
							errors: errors.length > 0 ? errors : undefined,
							warnings: warnings.length > 0 ? warnings : undefined,
							config: result,
						},
						null,
						2,
					),
				);
				if (!valid) this.exit(1);
				return;
			}

			if (valid) {
				this.log(`Configuration is valid: ${configPath}`);

				if (warnings.length > 0) {
					this.log("");
					this.log("Warnings:");
					for (const warning of warnings) {
						this.log(`  ⚠ ${warning}`);
					}
				}
			} else {
				this.log(`Configuration validation failed: ${configPath}`);
				this.log("");
				this.log("Errors:");
				for (const error of errors) {
					this.log(`  ✗ ${error}`);
				}

				if (warnings.length > 0) {
					this.log("");
					this.log("Warnings:");
					for (const warning of warnings) {
						this.log(`  ⚠ ${warning}`);
					}
				}

				this.exit(1);
			}
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);

			if (flags.json) {
				this.log(
					JSON.stringify(
						{
							valid: false,
							path: configPath,
							error: message,
						},
						null,
						2,
					),
				);
				this.exit(1);
			}

			this.error(`Failed to validate configuration: ${message}`);
		}
	}
}
