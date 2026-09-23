/**
 * AI Transport Module
 *
 * Pluggable transport layer for resolving @ai blocks during 2-pass generation.
 */

export { ApiTransport } from "./api-transport.js";
export { CommandTransport } from "./command-transport.js";
export { resolveTransport } from "./resolve-transport.js";
export { StdoutTransport } from "./stdout-transport.js";
export type {
	AiTransport,
	TransportContext,
	TransportResult,
} from "./types.js";
