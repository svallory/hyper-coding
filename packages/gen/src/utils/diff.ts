import disparity from "disparity";

/**
 * Generate a colored unified diff between two strings.
 */
export function formatDiff(
	oldContent: string,
	newContent: string,
	options?: { oldLabel?: string; newLabel?: string },
): string {
	return disparity.unified(oldContent, newContent, {
		paths: [options?.oldLabel ?? "existing", options?.newLabel ?? "incoming"],
	});
}
