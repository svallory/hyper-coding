import { homedir } from "node:os";
import { resolve } from "node:path";

export const HQ_DATA_DIR = resolve(homedir(), ".config/hyper");
export const LOG_DIR = resolve(HQ_DATA_DIR, "logs");

export function expandHome(p: string): string {
	if (p.startsWith("~/")) return resolve(homedir(), p.slice(2));
	return p;
}
