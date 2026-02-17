/**
 * Hypergen Configuration System
 *
 * Provides configuration loading and management for hypergen projects
 */

import fs from "node:fs";
import path from "node:path";
import { cosmiconfig } from "cosmiconfig";
import { ErrorCode, ErrorHandler } from "#errors/hypergen-errors";
import { loadHelpers } from "./load-helpers.js";

const DEFAULT_TEMPLATE_DIRECTORY = "templates";

export interface AiServiceConfig {
	provider?: "anthropic" | "openai" | "custom";
	apiKey?: string;
	model?: string;
	temperature?: number;
	maxTokens?: number;
}

export interface HypergenConfig {
	// Template directories
	templates?: string[];

	// Template discovery options
	discovery?: {
		sources?: ("local" | "npm" | "workspace" | "github" | "git")[];
		directories?: string[];
		exclude?: string[];
	};

	// Template engine options (Jig)
	engine?: {
		/** Enable template caching */
		cache?: boolean;
	};

	// Output options
	output?: {
		conflictStrategy?: "fail" | "overwrite" | "skip" | "merge";
		createDirectories?: boolean;
		preserveTimestamps?: boolean;
	};

	// Validation options
	validation?: {
		strict?: boolean;
		validateTemplates?: boolean;
		validateVariables?: boolean;
	};

	// Plugin system
	plugins?: string[];

	// Custom helpers
	helpers?: string | Record<string, Function>;

	/** AI integration configuration */
	ai?: AiServiceConfig;

	// Environment-specific settings
	environments?: Record<string, Partial<HypergenConfig>>;
}

export interface ResolvedConfig {
	// Resolved paths
	configPath: string;
	projectRoot: string;

	// Runtime environment
	environment: string;

	// Loaded helpers
	loadedHelpers: Record<string, Function>;

	// All config properties (with defaults applied)
	templates: string[];
	discovery: {
		sources?: ("local" | "npm" | "workspace" | "github" | "git")[];
		directories?: string[];
		exclude?: string[];
	};
	engine: {
		cache?: boolean;
	};
	output: {
		conflictStrategy?: "fail" | "overwrite" | "skip" | "merge";
		createDirectories?: boolean;
		preserveTimestamps?: boolean;
	};
	validation: {
		strict?: boolean;
		validateTemplates?: boolean;
		validateVariables?: boolean;
	};
	plugins: string[];
	helpers: string | Record<string, Function>;
	ai?: AiServiceConfig;
	environments: Record<string, Partial<HypergenConfig>>;
}

export interface ConfigLoaderOptions {
	/**
	 * Callback invoked when helpers are loaded from config.
	 * Allows consumers to register helpers with their template engine.
	 */
	onHelpersLoaded?: (helpers: Record<string, Function>, source: string) => void;
}

export class HypergenConfigLoader {
	private static readonly DEFAULT_CONFIG: HypergenConfig = {
		templates: [DEFAULT_TEMPLATE_DIRECTORY],
		discovery: {
			sources: ["local", "npm", "workspace"],
			directories: [DEFAULT_TEMPLATE_DIRECTORY, "cookbooks"],
			exclude: ["node_modules", ".git", "dist", "build"],
		},
		engine: {
			cache: false,
		},
		output: {
			conflictStrategy: "fail",
			createDirectories: true,
			preserveTimestamps: false,
		},
		validation: {
			strict: true,
			validateTemplates: true,
			validateVariables: true,
		},
		plugins: [],
		helpers: {},
		environments: {},
	};

	/**
	 * Load configuration from various sources using cosmiconfig
	 */
	static async loadConfig(
		configPath?: string,
		projectRoot: string = process.cwd(),
		environment: string = process.env.NODE_ENV || "development",
		options?: ConfigLoaderOptions,
	): Promise<ResolvedConfig> {
		let config: HypergenConfig = {};
		let actualConfigPath: string | null = null;

		try {
			const explorer = cosmiconfig("hyper", {
				searchPlaces: [
					"hyper.config.js",
					"hyper.config.mjs",
					"hyper.config.cjs",
					"hyper.config.json",
					".hyperrc",
					".hyperrc.json",
				],
				stopDir: path.dirname(projectRoot), // Stop searching at project root's parent
			});

			let result;

			// 1. Try explicit config path first
			if (configPath) {
				if (fs.existsSync(configPath)) {
					result = await explorer.load(configPath);
				} else {
					throw ErrorHandler.createError(
						ErrorCode.CONFIG_FILE_NOT_FOUND,
						`Configuration file not found: ${configPath}`,
						{ file: configPath },
					);
				}
			} else {
				// 2. Auto-detect using cosmiconfig (searches from projectRoot upwards)
				result = await explorer.search(projectRoot);
			}

			if (result) {
				config = result.config;
				actualConfigPath = result.filepath;
			}

			// Merge with default config
			const mergedConfig = HypergenConfigLoader.mergeConfig(
				HypergenConfigLoader.DEFAULT_CONFIG,
				config,
			);

			// Apply environment-specific settings
			if (mergedConfig.environments?.[environment]) {
				const envConfig = mergedConfig.environments[environment];
				Object.assign(mergedConfig, HypergenConfigLoader.mergeConfig(mergedConfig, envConfig));
			}

			// Load helpers and invoke callback if provided
			const loadedHelpers = await loadHelpers(mergedConfig.helpers, projectRoot);
			if (Object.keys(loadedHelpers).length > 0 && options?.onHelpersLoaded) {
				options.onHelpersLoaded(loadedHelpers, "config:hyper.config");
			}

			// Determine the base directory for resolving relative paths
			// If config was found, use its directory; otherwise use projectRoot
			const configDir = actualConfigPath ? path.dirname(actualConfigPath) : projectRoot;

			// Resolve paths
			const resolvedConfig: ResolvedConfig = {
				...mergedConfig,
				configPath: actualConfigPath || "default",
				projectRoot,
				environment,
				loadedHelpers,
			} as ResolvedConfig;

			// Resolve template paths relative to config file directory
			resolvedConfig.templates = resolvedConfig.templates.map((templatePath) => {
				if (path.isAbsolute(templatePath)) {
					return templatePath;
				}
				return path.resolve(configDir, templatePath);
			});

			return resolvedConfig;
		} catch (error: any) {
			if (error.code === "ENOENT") {
				throw ErrorHandler.createError(
					ErrorCode.CONFIG_FILE_NOT_FOUND,
					`Configuration file not found: ${error.path}`,
					{ file: error.path },
				);
			}

			if (error.name === "SyntaxError" || error.message.includes("JSON Parse error")) {
				throw ErrorHandler.createError(
					ErrorCode.CONFIG_INVALID_FORMAT,
					`Invalid configuration file syntax: ${error.message}`,
					{ file: actualConfigPath || "unknown" },
				);
			}

			throw error;
		}
	}

	/**
	 * Merge configuration objects
	 */
	private static mergeConfig(base: HypergenConfig, override: HypergenConfig): HypergenConfig {
		const merged = { ...base };

		for (const [key, value] of Object.entries(override)) {
			if (value === undefined) continue;

			if (key === "templates" && Array.isArray(value)) {
				// Replace templates instead of merging
				merged.templates = value;
			} else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
				merged[key as keyof HypergenConfig] = {
					...(merged[key as keyof HypergenConfig] as any),
					...value,
				} as any;
			} else {
				merged[key as keyof HypergenConfig] = value;
			}
		}

		return merged;
	}

	/**
	 * Validate configuration
	 */
	static validateConfig(config: HypergenConfig): {
		valid: boolean;
		errors: string[];
	} {
		const errors: string[] = [];

		// Validate templates
		if (config.templates && !Array.isArray(config.templates)) {
			errors.push("templates must be an array of strings");
		}

		// Validate discovery sources
		if (config.discovery?.sources) {
			const validSources = ["local", "npm", "workspace", "github", "git"];
			const invalidSources = config.discovery.sources.filter(
				(source) => !validSources.includes(source),
			);
			if (invalidSources.length > 0) {
				errors.push(`Invalid discovery sources: ${invalidSources.join(", ")}`);
			}
		}

		// Validate conflict strategy
		if (config.output?.conflictStrategy) {
			const validStrategies = ["fail", "overwrite", "skip", "merge"];
			if (!validStrategies.includes(config.output.conflictStrategy)) {
				errors.push(`Invalid conflict strategy: ${config.output.conflictStrategy}`);
			}
		}

		return {
			valid: errors.length === 0,
			errors,
		};
	}

	/**
	 * Generate default configuration file
	 */
	static generateDefaultConfig(format: "js" | "json" = "js"): string {
		if (format === "json") {
			return JSON.stringify(HypergenConfigLoader.DEFAULT_CONFIG, null, 2);
		}

		return `/**
 * HyperDev Configuration
 *
 * @type {import('@hypercli/core').HypergenConfig}
 */
export default {
  // Template directories to search
  templates: ['templates'],

  // Generator discovery options
  discovery: {
    sources: ['local', 'npm', 'workspace'],
    directories: ['templates', 'cookbooks'],
    exclude: ['node_modules', '.git', 'dist', 'build']
  },

  // Template engine configuration (Jig)
  engine: {
    cache: false
  },

  // Output handling
  output: {
    conflictStrategy: 'fail', // fail | overwrite | skip | merge
    createDirectories: true,
    preserveTimestamps: false
  },

  // Validation options
  validation: {
    strict: true,
    validateTemplates: true,
    validateVariables: true
  },

  // Plugins to load
  plugins: [],

  // Custom helper functions
  helpers: {},

  // Environment-specific configuration
  environments: {
    development: {
      validation: {
        strict: false
      }
    }
  }
}
`;
	}
}

/**
 * Create a new configuration file
 */
export async function createConfigFile(
	projectRoot: string,
	format: "js" | "json" = "js",
): Promise<string> {
	const fileName = format === "json" ? "hyper.config.json" : "hyper.config.js";
	const configPath = path.join(projectRoot, fileName);

	if (fs.existsSync(configPath)) {
		throw ErrorHandler.createError(
			ErrorCode.FILE_ALREADY_EXISTS,
			`Configuration file already exists: ${configPath}`,
			{ file: configPath },
		);
	}

	const content = HypergenConfigLoader.generateDefaultConfig(format);
	fs.writeFileSync(configPath, content, "utf-8");

	return configPath;
}

/**
 * Search upward from startDir for the nearest hyper config file.
 * Returns the directory containing the config, or null if none found.
 */
export async function findHyperConfigDir(startDir: string = process.cwd()): Promise<string | null> {
	const explorer = cosmiconfig("hyper", {
		searchPlaces: [
			"hyper.config.js",
			"hyper.config.mjs",
			"hyper.config.cjs",
			"hyper.config.json",
			".hyperrc",
			".hyperrc.json",
		],
	});

	const result = await explorer.search(startDir);
	return result ? path.dirname(result.filepath) : null;
}

/**
 * Get configuration information
 */
export function getConfigInfo(config: ResolvedConfig): {
	source: string;
	templates: string[];
	environment: string;
	pluginCount: number;
	helperCount: number;
} {
	return {
		source: config.configPath,
		templates: config.templates,
		environment: config.environment,
		pluginCount: config.plugins.length,
		helperCount: Object.keys(config.loadedHelpers).length,
	};
}
