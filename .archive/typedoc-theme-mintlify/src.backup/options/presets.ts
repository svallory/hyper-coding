export const presets = {
	// Hide private, internal, and non-exported items by default for cleaner SDK docs
	excludePrivate: true,
	excludeProtected: false, // Keep protected members as they're part of the public API
	excludeInternal: true,
	excludeExternals: true,
	excludeNotDocumented: false, // Keep undocumented items but we could make this configurable

	// Additional cleanup options
	excludeReferences: false, // Keep re-exports as they're useful in SDK docs

	// Better organization
	categorizeByGroup: false,
	sort: ["source-order"], // Preserve source order by default
};
