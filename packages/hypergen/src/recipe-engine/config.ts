import * as path from 'node:path';
import type { RecipeEngineConfig } from './recipe-engine.js';

/**
 * Default recipe engine configuration
 */
export const DEFAULT_CONFIG: Required<RecipeEngineConfig> = {
	stepExecutor: {
		maxConcurrency: 10,
		defaultTimeout: 30000,
		defaultRetries: 3,
		continueOnError: false,
		enableParallelExecution: true,
		collectMetrics: true,
		enableProgressTracking: true,
		memoryWarningThreshold: 1024,
		timeoutSafetyFactor: 1.2,
	},
	toolRegistry: {
		maxCacheSize: 100,
		cacheTimeoutMs: 30 * 60 * 1000,
		enableInstanceReuse: true,
	},
	workingDir: process.cwd(),
	defaultTimeout: 60000,
	enableDebugLogging: false,
	cache: {
		enabled: true,
		directory: path.join(process.cwd(), '.hypergen', 'cache'),
		ttl: 3600000, // 1 hour
	},
	security: {
		allowExternalSources: true,
		trustedSources: [],
		validateSignatures: false,
	},
};
