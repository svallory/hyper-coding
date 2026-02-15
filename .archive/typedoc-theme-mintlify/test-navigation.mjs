/**
 * Test script to verify multi-strategy navigation works for all combinations
 */

import { DocsJsonUpdater } from "./dist/src/integrations/docs-json-updater.js";
import fs from "fs";

// Mock reflection data that simulates TypeDoc output
const mockReflections = [
	{
		name: "ActionTool",
		folder: "actions",
		file: "action-tool",
		kind: "Class",
		kindIcon: "cube",
		generatedPath: "classes/ActionTool",
	},
	{
		name: "ActionToolFactory",
		folder: "actions",
		file: "action-tool",
		kind: "Class",
		kindIcon: "cube",
		generatedPath: "classes/ActionToolFactory",
	},
	{
		name: "RecipeEngine",
		folder: "recipe-engine",
		file: "recipe-engine",
		kind: "Class",
		kindIcon: "cube",
		generatedPath: "classes/RecipeEngine",
	},
	{
		name: "StepExecutor",
		folder: "recipe-engine",
		file: "step-executor",
		kind: "Class",
		kindIcon: "cube",
		generatedPath: "classes/StepExecutor",
	},
	{
		name: "ToolFactory",
		folder: "actions",
		file: "types",
		kind: "Interface",
		kindIcon: "plug",
		generatedPath: "interfaces/ToolFactory",
	},
	{
		name: "createTool",
		folder: "actions",
		file: "utils",
		kind: "Function",
		kindIcon: "bolt",
		generatedPath: "functions/createTool",
	},
];

// Test all grouping combinations
const groupingCombinations = [
	["folder"],
	["file"],
	["kind"],
	["folder", "file"],
	["folder", "kind"],
	["file", "kind"],
	["folder", "file", "kind"],
	["file", "folder"], // Test order doesn't matter
	["kind", "folder"],
	["file", "folder", "kind"],
];

const iconCombinations = [
	"all",
	"none",
	["folder"],
	["file"],
	["kind"],
	["folder", "file"],
	["folder", "kind"],
	["file", "kind"],
	["folder", "file", "kind"],
];

// Create a test instance
const updater = new DocsJsonUpdater({
	docsJsonPath: "/tmp/test-docs.json",
	tabName: "Test API",
	outputDirectory: "/tmp/output",
	projectName: "Test Project",
});

// Test the buildHierarchicalStructure method directly
function testGrouping(groupings, sidebarIcons, description) {
	console.log(`\n=== Testing ${description} ===`);
	console.log(`Groupings: [${groupings.join(", ")}]`);
	console.log(
		`Icons: ${Array.isArray(sidebarIcons) ? `[${sidebarIcons.join(", ")}]` : sidebarIcons}`,
	);

	try {
		// Access private method via prototype (for testing)
		const result = updater.buildHierarchicalStructure.call(
			updater,
			mockReflections,
			groupings,
			"api-reference/test",
			sidebarIcons,
		);

		console.log("Result structure:");
		console.log(JSON.stringify(result, null, 2));

		// Validate structure
		validateStructure(result, groupings, sidebarIcons);
		console.log("✅ Structure validation passed");
	} catch (error) {
		console.error("❌ Error:", error.message);
		console.error("Stack:", error.stack);
	}
}

function validateStructure(result, groupings, sidebarIcons) {
	// Basic validation logic
	if (!Array.isArray(result)) {
		throw new Error("Result should be an array");
	}

	console.log(`Validating groupings: [${groupings.join(", ")}]`);

	// Check for expected structure based on groupings
	if (groupings.includes("folder") && groupings.length === 1) {
		// Should have folder groups
		const hasFolder = result.some(
			(item) =>
				typeof item === "object" && item.group && ["Actions", "Recipe Engine"].includes(item.group),
		);
		if (!hasFolder) {
			throw new Error("Expected folder groups not found");
		}
	}

	if (groupings.includes("file") && groupings.length === 1) {
		// Should have file groups
		const hasFile = result.some(
			(item) =>
				typeof item === "object" &&
				item.group &&
				["action-tool", "recipe-engine", "step-executor"].includes(item.group),
		);
		if (!hasFile) {
			throw new Error("Expected file groups not found");
		}
	}

	if (groupings.includes("kind") && groupings.length === 1) {
		// For kind-only strategy, should have individual items with kind icons
		const hasKindIcons = result.some(
			(item) =>
				typeof item === "object" && item.icon && ["cube", "plug", "bolt"].includes(item.icon),
		);
		if (!hasKindIcons) {
			throw new Error("Expected individual items with kind icons not found");
		}
	}

	// Check for multi-strategy combinations
	if (groupings.includes("folder") && groupings.includes("file") && groupings.length === 2) {
		if (groupings[0] === "folder") {
			// Folder → File: Should have folder groups with file sub-groups
			const hasFolder = result.some(
				(item) =>
					typeof item === "object" &&
					item.group &&
					["Actions", "Recipe Engine"].includes(item.group),
			);

			const hasFileSubGroup = result.some(
				(item) =>
					typeof item === "object" &&
					item.group &&
					["Actions", "Recipe Engine"].includes(item.group) &&
					item.pages &&
					item.pages.some(
						(page) =>
							typeof page === "object" &&
							page.group &&
							["action-tool", "recipe-engine", "step-executor", "types", "utils"].includes(
								page.group,
							),
					),
			);

			if (!hasFolder) {
				throw new Error("Expected folder groups not found");
			}

			if (!hasFileSubGroup) {
				throw new Error("Expected at least some file sub-groups within folders");
			}
		} else {
			// File → Folder: Should have file groups with folder sub-groups
			const hasFile = result.some(
				(item) =>
					typeof item === "object" &&
					item.group &&
					["action-tool", "recipe-engine", "step-executor", "types", "utils"].includes(item.group),
			);

			const hasFolderSubGroup = result.some(
				(item) =>
					typeof item === "object" &&
					item.group &&
					["action-tool", "recipe-engine", "step-executor", "types", "utils"].includes(
						item.group,
					) &&
					item.pages &&
					item.pages.some(
						(page) =>
							typeof page === "object" &&
							page.group &&
							["Actions", "Recipe Engine"].includes(page.group),
					),
			);

			if (!hasFile) {
				throw new Error("Expected file groups not found");
			}

			if (!hasFolderSubGroup) {
				throw new Error("Expected at least some folder sub-groups within files");
			}
		}
	}
}

// Make the private method accessible for testing
updater.buildHierarchicalStructure = updater.constructor.prototype.buildHierarchicalStructure;

// Run tests
console.log("🧪 Testing Multi-Strategy Navigation Generation");

// Test single groupings first
testGrouping(["folder"], "all", "Folder Only");
testGrouping(["file"], "all", "File Only");
testGrouping(["kind"], "all", "Kind Only");

// Test multi-grouping combinations
testGrouping(["folder", "file"], "all", "Folder → File");
testGrouping(["folder", "kind"], "all", "Folder → Kind");
testGrouping(["file", "kind"], "all", "File → Kind");
testGrouping(["folder", "file", "kind"], "all", "Folder → File → Kind");

// Test that order doesn't matter
testGrouping(["file", "folder"], "all", "File → Folder (order test)");

// Test different icon combinations
testGrouping(["folder"], ["folder"], "Folder with folder icons only");
testGrouping(["folder", "file"], ["folder", "kind"], "Multi-grouping with selective icons");

// Test order independence
testGrouping(["kind", "folder"], "all", "Kind → Folder (order test)");

console.log("\n🏁 Testing complete");
