/**
 * Shared manifest fixtures for testing
 */

import type { KitManifest, KitManifestEntry } from "#manifest";

export const EMPTY_MANIFEST: KitManifest = {
	version: "1.0.0",
	kits: {},
};

export const SAMPLE_KIT_ENTRY: KitManifestEntry = {
	name: "nextjs",
	source: "github:hypergen/nextjs-kit",
	type: "github",
	installedAt: "2026-02-10T14:30:00.000Z",
	version: "1.2.0",
	branch: "main",
};

export const SAMPLE_KIT_ENTRY_WITH_TAG: KitManifestEntry = {
	name: "react",
	source: "github:hypergen/react-kit@v2.0.0",
	type: "github",
	installedAt: "2026-02-11T10:00:00.000Z",
	version: "2.0.0",
	tag: "v2.0.0",
};

export const SAMPLE_KIT_ENTRY_WITH_COMMIT: KitManifestEntry = {
	name: "vue",
	source: "https://github.com/hypergen/vue-kit.git",
	type: "git",
	installedAt: "2026-02-12T08:15:00.000Z",
	version: "1.5.0",
	commit: "abc123def456789012345678901234567890abcd",
};

export const SAMPLE_KIT_ENTRY_NPM: KitManifestEntry = {
	name: "@hypergen/svelte-kit",
	source: "@hypergen/svelte-kit",
	type: "npm",
	installedAt: "2026-02-13T16:45:00.000Z",
	version: "3.1.0",
};

export const SAMPLE_KIT_ENTRY_JSR: KitManifestEntry = {
	name: "jsr-std-kit",
	source: "jsr:@std/path",
	type: "jsr",
	installedAt: "2026-02-14T09:20:00.000Z",
	version: "0.224.0",
};

export const POPULATED_MANIFEST: KitManifest = {
	version: "1.0.0",
	kits: {
		nextjs: SAMPLE_KIT_ENTRY,
		react: SAMPLE_KIT_ENTRY_WITH_TAG,
		vue: SAMPLE_KIT_ENTRY_WITH_COMMIT,
	},
};

export const FULL_MANIFEST: KitManifest = {
	version: "1.0.0",
	kits: {
		nextjs: SAMPLE_KIT_ENTRY,
		react: SAMPLE_KIT_ENTRY_WITH_TAG,
		vue: SAMPLE_KIT_ENTRY_WITH_COMMIT,
		"@hypergen/svelte-kit": SAMPLE_KIT_ENTRY_NPM,
		"jsr-std-kit": SAMPLE_KIT_ENTRY_JSR,
	},
};

export const CORRUPTED_JSON_STRING = '{"version": "1.0.0", "kits": {broken';

export const INVALID_MANIFEST_NO_VERSION = {
	kits: {},
};

export const INVALID_MANIFEST_NO_KITS = {
	version: "1.0.0",
};
