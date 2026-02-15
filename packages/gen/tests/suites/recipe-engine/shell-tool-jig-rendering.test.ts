import { describe, it, expect } from "vitest";
import { renderTemplate } from "#/template-engines/jig-engine";

describe("Shell Tool - Jig Rendering", () => {
	it("should render Jig @if/@elseif/@end tags in shell commands", async () => {
		const command = `@if(database === 'postgres')
echo "postgres"
@elseif(database === 'sqlite')
echo "sqlite"
@end`;
		const context = { database: "sqlite" };

		const result = await renderTemplate(command, context);

		expect(result).toContain("sqlite");
		expect(result).not.toContain("@if");
		expect(result).not.toContain("@elseif");
		expect(result).not.toContain("@end");
		expect(result).not.toContain("postgres");
	});

	it("should render Jig {{ variable }} interpolation in shell commands", async () => {
		const command = 'echo "Project: {{ projectName }}, Version: {{ version }}"';
		const context = { projectName: "my-app", version: "1.0.0" };

		const result = await renderTemplate(command, context);

		expect(result).toContain("my-app");
		expect(result).toContain("1.0.0");
		expect(result).not.toContain("{{");
		expect(result).not.toContain("}}");
	});

	it("should handle nested conditionals and variables together", async () => {
		const command = `@if(env === 'prod')
echo "Production: {{ dbUrl }}"
@else()
echo "Development: {{ localDb }}"
@end`;
		const context = {
			env: "dev",
			localDb: "sqlite:local.db",
			dbUrl: "postgres://prod",
		};

		const result = await renderTemplate(command, context);

		expect(result).toContain("Development");
		expect(result).toContain("sqlite:local.db");
		expect(result).not.toContain("Production");
		expect(result).not.toContain("postgres://prod");
	});

	it("should render multi-line shell commands with conditionals", async () => {
		const command = `
if [ ! -f .env ]; then
  touch .env
fi
@if(databaseUrl)
echo "DATABASE_URL=\\"{{ databaseUrl }}\\"" >> .env
@elseif(database === 'sqlite')
echo "DATABASE_URL=\\"file:./local.db\\"" >> .env
@end
    `.trim();

		const context = { database: "sqlite" };

		const result = await renderTemplate(command, context);

		expect(result).toContain("file:./local.db");
		expect(result).not.toContain("@if");
		expect(result).not.toContain("@elseif");
		expect(result).not.toContain("@end");
		expect(result).not.toContain("{{ databaseUrl }}");
	});

	it("should handle context variables from different sources (step, recipe, context)", async () => {
		const command = 'echo "{{ recipeVar }} {{ contextVar }} {{ stepVar }}"';

		// This simulates what buildRenderContext() does
		const recipeVariables = { recipeVar: "recipe-value" };
		const contextVariables = { contextVar: "context-value" };
		const stepVariables = { stepVar: "step-value" };

		const mergedContext = {
			...recipeVariables,
			...contextVariables,
			...stepVariables,
		};

		const result = await renderTemplate(command, mergedContext);

		expect(result).toContain("recipe-value");
		expect(result).toContain("context-value");
		expect(result).toContain("step-value");
	});
});
