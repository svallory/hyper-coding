/**
 * Template Engines Module
 *
 * Jig (@jig-lang/jig) is the sole template engine for Hypergen.
 * No factory pattern, no plugin system — just Jig.
 */

export {
	getJig,
	initializeJig,
	type JigConfig,
	mountDirectory,
	renderFile,
	renderTemplate,
	renderTemplateSync,
} from "./jig-engine.js";
