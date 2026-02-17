import type { Config } from "@oclif/core";
import { describe, expect, it } from "vitest";
import bashScript from "#autocomplete/completions/bash";
import PowerShellComp from "#autocomplete/completions/powershell";
import ZshCompWithSpaces from "#autocomplete/completions/zsh";

/**
 * Smoke tests for shell completion script generators.
 * Verifies that generated scripts contain expected shell-specific markers.
 */

// Minimal mock config for testing script generation
const mockConfig = {
	bin: "hyper",
	binAliases: [],
	shell: "zsh",
	cacheDir: "/tmp/hyper-test",
	topics: [],
	getPluginsList: () => [],
} as unknown as Config;

describe("Bash completion script", () => {
	it("contains the autocomplete function", () => {
		expect(bashScript).toContain("_<CLI_BIN>_autocomplete");
	});

	it("contains complete -F registration", () => {
		expect(bashScript).toContain("complete -F");
	});

	it("contains template placeholders", () => {
		expect(bashScript).toContain("<CLI_BIN>");
		expect(bashScript).toContain("<BASH_COMMANDS_WITH_FLAGS_LIST>");
	});
});

describe("Zsh completion script", () => {
	it("starts with #compdef", () => {
		const zsh = new ZshCompWithSpaces(mockConfig);
		const output = zsh.generate();
		expect(output).toMatch(/^#compdef /);
	});

	it("contains the dynamic completion helper", () => {
		const zsh = new ZshCompWithSpaces(mockConfig);
		const output = zsh.generate();
		expect(output).toContain("_hyper_dynamic");
	});

	it("contains the main completion function", () => {
		const zsh = new ZshCompWithSpaces(mockConfig);
		const output = zsh.generate();
		expect(output).toContain("_hyper()");
	});
});

describe("PowerShell completion script", () => {
	it("contains Register-ArgumentCompleter", () => {
		const ps = new PowerShellComp(mockConfig);
		const output = ps.generate();
		expect(output).toContain("Register-ArgumentCompleter");
	});

	it("contains $scriptblock", () => {
		const ps = new PowerShellComp(mockConfig);
		const output = ps.generate();
		expect(output).toContain("$scriptblock");
	});

	it("uses the correct CLI bin name", () => {
		const ps = new PowerShellComp(mockConfig);
		const output = ps.generate();
		expect(output).toContain("hyper autocomplete generate");
	});
});
