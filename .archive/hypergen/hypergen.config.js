/**
 * Hypergen Configuration
 *
 * @type {import('hypergen').HypergenConfig}
 */
export default {
	// Template directories to search
	templates: ["templates"],

	// Generator discovery options
	discovery: {
		sources: ["local", "npm", "workspace"],
		directories: ["templates", "generators"],
		exclude: ["node_modules", ".git", "dist", "build"],
	},

	// Template engine configuration
	engine: {
		type: "liquid",
		options: {},
	},

	// Output handling
	output: {
		conflictStrategy: "fail", // fail | overwrite | skip | merge
		createDirectories: true,
		preserveTimestamps: false,
	},

	// Validation options
	validation: {
		strict: true,
		validateTemplates: true,
		validateVariables: true,
	},

	// Cache configuration
	cache: {
		enabled: true,
		directory: ".hypergen-cache",
		ttl: 3600000, // 1 hour in milliseconds
	},

	// Plugins to load
	plugins: [],

	// Custom helper functions
	helpers: {},

	// Environment-specific configuration
	environments: {
		development: {
			validation: {
				strict: false,
			},
		},
		production: {
			cache: {
				enabled: true,
				ttl: 86400000, // 24 hours
			},
		},
	},
};
