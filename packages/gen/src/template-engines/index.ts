/**
 * Template Engines Module
 *
 * Jig (@jig-lang/jig) is the sole template engine for Hypergen.
 * No factory pattern, no plugin system — just Jig.
 */

export {
	initializeJig,
	getJig,
	renderTemplate,
	renderTemplateSync,
	renderFile,
	mountDirectory,
	type JigConfig,
} from "./jig-engine.js";
