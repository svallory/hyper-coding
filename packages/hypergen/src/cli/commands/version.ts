// src/cli/commands/version.ts

import fs from 'node:fs';
import path from 'node:path';
import type { RunnerConfig } from '../../types.js';

export class VersionCommand {
	private config: RunnerConfig;

	constructor(config: RunnerConfig) {
		this.config = config;
	}

	/**
	 * Show version information
	 */
	async execute(): Promise<{ success: boolean; message?: string }> {
		// Read version from Hypergen's package.json
		try {
			// Get the path to hypergen's package.json (not the user's project)
			const hypergenRoot = path.resolve(__dirname, '../../..');
			const packageJsonPath = path.join(hypergenRoot, 'package.json');
			const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
			const message = `
🚀 Hypergen ${packageJson.version}

The modern, scalable code generator
Built with TypeScript and powered by decorators

Website: https://hypergen.dev
Repository: ${packageJson.repository?.url || 'https://github.com/svallory/hypergen'}
`;
			return { success: true, message };
		} catch (error: any) {
			return {
				success: true,
				message:
					'🚀 Hypergen (version unknown)\n\nThe modern, scalable code generator',
			};
		}
	}
}
