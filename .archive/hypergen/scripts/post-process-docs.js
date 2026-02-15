#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const DOCS_ROOT = "../../apps/docs";
const TYPEDOCS_DIR = path.join(DOCS_ROOT, "typedocs");
const DOCS_JSON_PATH = path.join(DOCS_ROOT, "docs.json");

function addFrontmatter(filePath, relativePath) {
	const content = fs.readFileSync(filePath, "utf8");

	// Skip if already has frontmatter
	if (content.startsWith("---")) {
		return;
	}

	// Extract title from first heading
	const titleMatch = content.match(/^# (.+)$/m);
	const title = titleMatch ? titleMatch[1] : path.basename(filePath, ".md");

	// Create frontmatter
	const frontmatter = `---
title: "${title}"
description: "${title} API documentation"
---

`;

	// Write file with frontmatter
	fs.writeFileSync(filePath, frontmatter + content);
	console.log(`Added frontmatter to ${relativePath}`);
}

function processDirectory(dirPath, basePath = "") {
	const files = fs.readdirSync(dirPath);

	for (const file of files) {
		const fullPath = path.join(dirPath, file);
		const relativePath = path.join(basePath, file);

		if (fs.statSync(fullPath).isDirectory()) {
			processDirectory(fullPath, relativePath);
		} else if (path.extname(file) === ".md") {
			addFrontmatter(fullPath, relativePath);
		}
	}
}

function collectMarkdownFiles(dirPath, basePath = "typedocs", result = []) {
	const files = fs.readdirSync(dirPath);

	for (const file of files) {
		const fullPath = path.join(dirPath, file);
		const relativePath = path.join(basePath, file).replace(/\\/g, "/");

		if (fs.statSync(fullPath).isDirectory()) {
			collectMarkdownFiles(fullPath, relativePath, result);
		} else if (path.extname(file) === ".md") {
			// Convert to Mintlify page path (remove .md extension)
			const pagePath = relativePath.replace(/\.md$/, "");
			result.push(pagePath);
		}
	}

	return result;
}

function updateDocsJson() {
	const docsJson = JSON.parse(fs.readFileSync(DOCS_JSON_PATH, "utf8"));

	// Remove existing TypeDocs tab if it exists
	if (docsJson.navigation?.tabs) {
		docsJson.navigation.tabs = docsJson.navigation.tabs.filter((tab) => tab.tab !== "TypeDocs");
	}

	// Collect all markdown files and organize them
	const allPages = collectMarkdownFiles(TYPEDOCS_DIR);

	// Organize pages by category
	const pagesByCategory = {
		Overview: allPages.filter((p) => p.includes("/README") || p === "typedocs/README"),
		Classes: allPages.filter((p) => p.includes("/classes/")),
		Interfaces: allPages.filter((p) => p.includes("/interfaces/")),
		Functions: allPages.filter((p) => p.includes("/functions/")),
		Types: allPages.filter((p) => p.includes("/type-aliases/")),
		Variables: allPages.filter((p) => p.includes("/variables/")),
	};

	// Build groups for TypeDocs tab
	const groups = [];

	for (const [category, pages] of Object.entries(pagesByCategory)) {
		if (pages.length > 0) {
			groups.push({
				group: `📚 ${category}`,
				icon:
					category === "Overview"
						? "book-open"
						: category === "Classes"
							? "cube"
							: category === "Interfaces"
								? "shapes"
								: category === "Functions"
									? "code"
									: category === "Types"
										? "tags"
										: "variable",
				pages: pages.sort(),
			});
		}
	}

	// Add TypeDocs tab
	const typeDocsTab = {
		tab: "TypeDocs",
		groups: groups,
	};

	docsJson.navigation.tabs.push(typeDocsTab);

	// Write updated docs.json
	fs.writeFileSync(DOCS_JSON_PATH, JSON.stringify(docsJson, null, 2));
	console.log("Updated docs.json with TypeDocs navigation");
	console.log(`Added ${allPages.length} pages across ${groups.length} categories`);
}

function main() {
	console.log("Post-processing TypeDoc generated documentation...");

	if (!fs.existsSync(TYPEDOCS_DIR)) {
		console.error("TypeDocs directory not found. Run typedoc first.");
		process.exit(1);
	}

	// Add frontmatter to all markdown files
	console.log("Adding Mintlify frontmatter to markdown files...");
	processDirectory(TYPEDOCS_DIR);

	// Update docs.json with navigation
	console.log("Updating docs.json navigation...");
	updateDocsJson();

	console.log("✅ Post-processing complete!");
}

main();
