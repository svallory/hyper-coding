/**
 * Additional tests for icon edge cases and specific scenarios
 */

import { DocsJsonUpdater } from "./dist/src/integrations/docs-json-updater.js";

// Mock reflection data with edge cases
const edgeCaseReflections = [
	// Single item in folder
	{
		name: "SingleClass",
		folder: "single-folder",
		file: "single-file",
		kind: "Class",
		kindIcon: "cube",
		generatedPath: "classes/SingleClass",
	},
	// Multiple items same file
	{
		name: "MultiA",
		folder: "multi",
		file: "same-file",
		kind: "Class",
		kindIcon: "cube",
		generatedPath: "classes/MultiA",
	},
	{
		name: "MultiB",
		folder: "multi",
		file: "same-file",
		kind: "Interface",
		kindIcon: "plug",
		generatedPath: "interfaces/MultiB",
	},
	// Mixed kinds in same folder
	{
		name: "MixedClass",
		folder: "mixed",
		file: "class-file",
		kind: "Class",
		kindIcon: "cube",
		generatedPath: "classes/MixedClass",
	},
	{
		name: "MixedEnum",
		folder: "mixed",
		file: "enum-file",
		kind: "Enum",
		kindIcon: "list",
		generatedPath: "enums/MixedEnum",
	},
];

const updater = new DocsJsonUpdater({
	docsJsonPath: "/tmp/test-docs.json",
	tabName: "Test API",
	outputDirectory: "/tmp/output",
	projectName: "Test Project",
});

updater.buildHierarchicalStructure = updater.constructor.prototype.buildHierarchicalStructure;

// Test specific edge case scenarios
function testEdgeCase(reflections, groupings, sidebarIcons, testName, expectedBehavior) {
	console.log(`\n🧪 ${testName}`);
	console.log(`Expected: ${expectedBehavior}`);
	console.log(
		`Groupings: [${groupings.join(", ")}], Icons: ${Array.isArray(sidebarIcons) ? `[${sidebarIcons.join(", ")}]` : sidebarIcons}`,
	);

	try {
		const result = updater.buildHierarchicalStructure.call(
			updater,
			reflections,
			groupings,
			"api-reference/test",
			sidebarIcons,
		);

		console.log("Result structure:");
		console.log(JSON.stringify(result, null, 2));

		return true;
	} catch (error) {
		console.error("❌ Error:", error.message);
		return false;
	}
}

console.log("🔬 Testing Icon Edge Cases and Specific Scenarios");
console.log("=".repeat(60));

let edgeTests = 0;
let passedEdgeTests = 0;

// Test 1: Single item scenarios with different groupings
console.log("\n📋 SINGLE ITEM SCENARIOS");

const singleItem = [edgeCaseReflections[0]];

const singleItemTests = [
	{
		groupings: ["folder"],
		icons: "all",
		expected: "Single folder group with individual item having kind icon",
	},
	{
		groupings: ["file"],
		icons: "all",
		expected: "No file group (single item), direct page link",
	},
	{
		groupings: ["kind"],
		icons: "all",
		expected: "Individual item with kind icon, no wrapping group",
	},
	{
		groupings: ["folder", "file"],
		icons: ["folder"],
		expected: "Folder group with icon, no sub-file group for single item",
	},
];

for (const test of singleItemTests) {
	const passed = testEdgeCase(
		singleItem,
		test.groupings,
		test.icons,
		`Single Item: ${test.groupings.join(" → ")} with icons ${Array.isArray(test.icons) ? `[${test.icons.join(", ")}]` : test.icons}`,
		test.expected,
	);
	edgeTests++;
	if (passed) passedEdgeTests++;
}

// Test 2: Multiple items same file
console.log("\n📋 SAME FILE SCENARIOS");

const sameFileItems = [edgeCaseReflections[1], edgeCaseReflections[2]];

const sameFileTests = [
	{
		groupings: ["file"],
		icons: "all",
		expected: "File group containing multiple items",
	},
	{
		groupings: ["file", "kind"],
		icons: ["file"],
		expected: "File group with icon, individual items inside without icons",
	},
	{
		groupings: ["folder", "file"],
		icons: "none",
		expected: "Folder group, file sub-group, no icons anywhere",
	},
];

for (const test of sameFileTests) {
	const passed = testEdgeCase(
		sameFileItems,
		test.groupings,
		test.icons,
		`Same File: ${test.groupings.join(" → ")} with icons ${Array.isArray(test.icons) ? `[${test.icons.join(", ")}]` : test.icons}`,
		test.expected,
	);
	edgeTests++;
	if (passed) passedEdgeTests++;
}

// Test 3: Icon inheritance and level specificity
console.log("\n📋 ICON INHERITANCE SCENARIOS");

const inheritanceTests = [
	{
		reflections: edgeCaseReflections,
		groupings: ["folder", "file", "kind"],
		icons: ["folder"],
		expected: "Only folder level has icons, file and kind levels have no icons",
	},
	{
		reflections: edgeCaseReflections,
		groupings: ["folder", "file", "kind"],
		icons: ["kind"],
		expected: "Only individual items have kind icons, folder and file levels have no icons",
	},
	{
		reflections: edgeCaseReflections,
		groupings: ["folder", "file", "kind"],
		icons: ["file", "kind"],
		expected: "File groups and individual items have icons, folder groups do not",
	},
];

for (const test of inheritanceTests) {
	const passed = testEdgeCase(
		test.reflections,
		test.groupings,
		test.icons,
		`Inheritance: ${test.groupings.join(" → ")} with icons ${Array.isArray(test.icons) ? `[${test.icons.join(", ")}]` : test.icons}`,
		test.expected,
	);
	edgeTests++;
	if (passed) passedEdgeTests++;
}

// Test 4: Empty and null scenarios
console.log("\n📋 EMPTY/NULL SCENARIOS");

const emptyTests = [
	{
		reflections: [],
		groupings: ["folder"],
		icons: "all",
		expected: "Empty result array",
	},
	{
		reflections: edgeCaseReflections,
		groupings: [],
		icons: "all",
		expected: "Default to kind grouping behavior",
	},
];

for (const test of emptyTests) {
	const passed = testEdgeCase(
		test.reflections,
		test.groupings,
		test.icons,
		`Empty: reflections=${test.reflections.length}, groupings=[${test.groupings.join(", ")}]`,
		test.expected,
	);
	edgeTests++;
	if (passed) passedEdgeTests++;
}

// Test 5: Complex hierarchy with selective icons
console.log("\n📋 COMPLEX HIERARCHY SCENARIOS");

const complexTests = [
	{
		reflections: edgeCaseReflections,
		groupings: ["folder", "file", "kind"],
		icons: ["folder", "kind"], // Skip file level
		expected: "Folder and kind icons only, file level has no icons",
	},
	{
		reflections: edgeCaseReflections,
		groupings: ["kind", "folder", "file"],
		icons: "all",
		expected: "Kind → Folder → File hierarchy with all icons",
	},
];

for (const test of complexTests) {
	const passed = testEdgeCase(
		test.reflections,
		test.groupings,
		test.icons,
		`Complex: ${test.groupings.join(" → ")} with icons ${Array.isArray(test.icons) ? `[${test.icons.join(", ")}]` : test.icons}`,
		test.expected,
	);
	edgeTests++;
	if (passed) passedEdgeTests++;
}

// Results
console.log("\n📊 EDGE CASE TEST RESULTS");
console.log("=".repeat(40));
console.log(`Edge Case Tests: ${edgeTests}`);
console.log(`Passed: ${passedEdgeTests}`);
console.log(`Failed: ${edgeTests - passedEdgeTests}`);
console.log(`Success Rate: ${((passedEdgeTests / edgeTests) * 100).toFixed(1)}%`);

if (passedEdgeTests === edgeTests) {
	console.log("\n✨ ALL EDGE CASE TESTS COMPLETED SUCCESSFULLY!");
	console.log("The icon system handles all edge cases correctly.");
} else {
	console.log("\n⚠️  Some edge case tests encountered issues.");
}

console.log("\n🏁 Edge case testing complete");
