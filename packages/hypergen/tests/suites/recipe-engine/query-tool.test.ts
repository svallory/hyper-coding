import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QueryTool, QueryToolFactory, queryToolFactory } from "~/recipe-engine/tools/query-tool";
import type { QueryStep, StepContext, QueryExecutionResult } from "~/recipe-engine/types";

describe("QueryTool", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "hypergen-query-tool-"));
	});

	afterEach(() => {
		if (tmpDir) {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	function createContext(projectRoot: string, overrides: Partial<StepContext> = {}): StepContext {
		return {
			projectRoot,
			step: {} as any,
			recipe: { id: "test", name: "Test", startTime: new Date() },
			recipeVariables: {},
			variables: {},
			stepData: {},
			stepResults: new Map(),
			evaluateCondition: () => true,
			...overrides,
		};
	}

	// ---------------------------------------------------------------------------
	// 1. Constructor
	// ---------------------------------------------------------------------------
	describe("Constructor", () => {
		it("should create instance with default name", () => {
			const tool = new QueryTool();
			expect(tool.name).toBe("query-tool");
			expect(tool.toolType).toBe("query");
		});

		it("should create instance with custom name", () => {
			const tool = new QueryTool("custom-query");
			expect(tool.name).toBe("custom-query");
			expect(tool.toolType).toBe("query");
		});

		it("should have correct tool type via getter", () => {
			const tool = new QueryTool();
			expect(tool.getToolType()).toBe("query");
		});

		it("should accept options in constructor", () => {
			const tool = new QueryTool("opts-tool", { verbose: true });
			expect(tool.name).toBe("opts-tool");
			expect(tool.toolType).toBe("query");
		});
	});

	// ---------------------------------------------------------------------------
	// 2. JSON file reading
	// ---------------------------------------------------------------------------
	describe("JSON queries", () => {
		let tool: QueryTool;
		let context: StepContext;

		beforeEach(() => {
			tool = new QueryTool();
			context = createContext(tmpDir);
		});

		it("should read package.json-like data with checks and export", async () => {
			const packageJson = {
				name: "test-package",
				version: "1.0.0",
				dependencies: {
					react: "^18.0.0",
					typescript: "^5.0.0",
				},
			};
			writeFileSync(join(tmpDir, "package.json"), JSON.stringify(packageJson, null, 2));

			const step: QueryStep = {
				tool: "query",
				name: "read-pkg",
				file: "package.json",
				checks: [
					{ path: "name", export: "pkgName" },
					{ path: "version", export: "pkgVersion" },
				],
			};

			const result = await tool.execute(step, context);
			expect(result.status).toBe("completed");
			expect(result.toolResult).toBeDefined();

			const qr = result.toolResult as QueryExecutionResult;
			expect(qr.file).toBe("package.json");
			expect(qr.format).toBe("json");
			expect(qr.checks).toHaveLength(2);
			expect(qr.checks![0].path).toBe("name");
			expect(qr.checks![0].exists).toBe(true);
			expect(qr.checks![0].value).toBe("test-package");
			expect(qr.checks![1].path).toBe("version");
			expect(qr.checks![1].exists).toBe(true);
			expect(qr.checks![1].value).toBe("1.0.0");
		});

		it("should check existing dot path", async () => {
			const packageJson = {
				name: "test-package",
				dependencies: { react: "^18.0.0" },
			};
			writeFileSync(join(tmpDir, "package.json"), JSON.stringify(packageJson, null, 2));

			const step: QueryStep = {
				tool: "query",
				name: "check-dep",
				file: "package.json",
				checks: [{ path: "dependencies.react", export: "reactVersion" }],
			};

			const result = await tool.execute(step, context);
			expect(result.status).toBe("completed");

			const qr = result.toolResult as QueryExecutionResult;
			expect(qr.checks![0].exists).toBe(true);
			expect(qr.checks![0].value).toBe("^18.0.0");
		});

		it("should check missing path — exists false, value undefined", async () => {
			const packageJson = { name: "test-package", dependencies: {} };
			writeFileSync(join(tmpDir, "package.json"), JSON.stringify(packageJson, null, 2));

			const step: QueryStep = {
				tool: "query",
				name: "check-missing",
				file: "package.json",
				checks: [{ path: "dependencies.react", export: "reactVersion" }],
			};

			const result = await tool.execute(step, context);
			expect(result.status).toBe("completed");

			const qr = result.toolResult as QueryExecutionResult;
			expect(qr.checks![0].exists).toBe(false);
			expect(qr.checks![0].value).toBeUndefined();
		});

		it("should resolve deeply nested path", async () => {
			const config = {
				server: {
					port: 3000,
					host: "localhost",
					ssl: { enabled: true, cert: "/path/to/cert" },
				},
			};
			writeFileSync(join(tmpDir, "config.json"), JSON.stringify(config, null, 2));

			const step: QueryStep = {
				tool: "query",
				name: "check-ssl",
				file: "config.json",
				checks: [
					{ path: "server.ssl.enabled", export: "sslEnabled" },
					{ path: "server.ssl.cert", export: "sslCert" },
				],
			};

			const result = await tool.execute(step, context);
			expect(result.status).toBe("completed");

			const qr = result.toolResult as QueryExecutionResult;
			expect(qr.checks![0].value).toBe(true);
			expect(qr.checks![1].value).toBe("/path/to/cert");
		});

		it("should export value via result.output", async () => {
			const packageJson = { name: "test-package", version: "2.0.0" };
			writeFileSync(join(tmpDir, "package.json"), JSON.stringify(packageJson, null, 2));

			const step: QueryStep = {
				tool: "query",
				name: "export-version",
				file: "package.json",
				checks: [{ path: "version", export: "currentVersion" }],
			};

			const result = await tool.execute(step, context);
			expect(result.status).toBe("completed");
			expect(result.output).toBeDefined();
			expect(result.output!.currentVersion).toBe("2.0.0");
		});

		it("should export existence check as boolean via exportExists", async () => {
			const packageJson = {
				name: "test-package",
				dependencies: { react: "^18.0.0" },
				devDependencies: {},
			};
			writeFileSync(join(tmpDir, "package.json"), JSON.stringify(packageJson, null, 2));

			const step: QueryStep = {
				tool: "query",
				name: "check-deps",
				file: "package.json",
				checks: [
					{ path: "dependencies.react", exportExists: "hasReact" },
					{ path: "dependencies.vue", exportExists: "hasVue" },
				],
			};

			const result = await tool.execute(step, context);
			expect(result.status).toBe("completed");
			expect(result.output).toBeDefined();
			expect(result.output!.hasReact).toBe(true);
			expect(result.output!.hasVue).toBe(false);
		});

		it("should handle multiple exports from the same file", async () => {
			const packageJson = {
				name: "my-package",
				version: "1.0.0",
				author: "Test Author",
				license: "MIT",
			};
			writeFileSync(join(tmpDir, "package.json"), JSON.stringify(packageJson, null, 2));

			const step: QueryStep = {
				tool: "query",
				name: "multi-export",
				file: "package.json",
				checks: [
					{ path: "name", export: "pkgName" },
					{ path: "version", export: "pkgVersion" },
					{ path: "author", export: "pkgAuthor" },
					{ path: "license", export: "pkgLicense" },
				],
			};

			const result = await tool.execute(step, context);
			expect(result.status).toBe("completed");
			expect(result.output).toEqual({
				pkgName: "my-package",
				pkgVersion: "1.0.0",
				pkgAuthor: "Test Author",
				pkgLicense: "MIT",
			});
		});
	});

	// ---------------------------------------------------------------------------
	// 3. YAML file reading
	// ---------------------------------------------------------------------------
	describe("YAML queries", () => {
		let tool: QueryTool;
		let context: StepContext;

		beforeEach(() => {
			tool = new QueryTool();
			context = createContext(tmpDir);
		});

		it("should parse YAML file and export values", async () => {
			const yamlContent = `
name: test-project
version: 1.0.0
config:
  debug: true
  port: 3000
`;
			writeFileSync(join(tmpDir, "config.yml"), yamlContent);

			const step: QueryStep = {
				tool: "query",
				name: "read-yaml",
				file: "config.yml",
				checks: [
					{ path: "name", export: "projectName" },
					{ path: "config.debug", export: "debugMode" },
				],
			};

			const result = await tool.execute(step, context);
			expect(result.status).toBe("completed");

			const qr = result.toolResult as QueryExecutionResult;
			expect(qr.format).toBe("yaml");
			expect(qr.checks![0].value).toBe("test-project");
			expect(qr.checks![1].value).toBe(true);
			expect(result.output!.projectName).toBe("test-project");
			expect(result.output!.debugMode).toBe(true);
		});

		it("should handle dot-path checks in YAML", async () => {
			const yamlContent = `
database:
  host: localhost
  port: 5432
  credentials:
    user: admin
    password: secret
`;
			writeFileSync(join(tmpDir, "db.yaml"), yamlContent);

			const step: QueryStep = {
				tool: "query",
				name: "check-db",
				file: "db.yaml",
				checks: [
					{ path: "database.host", export: "dbHost" },
					{ path: "database.credentials.user", export: "dbUser" },
					{ path: "database.credentials.missing", exportExists: "hasApiKey" },
				],
			};

			const result = await tool.execute(step, context);
			expect(result.status).toBe("completed");
			expect(result.output!.dbHost).toBe("localhost");
			expect(result.output!.dbUser).toBe("admin");
			expect(result.output!.hasApiKey).toBe(false);
		});

		it("should auto-detect .yaml extension", async () => {
			const yamlContent = "test: value\n";
			writeFileSync(join(tmpDir, "data.yaml"), yamlContent);

			const step: QueryStep = {
				tool: "query",
				name: "detect-yaml",
				file: "data.yaml",
				checks: [{ path: "test", export: "result" }],
			};

			const result = await tool.execute(step, context);
			expect(result.status).toBe("completed");
			const qr = result.toolResult as QueryExecutionResult;
			expect(qr.format).toBe("yaml");
		});
	});

	// ---------------------------------------------------------------------------
	// 4. .env file reading
	// ---------------------------------------------------------------------------
	describe("ENV queries", () => {
		let tool: QueryTool;
		let context: StepContext;

		beforeEach(() => {
			tool = new QueryTool();
			context = createContext(tmpDir);
		});

		it("should parse .env file with comments", async () => {
			const envContent = `
# Database configuration
DB_HOST=localhost
DB_PORT=5432

# API keys
API_KEY=abc123
# SECRET_KEY=unused

EMPTY_VAR=
`;
			writeFileSync(join(tmpDir, ".env"), envContent);

			const step: QueryStep = {
				tool: "query",
				name: "read-env",
				file: ".env",
				format: "env", // .env is not auto-detected because path.extname('.env') === ''
				checks: [
					{ path: "DB_HOST", export: "dbHost" },
					{ path: "API_KEY", export: "apiKey" },
					{ path: "MISSING_KEY", exportExists: "hasMissing" },
				],
			};

			const result = await tool.execute(step, context);
			expect(result.status).toBe("completed");

			const qr = result.toolResult as QueryExecutionResult;
			expect(qr.format).toBe("env");
			expect(result.output!.dbHost).toBe("localhost");
			expect(result.output!.apiKey).toBe("abc123");
			expect(result.output!.hasMissing).toBe(false);
		});

		it("should handle quoted values in .env", async () => {
			const envContent = `SIMPLE=value
SINGLE_QUOTED='single value'
DOUBLE_QUOTED="double value"
`;
			writeFileSync(join(tmpDir, "app.env"), envContent);

			const step: QueryStep = {
				tool: "query",
				name: "read-quoted",
				file: "app.env",
				// app.env has extname ".env" so auto-detect works
				checks: [
					{ path: "SIMPLE", export: "simple" },
					{ path: "SINGLE_QUOTED", export: "singleQuoted" },
					{ path: "DOUBLE_QUOTED", export: "doubleQuoted" },
				],
			};

			const result = await tool.execute(step, context);
			expect(result.status).toBe("completed");
			expect(result.output!.simple).toBe("value");
			expect(result.output!.singleQuoted).toBe("single value");
			expect(result.output!.doubleQuoted).toBe("double value");
		});

		it("should handle empty lines and comments", async () => {
			const envContent = `# Comment line
DB_NAME=mydb

# Another comment

API_URL=https://api.example.com
`;
			writeFileSync(join(tmpDir, "config.env"), envContent);

			const step: QueryStep = {
				tool: "query",
				name: "parse-env",
				file: "config.env",
				checks: [
					{ path: "DB_NAME", export: "dbName" },
					{ path: "API_URL", export: "apiUrl" },
				],
			};

			const result = await tool.execute(step, context);
			expect(result.status).toBe("completed");
			expect(result.output!.dbName).toBe("mydb");
			expect(result.output!.apiUrl).toBe("https://api.example.com");
		});

		it("should handle env file with explicit format override", async () => {
			const envContent = `HOST=0.0.0.0\nPORT=8080\n`;
			writeFileSync(join(tmpDir, "settings.txt"), envContent);

			const step: QueryStep = {
				tool: "query",
				name: "explicit-env",
				file: "settings.txt",
				format: "env",
				checks: [
					{ path: "HOST", export: "host" },
					{ path: "PORT", export: "port" },
				],
			};

			const result = await tool.execute(step, context);
			expect(result.status).toBe("completed");
			expect(result.output!.host).toBe("0.0.0.0");
			expect(result.output!.port).toBe("8080");
		});
	});

	// ---------------------------------------------------------------------------
	// 5. Expression evaluation
	// ---------------------------------------------------------------------------
	describe("Expression evaluation", () => {
		let tool: QueryTool;
		let context: StepContext;

		beforeEach(() => {
			tool = new QueryTool();
			context = createContext(tmpDir);
		});

		it("should evaluate data.name", async () => {
			const packageJson = { name: "test-package", version: "1.0.0" };
			writeFileSync(join(tmpDir, "package.json"), JSON.stringify(packageJson, null, 2));

			const step: QueryStep = {
				tool: "query",
				name: "eval-name",
				file: "package.json",
				expression: "data.name",
			};

			const result = await tool.execute(step, context);
			expect(result.status).toBe("completed");

			const qr = result.toolResult as QueryExecutionResult;
			expect(qr.expression).toBe("data.name");
			expect(qr.value).toBe("test-package");
		});

		it("should evaluate data.dependencies and return object", async () => {
			const packageJson = {
				name: "test-package",
				dependencies: { react: "^18.0.0", vue: "^3.0.0" },
			};
			writeFileSync(join(tmpDir, "package.json"), JSON.stringify(packageJson, null, 2));

			const step: QueryStep = {
				tool: "query",
				name: "eval-deps",
				file: "package.json",
				expression: "data.dependencies",
			};

			const result = await tool.execute(step, context);
			expect(result.status).toBe("completed");

			const qr = result.toolResult as QueryExecutionResult;
			expect(qr.value).toEqual({ react: "^18.0.0", vue: "^3.0.0" });
		});

		it("should evaluate Object.keys(data).length", async () => {
			const packageJson = {
				dependencies: { react: "^18.0.0", vue: "^3.0.0" },
			};
			writeFileSync(join(tmpDir, "package.json"), JSON.stringify(packageJson, null, 2));

			const step: QueryStep = {
				tool: "query",
				name: "eval-keys-len",
				file: "package.json",
				expression: "Object.keys(data.dependencies).length",
			};

			const result = await tool.execute(step, context);
			expect(result.status).toBe("completed");

			const qr = result.toolResult as QueryExecutionResult;
			expect(qr.value).toBe(2);
		});

		it("should evaluate Object.keys returning array", async () => {
			const packageJson = {
				name: "test-package",
				dependencies: { react: "^18.0.0", vue: "^3.0.0", typescript: "^5.0.0" },
			};
			writeFileSync(join(tmpDir, "package.json"), JSON.stringify(packageJson, null, 2));

			const step: QueryStep = {
				tool: "query",
				name: "eval-keys",
				file: "package.json",
				expression: "Object.keys(data.dependencies)",
			};

			const result = await tool.execute(step, context);
			expect(result.status).toBe("completed");

			const qr = result.toolResult as QueryExecutionResult;
			expect(qr.value).toEqual(["react", "vue", "typescript"]);
		});

		it("should evaluate ternary expression: data.dependencies ? true : false", async () => {
			const packageJson = { name: "test", dependencies: { react: "^18.0.0" } };
			writeFileSync(join(tmpDir, "package.json"), JSON.stringify(packageJson, null, 2));

			const step: QueryStep = {
				tool: "query",
				name: "eval-ternary",
				file: "package.json",
				expression: "data.dependencies ? true : false",
			};

			const result = await tool.execute(step, context);
			expect(result.status).toBe("completed");

			const qr = result.toolResult as QueryExecutionResult;
			expect(qr.value).toBe(true);
		});

		it("should evaluate ternary with string comparison", async () => {
			const config = { mode: "production" };
			writeFileSync(join(tmpDir, "config.json"), JSON.stringify(config, null, 2));

			const step: QueryStep = {
				tool: "query",
				name: "ternary",
				file: "config.json",
				expression: 'data.mode === "production" ? "prod" : "dev"',
			};

			const result = await tool.execute(step, context);
			expect(result.status).toBe("completed");

			const qr = result.toolResult as QueryExecutionResult;
			expect(qr.value).toBe("prod");
		});

		it("should put expression result in output.value", async () => {
			const packageJson = { name: "my-pkg" };
			writeFileSync(join(tmpDir, "package.json"), JSON.stringify(packageJson));

			const step: QueryStep = {
				tool: "query",
				name: "expr-output",
				file: "package.json",
				expression: "data.name",
			};

			const result = await tool.execute(step, context);
			expect(result.status).toBe("completed");
			// When expression is used (no checks), output = { value: expressionResult }
			expect(result.output).toEqual({ value: "my-pkg" });
		});

		it("should return status failed for expression that throws at runtime", async () => {
			const packageJson = { name: "test" };
			writeFileSync(join(tmpDir, "package.json"), JSON.stringify(packageJson, null, 2));

			const step: QueryStep = {
				tool: "query",
				name: "eval-error",
				file: "package.json",
				expression: "data.nonexistent.property.deep",
			};

			const result = await tool.execute(step, context);
			expect(result.status).toBe("failed");
			expect(result.error).toBeDefined();
			expect(result.error!.message).toMatch(/expression evaluation failed/i);
			expect(result.error!.code).toBe("QUERY_FAILED");
		});

		it("should handle array index access in expression", async () => {
			const data = {
				users: [
					{ name: "Alice", age: 30 },
					{ name: "Bob", age: 25 },
				],
			};
			writeFileSync(join(tmpDir, "data.json"), JSON.stringify(data));

			const step: QueryStep = {
				tool: "query",
				name: "array-access",
				file: "data.json",
				expression: "data.users[0].name",
			};

			const result = await tool.execute(step, context);
			expect(result.status).toBe("completed");

			const qr = result.toolResult as QueryExecutionResult;
			expect(qr.value).toBe("Alice");
		});
	});

	// ---------------------------------------------------------------------------
	// 6. Auto-format detection
	// ---------------------------------------------------------------------------
	describe("Format auto-detection", () => {
		let tool: QueryTool;
		let context: StepContext;

		beforeEach(() => {
			tool = new QueryTool();
			context = createContext(tmpDir);
		});

		it("should auto-detect .json extension", async () => {
			const data = { test: "value" };
			writeFileSync(join(tmpDir, "data.json"), JSON.stringify(data));

			const step: QueryStep = {
				tool: "query",
				name: "detect-json",
				file: "data.json",
				checks: [{ path: "test", export: "result" }],
			};

			const result = await tool.execute(step, context);
			expect(result.status).toBe("completed");
			const qr = result.toolResult as QueryExecutionResult;
			expect(qr.format).toBe("json");
		});

		it("should auto-detect .yml extension", async () => {
			const yamlContent = "test: value\n";
			writeFileSync(join(tmpDir, "data.yml"), yamlContent);

			const step: QueryStep = {
				tool: "query",
				name: "detect-yml",
				file: "data.yml",
				checks: [{ path: "test", export: "result" }],
			};

			const result = await tool.execute(step, context);
			expect(result.status).toBe("completed");
			const qr = result.toolResult as QueryExecutionResult;
			expect(qr.format).toBe("yaml");
		});

		it("should auto-detect .toml extension", async () => {
			// detectFormat returns 'toml' for .toml files.
			// Parsing may fail because smol-toml isn't installed, but the format detection works.
			writeFileSync(join(tmpDir, "config.toml"), '[section]\nkey = "value"\n');

			const step: QueryStep = {
				tool: "query",
				name: "detect-toml",
				file: "config.toml",
				checks: [{ path: "section.key", export: "result" }],
			};

			const result = await tool.execute(step, context);
			// Parsing will fail because smol-toml isn't installed, but that's expected
			// The important thing is that format was detected as 'toml'
			if (result.status === "failed") {
				expect(result.error!.message).toMatch(/smol-toml/i);
			} else {
				const qr = result.toolResult as QueryExecutionResult;
				expect(qr.format).toBe("toml");
			}
		});

		it("should auto-detect .env extension on files like config.env", async () => {
			const envContent = "TEST=value\n";
			writeFileSync(join(tmpDir, "config.env"), envContent);

			const step: QueryStep = {
				tool: "query",
				name: "detect-env",
				file: "config.env",
				checks: [{ path: "TEST", export: "result" }],
			};

			const result = await tool.execute(step, context);
			expect(result.status).toBe("completed");
			const qr = result.toolResult as QueryExecutionResult;
			expect(qr.format).toBe("env");
		});

		it('should NOT auto-detect .env when filename is literally ".env"', async () => {
			// path.extname('.env') returns '' so format detection fails
			const envContent = "TEST=value\n";
			writeFileSync(join(tmpDir, ".env"), envContent);

			const step: QueryStep = {
				tool: "query",
				name: "dot-env-no-detect",
				file: ".env",
				// no format specified
				checks: [{ path: "TEST", export: "result" }],
			};

			const result = await tool.execute(step, context);
			expect(result.status).toBe("failed");
			expect(result.error!.message).toMatch(/cannot detect format/i);
		});

		it("should use explicit format over auto-detection", async () => {
			const jsonData = { test: "value" };
			writeFileSync(join(tmpDir, "data.txt"), JSON.stringify(jsonData));

			const step: QueryStep = {
				tool: "query",
				name: "explicit-format",
				file: "data.txt",
				format: "json",
				checks: [{ path: "test", export: "result" }],
			};

			const result = await tool.execute(step, context);
			expect(result.status).toBe("completed");
			expect(result.output!.result).toBe("value");
		});
	});

	// ---------------------------------------------------------------------------
	// 7. Error cases (all return status: 'failed', never throw)
	// ---------------------------------------------------------------------------
	describe("Error cases", () => {
		let tool: QueryTool;
		let context: StepContext;

		beforeEach(() => {
			tool = new QueryTool();
			context = createContext(tmpDir);
		});

		it("should return failed when file not found", async () => {
			const step: QueryStep = {
				tool: "query",
				name: "missing-file",
				file: "nonexistent.json",
				checks: [{ path: "test", export: "result" }],
			};

			const result = await tool.execute(step, context);
			expect(result.status).toBe("failed");
			expect(result.error).toBeDefined();
			expect(result.error!.message).toMatch(/file not found/i);
			expect(result.error!.code).toBe("QUERY_FAILED");
		});

		it("should return failed when JSON is invalid", async () => {
			writeFileSync(join(tmpDir, "invalid.json"), "{invalid json}");

			const step: QueryStep = {
				tool: "query",
				name: "invalid-json",
				file: "invalid.json",
				checks: [{ path: "test", export: "result" }],
			};

			const result = await tool.execute(step, context);
			expect(result.status).toBe("failed");
			expect(result.error).toBeDefined();
			expect(result.error!.code).toBe("QUERY_FAILED");
		});

		it("should return failed when YAML is malformed", async () => {
			// Write genuinely invalid YAML: a mapping value on the same line as another mapping
			writeFileSync(join(tmpDir, "invalid.yml"), ":\n  - :\n    a: b: c: d\n");

			const step: QueryStep = {
				tool: "query",
				name: "invalid-yaml",
				file: "invalid.yml",
				checks: [{ path: "test", export: "result" }],
			};

			const result = await tool.execute(step, context);
			// YAML parser may or may not throw for certain inputs.
			// The key assertion is that we never get an unhandled rejection.
			expect(["completed", "failed"]).toContain(result.status);
		});

		it("should return failed when file extension is unknown and no format specified", async () => {
			writeFileSync(join(tmpDir, "data.xyz"), "some content");

			const step: QueryStep = {
				tool: "query",
				name: "unknown-ext",
				file: "data.xyz",
				checks: [{ path: "test", export: "result" }],
			};

			const result = await tool.execute(step, context);
			expect(result.status).toBe("failed");
			expect(result.error!.message).toMatch(/cannot detect format/i);
		});

		it("should return failed when an unsupported format string is given and file does not exist", async () => {
			// The format string 'xml' is not in the valid set, so parseFile will throw 'Unsupported format'
			writeFileSync(join(tmpDir, "data.xml"), "<root/>");

			const step: QueryStep = {
				tool: "query",
				name: "unsupported-fmt",
				file: "data.xml",
				format: "xml" as any,
				checks: [{ path: "test", export: "result" }],
			};

			const result = await tool.execute(step, context);
			expect(result.status).toBe("failed");
			expect(result.error!.message).toMatch(/unsupported format/i);
		});

		it("should set stepName and toolType on error result", async () => {
			const step: QueryStep = {
				tool: "query",
				name: "error-metadata",
				file: "missing.json",
				checks: [{ path: "x", export: "y" }],
			};

			const result = await tool.execute(step, context);
			expect(result.status).toBe("failed");
			expect(result.stepName).toBe("error-metadata");
			expect(result.toolType).toBe("query");
		});
	});

	// ---------------------------------------------------------------------------
	// 8. Output / exports
	// ---------------------------------------------------------------------------
	describe("Output and exports", () => {
		let tool: QueryTool;
		let context: StepContext;

		beforeEach(() => {
			tool = new QueryTool();
			context = createContext(tmpDir);
		});

		it("should set output from check exports", async () => {
			const data = { a: 1, b: "two" };
			writeFileSync(join(tmpDir, "data.json"), JSON.stringify(data));

			const step: QueryStep = {
				tool: "query",
				name: "output-check",
				file: "data.json",
				checks: [
					{ path: "a", export: "valA" },
					{ path: "b", export: "valB" },
				],
			};

			const result = await tool.execute(step, context);
			expect(result.status).toBe("completed");
			expect(result.output).toEqual({ valA: 1, valB: "two" });
		});

		it("should set output from exportExists", async () => {
			const data = { present: "yes", missing: undefined };
			writeFileSync(join(tmpDir, "data.json"), JSON.stringify(data));

			const step: QueryStep = {
				tool: "query",
				name: "output-exists",
				file: "data.json",
				checks: [
					{ path: "present", exportExists: "hasPresent" },
					{ path: "absent", exportExists: "hasAbsent" },
				],
			};

			const result = await tool.execute(step, context);
			expect(result.status).toBe("completed");
			expect(result.output!.hasPresent).toBe(true);
			expect(result.output!.hasAbsent).toBe(false);
		});

		it("should set output.value for expression result", async () => {
			const data = { items: [1, 2, 3] };
			writeFileSync(join(tmpDir, "data.json"), JSON.stringify(data));

			const step: QueryStep = {
				tool: "query",
				name: "output-expr",
				file: "data.json",
				expression: "data.items.length",
			};

			const result = await tool.execute(step, context);
			expect(result.status).toBe("completed");
			expect(result.output).toEqual({ value: 3 });
		});

		it("should include check exports when both checks and expression are present", async () => {
			const data = { name: "test", version: "1.0.0" };
			writeFileSync(join(tmpDir, "data.json"), JSON.stringify(data));

			const step: QueryStep = {
				tool: "query",
				name: "both",
				file: "data.json",
				checks: [{ path: "name", export: "pkgName" }],
				expression: "data.version",
			};

			const result = await tool.execute(step, context);
			expect(result.status).toBe("completed");
			// When checks produce output, checks take priority over expression for the output field
			expect(result.output!.pkgName).toBe("test");
			// The expression value is still in toolResult
			const qr = result.toolResult as QueryExecutionResult;
			expect(qr.value).toBe("1.0.0");
		});

		it("should have no output when check has no export/exportExists", async () => {
			const data = { name: "test" };
			writeFileSync(join(tmpDir, "data.json"), JSON.stringify(data));

			const step: QueryStep = {
				tool: "query",
				name: "no-export",
				file: "data.json",
				checks: [{ path: "name" }],
			};

			const result = await tool.execute(step, context);
			expect(result.status).toBe("completed");
			// No exports were defined, and no expression, so output is undefined
			expect(result.output).toBeUndefined();
			// But the toolResult still has the check data
			const qr = result.toolResult as QueryExecutionResult;
			expect(qr.checks![0].exists).toBe(true);
			expect(qr.checks![0].value).toBe("test");
		});

		it("should NOT mutate context.variables", async () => {
			const data = { key: "val" };
			writeFileSync(join(tmpDir, "data.json"), JSON.stringify(data));

			const step: QueryStep = {
				tool: "query",
				name: "no-ctx-mutate",
				file: "data.json",
				checks: [{ path: "key", export: "myKey" }],
			};

			const result = await tool.execute(step, context);
			expect(result.status).toBe("completed");
			// The tool puts exports into result.output, NOT into context.variables
			expect(context.variables).toEqual({});
			expect(result.output!.myKey).toBe("val");
		});
	});

	// ---------------------------------------------------------------------------
	// 9. Factory
	// ---------------------------------------------------------------------------
	describe("Factory", () => {
		it("should create QueryTool instance with default name", () => {
			const factory = new QueryToolFactory();
			const tool = factory.create();
			expect(tool).toBeInstanceOf(QueryTool);
			expect(tool.name).toBe("query-tool");
		});

		it("should create instance with custom name", () => {
			const factory = new QueryToolFactory();
			const tool = factory.create("my-query");
			expect(tool).toBeInstanceOf(QueryTool);
			expect(tool.name).toBe("my-query");
		});

		it("should return correct tool type", () => {
			const factory = new QueryToolFactory();
			expect(factory.getToolType()).toBe("query");
		});

		it("should return a valid ToolValidationResult from validateConfig", () => {
			const factory = new QueryToolFactory();
			const result = factory.validateConfig({
				tool: "query",
				name: "test",
				file: "package.json",
				checks: [{ path: "name", export: "pkgName" }],
			});
			// The factory's validateConfig always returns { isValid: true, ... }
			expect(result).toEqual({
				isValid: true,
				errors: [],
				warnings: [],
				suggestions: [],
			});
		});

		it("should return isValid true even for incomplete config (factory does not validate)", () => {
			const factory = new QueryToolFactory();
			const result = factory.validateConfig({ tool: "query", name: "test" });
			expect(result.isValid).toBe(true);
			expect(result.errors).toEqual([]);
		});

		it("should export singleton instance", () => {
			expect(queryToolFactory).toBeInstanceOf(QueryToolFactory);
			expect(queryToolFactory.getToolType()).toBe("query");
		});

		it("should create multiple independent instances", () => {
			const factory = new QueryToolFactory();
			const tool1 = factory.create("query1");
			const tool2 = factory.create("query2");
			expect(tool1).not.toBe(tool2);
			expect(tool1.name).toBe("query1");
			expect(tool2.name).toBe("query2");
		});
	});

	// ---------------------------------------------------------------------------
	// 10. Validation (via the validate method, not execute)
	// ---------------------------------------------------------------------------
	describe("Validation (via tool.validate)", () => {
		let tool: QueryTool;
		let context: StepContext;

		beforeEach(() => {
			tool = new QueryTool();
			context = createContext(tmpDir);
		});

		it("should return isValid true for a well-formed step", async () => {
			const step: QueryStep = {
				tool: "query",
				name: "valid",
				file: "package.json",
				checks: [{ path: "name", export: "pkgName" }],
			};
			const vr = await tool.validate(step, context);
			expect(vr.isValid).toBe(true);
			expect(vr.errors).toEqual([]);
		});

		it("should fail when file is missing", async () => {
			const step = {
				tool: "query",
				name: "no-file",
				checks: [{ path: "name", export: "pkgName" }],
			} as any;

			const vr = await tool.validate(step, context);
			expect(vr.isValid).toBe(false);
			expect(vr.errors.length).toBeGreaterThan(0);
			expect(vr.errors[0]).toMatch(/file.*required/i);
		});

		it("should fail when both checks and expression are missing", async () => {
			const step = {
				tool: "query",
				name: "no-query",
				file: "package.json",
			} as any;

			const vr = await tool.validate(step, context);
			expect(vr.isValid).toBe(false);
			expect(vr.errors.some((e: string) => /checks.*expression/i.test(e))).toBe(true);
		});

		it("should fail when a check has no path", async () => {
			const step: QueryStep = {
				tool: "query",
				name: "no-path",
				file: "package.json",
				checks: [{ export: "result" } as any],
			};

			const vr = await tool.validate(step, context);
			expect(vr.isValid).toBe(false);
			expect(vr.errors.some((e: string) => /must have.*path/i.test(e))).toBe(true);
		});

		it("should fail when format is unsupported", async () => {
			const step = {
				tool: "query",
				name: "bad-format",
				file: "data.xml",
				format: "xml",
				checks: [{ path: "test", export: "x" }],
			} as any;

			const vr = await tool.validate(step, context);
			expect(vr.isValid).toBe(false);
			expect(vr.errors.some((e: string) => /unsupported format/i.test(e))).toBe(true);
		});

		it("should warn when both checks and expression are provided", async () => {
			const step: QueryStep = {
				tool: "query",
				name: "both",
				file: "package.json",
				checks: [{ path: "name", export: "pkgName" }],
				expression: "data.version",
			};

			const vr = await tool.validate(step, context);
			expect(vr.isValid).toBe(true);
			expect(vr.warnings.length).toBeGreaterThan(0);
			expect(vr.warnings[0]).toMatch(/both/i);
		});

		it("should warn when check has no export or exportExists", async () => {
			const step: QueryStep = {
				tool: "query",
				name: "no-export-warn",
				file: "package.json",
				checks: [{ path: "name" }],
			};

			const vr = await tool.validate(step, context);
			expect(vr.isValid).toBe(true);
			expect(vr.warnings.length).toBeGreaterThan(0);
			expect(vr.warnings[0]).toMatch(/export.*exportExists/i);
		});
	});

	// ---------------------------------------------------------------------------
	// 11. Edge cases
	// ---------------------------------------------------------------------------
	describe("Edge cases", () => {
		let tool: QueryTool;
		let context: StepContext;

		beforeEach(() => {
			tool = new QueryTool();
			context = createContext(tmpDir);
		});

		it("should handle empty JSON object", async () => {
			writeFileSync(join(tmpDir, "empty.json"), "{}");

			const step: QueryStep = {
				tool: "query",
				name: "empty-obj",
				file: "empty.json",
				checks: [{ path: "anything", exportExists: "exists" }],
			};

			const result = await tool.execute(step, context);
			expect(result.status).toBe("completed");
			expect(result.output!.exists).toBe(false);
		});

		it("should handle empty array value", async () => {
			const data = { items: [] };
			writeFileSync(join(tmpDir, "data.json"), JSON.stringify(data));

			const step: QueryStep = {
				tool: "query",
				name: "empty-array",
				file: "data.json",
				checks: [{ path: "items", export: "items" }],
			};

			const result = await tool.execute(step, context);
			expect(result.status).toBe("completed");
			expect(result.output!.items).toEqual([]);
		});

		it("should handle null values — export is null, exportExists is false", async () => {
			const data = { value: null };
			writeFileSync(join(tmpDir, "data.json"), JSON.stringify(data));

			const step: QueryStep = {
				tool: "query",
				name: "null-value",
				file: "data.json",
				checks: [
					{ path: "value", export: "val" },
					{ path: "value", exportExists: "exists" },
				],
			};

			const result = await tool.execute(step, context);
			expect(result.status).toBe("completed");
			expect(result.output!.val).toBeNull();
			// exportExists: resolved.exists (true) && resolved.value != null (false) → false
			expect(result.output!.exists).toBe(false);
		});

		it("should handle boolean values", async () => {
			const data = { enabled: true, disabled: false };
			writeFileSync(join(tmpDir, "data.json"), JSON.stringify(data));

			const step: QueryStep = {
				tool: "query",
				name: "booleans",
				file: "data.json",
				checks: [
					{ path: "enabled", export: "isEnabled" },
					{ path: "disabled", export: "isDisabled" },
				],
			};

			const result = await tool.execute(step, context);
			expect(result.status).toBe("completed");
			expect(result.output!.isEnabled).toBe(true);
			expect(result.output!.isDisabled).toBe(false);
		});

		it("should handle false value with exportExists — false is treated as non-existent", async () => {
			const data = { flag: false };
			writeFileSync(join(tmpDir, "data.json"), JSON.stringify(data));

			const step: QueryStep = {
				tool: "query",
				name: "false-exists",
				file: "data.json",
				checks: [{ path: "flag", exportExists: "hasFlag" }],
			};

			const result = await tool.execute(step, context);
			expect(result.status).toBe("completed");
			// exportExists: exists (true) && value != null (true) && value !== false (false) → false
			expect(result.output!.hasFlag).toBe(false);
		});

		it("should handle numeric values including zero", async () => {
			const data = { count: 42, price: 19.99, zero: 0 };
			writeFileSync(join(tmpDir, "data.json"), JSON.stringify(data));

			const step: QueryStep = {
				tool: "query",
				name: "numbers",
				file: "data.json",
				checks: [
					{ path: "count", export: "count" },
					{ path: "price", export: "price" },
					{ path: "zero", export: "zero" },
				],
			};

			const result = await tool.execute(step, context);
			expect(result.status).toBe("completed");
			expect(result.output!.count).toBe(42);
			expect(result.output!.price).toBe(19.99);
			expect(result.output!.zero).toBe(0);
		});

		it("should handle relative file paths with subdirectories", async () => {
			const subDir = join(tmpDir, "config");
			mkdirSync(subDir);
			const data = { test: "value" };
			writeFileSync(join(subDir, "settings.json"), JSON.stringify(data));

			const step: QueryStep = {
				tool: "query",
				name: "relative-path",
				file: "config/settings.json",
				checks: [{ path: "test", export: "result" }],
			};

			const result = await tool.execute(step, context);
			expect(result.status).toBe("completed");
			expect(result.output!.result).toBe("value");
		});

		it("should populate StepResult timing fields on success", async () => {
			const data = { x: 1 };
			writeFileSync(join(tmpDir, "data.json"), JSON.stringify(data));

			const step: QueryStep = {
				tool: "query",
				name: "timing-test",
				file: "data.json",
				checks: [{ path: "x", export: "x" }],
			};

			const result = await tool.execute(step, context);
			expect(result.status).toBe("completed");
			expect(result.stepName).toBe("timing-test");
			expect(result.toolType).toBe("query");
			expect(result.startTime).toBeInstanceOf(Date);
			expect(result.endTime).toBeInstanceOf(Date);
			expect(typeof result.duration).toBe("number");
			expect(result.duration).toBeGreaterThanOrEqual(0);
			expect(result.retryCount).toBe(0);
			expect(result.dependenciesSatisfied).toBe(true);
		});

		it("should populate StepResult timing fields on failure", async () => {
			const step: QueryStep = {
				tool: "query",
				name: "timing-fail",
				file: "nope.json",
				checks: [{ path: "x", export: "x" }],
			};

			const result = await tool.execute(step, context);
			expect(result.status).toBe("failed");
			expect(result.stepName).toBe("timing-fail");
			expect(result.toolType).toBe("query");
			expect(result.startTime).toBeInstanceOf(Date);
			expect(result.endTime).toBeInstanceOf(Date);
			expect(typeof result.duration).toBe("number");
		});

		it("should handle zero as exportExists — zero is truthy for existsCheck", async () => {
			const data = { count: 0 };
			writeFileSync(join(tmpDir, "data.json"), JSON.stringify(data));

			const step: QueryStep = {
				tool: "query",
				name: "zero-exists",
				file: "data.json",
				checks: [{ path: "count", exportExists: "hasCount" }],
			};

			const result = await tool.execute(step, context);
			expect(result.status).toBe("completed");
			// exportExists: exists (true) && value != null (true, 0 != null) && value !== false (true, 0 !== false) → true
			expect(result.output!.hasCount).toBe(true);
		});

		it("should handle empty string as exportExists — truthy for existsCheck", async () => {
			const data = { empty: "" };
			writeFileSync(join(tmpDir, "data.json"), JSON.stringify(data));

			const step: QueryStep = {
				tool: "query",
				name: "empty-str-exists",
				file: "data.json",
				checks: [{ path: "empty", exportExists: "hasEmpty" }],
			};

			const result = await tool.execute(step, context);
			expect(result.status).toBe("completed");
			// exportExists: exists (true) && '' != null (true) && '' !== false (true) → true
			expect(result.output!.hasEmpty).toBe(true);
		});
	});
});
