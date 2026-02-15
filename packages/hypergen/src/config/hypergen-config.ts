/**
 * Hypergen Configuration System
 *
 * Provides configuration loading and management for hypergen projects
 */

import fs from "fs";
import path from "path";
import { cosmiconfig } from "cosmiconfig";
import { ErrorHandler, ErrorCode } from "#/errors/hypergen-errors";
import { DEFAULT_TEMPLATE_DIRECTORY } from "#/constants";
import { loadHelpers } from "#/load-helpers.js";
import { registerHelpers } from "#/template-engines/jig-engine";
import type { AiServiceConfig } from "#/ai/ai-config";

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

	// Cache options
	cache?: {
		enabled?: boolean;
		directory?: string;
		ttl?: number;
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
	cache: {
		enabled?: boolean;
		directory?: string;
		ttl?: number;
	};
	plugins: string[];
	helpers: string | Record<string, Function>;
	ai?: AiServiceConfig;
	environments: Record<string, Partial<HypergenConfig>>;
}

export class HypergenConfigLoader {
	private static readonly CONFIG_FILES = [
		"hypergen.config.js",
		"hypergen.config.mjs",
		"hypergen.config.cjs",
		"hypergen.config.json",
	];

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
		cache: {
			enabled: true,
			directory: ".hypergen-cache",
			ttl: 3600000, // 1 hour
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
	): Promise<ResolvedConfig> {
		let config: HypergenConfig = {};
		let actualConfigPath: string | null = null;

		try {
			const explorer = cosmiconfig("hypergen", {
				searchPlaces: [
					"hypergen.config.js",
					"hypergen.config.mjs",
					"hypergen.config.cjs",
					"hypergen.config.json",
					".hypergenrc",
					".hypergenrc.json",
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
			const mergedConfig = this.mergeConfig(this.DEFAULT_CONFIG, config);

			// Apply environment-specific settings
			if (mergedConfig.environments && mergedConfig.environments[environment]) {
				const envConfig = mergedConfig.environments[environment];
				Object.assign(mergedConfig, this.mergeConfig(mergedConfig, envConfig));
			}

			// Load helpers and register as Jig globals
			const loadedHelpers = await loadHelpers(mergedConfig.helpers, projectRoot);
			if (Object.keys(loadedHelpers).length > 0) {
				registerHelpers(loadedHelpers, "config:hypergen.config");
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

			// Resolve cache directory relative to config file directory
			if (resolvedConfig.cache.directory && !path.isAbsolute(resolvedConfig.cache.directory)) {
				resolvedConfig.cache.directory = path.resolve(configDir, resolvedConfig.cache.directory);
			}

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
			return JSON.stringify(this.DEFAULT_CONFIG, null, 2);
		}

		return `/**
 * Hypergen Configuration
 * 
 * @type {import('hypergen').HypergenConfig}
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
  
  // Cache configuration
  cache: {
    enabled: true,
    directory: '.hypergen-cache',
    ttl: 3600000 // 1 hour in milliseconds
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
    },
    production: {
      cache: {
        enabled: true,
        ttl: 86400000 // 24 hours
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
	const fileName = format === "json" ? "hypergen.config.json" : "hypergen.config.js";
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
 * Get configuration information
 */
export function getConfigInfo(config: ResolvedConfig): {
	source: string;
	templates: string[];
	environment: string;
	cacheEnabled: boolean;
	pluginCount: number;
	helperCount: number;
} {
	return {
		source: config.configPath,
		templates: config.templates,
		environment: config.environment,
		cacheEnabled: config.cache.enabled,
		pluginCount: config.plugins.length,
		helperCount: Object.keys(config.loadedHelpers).length,
	};
}
