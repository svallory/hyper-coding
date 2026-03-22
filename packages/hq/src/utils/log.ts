export function log(message: string): void {
	const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
	console.log(`[${ts}] ${message}`);
}
