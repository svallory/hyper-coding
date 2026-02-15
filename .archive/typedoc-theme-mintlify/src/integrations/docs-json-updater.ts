/**
 * Mintlify docs.json integration for automatic navigation updates
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "fs";
import { resolve, relative, dirname, join, basename } from "path";
import { MarkdownApplication } from "typedoc-plugin-markdown";

export interface DocsJsonNavigationOptions {
	docsJsonPath: string;
	tabName: string;
	outputDirectory: string;
	projectName: string;
	navigationStrategy?: string[];
	sidebarIcons?: Array<"folder" | "file" | "kind"> | "all" | "none";
	includeFileExtensions?: boolean;
}

export interface MintlifyPage {
	group?: string;
	icon?: string;
	pages: (string | MintlifyPage)[];
}

export interface MintlifyTab {
	tab: string;
	groups: MintlifyPage[];
}

export interface MintlifyDocsJson {
	navigation: {
		tabs: MintlifyTab[];
	};
	[key: string]: any;
}

export interface ActualFileEntry {
	filePath: string;
	relativePath: string;
	baseName: string;
	directory: string;
	kind: string;
}

/**
 * Updates Mintlify docs.json with generated TypeDoc navigation structure
 */
export class DocsJsonUpdater {
	private options: DocsJsonNavigationOptions;

	constructor(options: DocsJsonNavigationOptions) {
		this.options = options;
	}

	/**
	 * Update the docs.json file with generated SDK navigation (legacy method)
	 */
	updateNavigation(app: MarkdownApplication, event?: any): void {
		try {
			const docsJson = this.loadDocsJson();
			const navigationStructure = this.generateNavigationStructure(app, event);

			this.updateSdkReferenceTab(docsJson, navigationStructure);
			this.saveDocsJson(docsJson);

			console.log(`✅ Updated ${this.options.docsJsonPath} with SDK navigation`);
		} catch (error) {
			console.warn(`⚠️  Failed to update docs.json: ${error}`);
		}
	}

	/**
	 * Update the docs.json file with generated SDK navigation using captured project reference
	 */
	updateNavigationWithProject(app: MarkdownApplication, event: any, project: any): void {
		try {
			const docsJson = this.loadDocsJson();
			const navigationStructure = this.generateNavigationStructureWithProject(app, event, project);

			this.updateSdkReferenceTab(docsJson, navigationStructure);
			this.saveDocsJson(docsJson);

			console.log(`✅ Updated ${this.options.docsJsonPath} with SDK navigation using project data`);
		} catch (error) {
			console.warn(`⚠️  Failed to update docs.json: ${error}`);
		}
	}

	/**
	 * Post-generation navigation update that scans actual output files
	 * This eliminates broken links by only creating navigation for files that actually exist
	 */
	updateNavigationPostGeneration(): void {
		try {
			const docsJson = this.loadDocsJson();
			const navigationStructure = this.generatePostGenerationNavigation();

			this.updateSdkReferenceTab(docsJson, navigationStructure);
			this.saveDocsJson(docsJson);

			console.log(
				`✅ Updated ${this.options.docsJsonPath} with post-generation navigation (files verified to exist)`,
			);
		} catch (error) {
			console.warn(`⚠️  Failed to update docs.json with post-generation navigation: ${error}`);
		}
	}

	/**
	 * Generate navigation structure based on actual files that exist
	 * This post-generation approach eliminates broken links
	 */
	private generatePostGenerationNavigation(): (string | MintlifyPage)[] {
		const pages: (string | MintlifyPage)[] = [];
		const docsJsonDir = dirname(this.options.docsJsonPath);
		const relativeOutputPath = relative(docsJsonDir, this.options.outputDirectory);
		const navigationStrategy = this.options.navigationStrategy || ["folder", "file"];
		const sidebarIcons = this.options.sidebarIcons || "all";

		// Add main overview page first (if it exists)
		const readmePath = resolve(this.options.outputDirectory, "README.mdx");
		if (existsSync(readmePath)) {
			pages.push(`${relativeOutputPath}/README`);
		}

		// Scan actual output directory for generated files
		const actualFiles = this.scanActualOutputFiles();

		if (actualFiles.length === 0) {
			console.warn("No MDX files found in output directory for navigation generation");
			return pages;
		}

		// Build navigation structure using actual files
		const hierarchicalPages = this.buildNavigationFromActualFiles(
			actualFiles,
			navigationStrategy,
			relativeOutputPath,
			sidebarIcons,
		);

		pages.push(...hierarchicalPages);

		console.log(`Generated post-generation navigation for ${actualFiles.length} actual files`);
		return pages;
	}

	/**
	 * Load and parse the docs.json file
	 */
	private loadDocsJson(): MintlifyDocsJson {
		const content = readFileSync(this.options.docsJsonPath, "utf8");
		return JSON.parse(content);
	}

	/**
	 * Recursively scan the output directory for actual MDX files
	 */
	private scanActualOutputFiles(): ActualFileEntry[] {
		const files: ActualFileEntry[] = [];
		const docsJsonDir = dirname(this.options.docsJsonPath);

		const scanDirectory = (dirPath: string): void => {
			try {
				const entries = readdirSync(dirPath);

				for (const entry of entries) {
					const fullPath = join(dirPath, entry);
					const stat = statSync(fullPath);

					if (stat.isDirectory()) {
						// Recursively scan subdirectories
						scanDirectory(fullPath);
					} else if (stat.isFile() && entry.endsWith(".mdx")) {
						// Skip README.mdx as it's handled separately
						if (entry === "README.mdx") continue;

						const relativePath = relative(docsJsonDir, fullPath);
						const relativePathWithoutExt = relativePath.replace(".mdx", "");
						const baseName = basename(entry, ".mdx");
						const directory = dirname(relativePath);

						// Infer kind from directory structure
						const kind = this.inferKindFromPath(fullPath);

						files.push({
							filePath: fullPath,
							relativePath: relativePathWithoutExt,
							baseName,
							directory,
							kind,
						});
					}
				}
			} catch (error) {
				console.warn(`Failed to scan directory ${dirPath}:`, error);
			}
		};

		scanDirectory(this.options.outputDirectory);
		return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
	}

	/**
	 * Infer the TypeDoc kind from the file path
	 */
	private inferKindFromPath(filePath: string): string {
		const pathLower = filePath.toLowerCase();

		if (pathLower.includes("/classes/")) return "Class";
		if (pathLower.includes("/interfaces/")) return "Interface";
		if (pathLower.includes("/functions/")) return "Function";
		if (pathLower.includes("/type-aliases/")) return "TypeAlias";
		if (pathLower.includes("/variables/")) return "Variable";
		if (pathLower.includes("/enumerations/")) return "Enum";
		if (pathLower.includes("/modules/")) return "Module";
		if (pathLower.includes("/namespaces/")) return "Namespace";

		return "Unknown";
	}

	/**
	 * Build navigation structure from actual files that exist
	 */
	private buildNavigationFromActualFiles(
		files: ActualFileEntry[],
		strategies: string[],
		relativeOutputPath: string,
		sidebarIcons: Array<"folder" | "file" | "kind"> | "all" | "none",
	): (string | MintlifyPage)[] {
		if (files.length === 0) return [];

		// Convert actual files to a format similar to the reflection data structure
		const fileData = files.map((file) => ({
			file: file,
			folder: this.extractFolderFromPath(file.relativePath),
			fileName: this.extractFileNameFromPath(file.relativePath),
			kind: file.kind,
			kindIcon: this.getKindIcon(file.kind),
			generatedPath: file.relativePath,
			name: file.baseName,
		}));

		// Use the same hierarchical building logic as before, but with actual files
		return this.buildHierarchicalStructureFromFiles(
			fileData,
			strategies,
			relativeOutputPath,
			sidebarIcons,
		);
	}

	/**
	 * Extract folder information from file path for navigation grouping
	 */
	private extractFolderFromPath(relativePath: string): string {
		const parts = relativePath.split("/");

		// Remove the file name and the kind directory (classes, interfaces, etc.)
		if (parts.length >= 2) {
			// For paths like "recipe-engine/classes/ActionTool", extract "recipe-engine"
			return parts.slice(0, -2).join("/") || "root";
		}

		return "root";
	}

	/**
	 * Extract file name information from path for navigation grouping
	 */
	private extractFileNameFromPath(relativePath: string): string {
		const parts = relativePath.split("/");

		// Look for patterns that indicate the source file
		// For "recipe-engine/classes/ActionTool", we want "action-tool"
		if (parts.length >= 2) {
			const baseName = parts[parts.length - 1];
			// Convert PascalCase to kebab-case for file name inference
			return baseName
				.replace(/([A-Z])/g, "-$1")
				.toLowerCase()
				.replace(/^-/, "");
		}

		return parts[parts.length - 1];
	}

	/**
	 * Get icon for a TypeDoc kind
	 */
	private getKindIcon(kind: string): string {
		const kindMap: { [key: string]: string } = {
			Class: "cube",
			Interface: "plug",
			Function: "bolt",
			TypeAlias: "file-text",
			Variable: "package",
			Enum: "list",
			Module: "folder",
			Namespace: "folder",
		};

		return kindMap[kind] || "circle";
	}

	/**
	 * Build hierarchical structure from actual files (similar to existing logic but for real files)
	 */
	private buildHierarchicalStructureFromFiles(
		fileData: Array<{
			file: ActualFileEntry;
			folder: string;
			fileName: string;
			kind: string;
			kindIcon: string;
			generatedPath: string;
			name: string;
		}>,
		strategies: string[],
		relativeOutputPath: string,
		sidebarIcons: Array<"folder" | "file" | "kind"> | "all" | "none",
	): (string | MintlifyPage)[] {
		if (strategies.length === 0) {
			// Default to kind-based if no strategies specified
			return this.groupFilesByKind(fileData, [], relativeOutputPath, sidebarIcons);
		}

		// Group files by the first strategy
		const firstStrategy = strategies[0];
		const remainingStrategies = strategies.slice(1);

		if (firstStrategy === "folder") {
			return this.groupFilesByFolder(
				fileData,
				remainingStrategies,
				relativeOutputPath,
				sidebarIcons,
			);
		} else if (firstStrategy === "file") {
			return this.groupFilesByFile(fileData, remainingStrategies, relativeOutputPath, sidebarIcons);
		} else if (firstStrategy === "kind") {
			return this.groupFilesByKind(fileData, remainingStrategies, relativeOutputPath, sidebarIcons);
		}

		// Default fallback to kind-based
		return this.groupFilesByKind(fileData, [], relativeOutputPath, sidebarIcons);
	}

	/**
	 * Group actual files by folder structure
	 */
	private groupFilesByFolder(
		fileData: any[],
		remainingStrategies: string[],
		relativeOutputPath: string,
		sidebarIcons: Array<"folder" | "file" | "kind"> | "all" | "none",
	): (string | MintlifyPage)[] {
		const folderGroups = new Map<string, any[]>();

		fileData.forEach((item) => {
			if (!folderGroups.has(item.folder)) {
				folderGroups.set(item.folder, []);
			}
			folderGroups.get(item.folder)!.push(item);
		});

		const pages: (string | MintlifyPage)[] = [];

		for (const [folderName, items] of folderGroups.entries()) {
			if (remainingStrategies.length === 0) {
				// Final level - create items with icons if enabled
				let folderPages: (string | MintlifyPage)[];

				if (
					sidebarIcons === "all" ||
					(Array.isArray(sidebarIcons) && sidebarIcons.includes("kind"))
				) {
					// Add individual item icons
					folderPages = items.map((item) => ({
						group: item.name,
						icon: item.kindIcon,
						pages: [item.generatedPath],
					}));
				} else {
					// Simple string pages
					folderPages = items.map((item) => item.generatedPath);
				}

				const folderGroup: MintlifyPage = {
					group: this.formatFolderDisplayName(folderName),
					pages: folderPages,
				};

				if (
					sidebarIcons === "all" ||
					(Array.isArray(sidebarIcons) && sidebarIcons.includes("folder"))
				) {
					folderGroup.icon = "folder";
				}

				pages.push(folderGroup);
			} else {
				// Recurse with remaining strategies
				const subPages = this.buildHierarchicalStructureFromFiles(
					items,
					remainingStrategies,
					relativeOutputPath,
					sidebarIcons,
				);

				const folderGroup: MintlifyPage = {
					group: this.formatFolderDisplayName(folderName),
					pages: subPages,
				};

				if (
					sidebarIcons === "all" ||
					(Array.isArray(sidebarIcons) && sidebarIcons.includes("folder"))
				) {
					folderGroup.icon = "folder";
				}

				pages.push(folderGroup);
			}
		}

		return pages;
	}

	/**
	 * Group actual files by file name
	 */
	private groupFilesByFile(
		fileData: any[],
		remainingStrategies: string[],
		relativeOutputPath: string,
		sidebarIcons: Array<"folder" | "file" | "kind"> | "all" | "none",
	): (string | MintlifyPage)[] {
		const fileGroups = new Map<string, any[]>();

		fileData.forEach((item) => {
			if (!fileGroups.has(item.fileName)) {
				fileGroups.set(item.fileName, []);
			}
			fileGroups.get(item.fileName)!.push(item);
		});

		const pages: (string | MintlifyPage)[] = [];

		for (const [fileName, items] of fileGroups.entries()) {
			if (remainingStrategies.length === 0) {
				// Final level - if single item, don't group; if multiple, group by file
				if (items.length === 1) {
					pages.push(items[0].generatedPath);
				} else {
					const fileGroup: MintlifyPage = {
						group: fileName,
						pages: items.map((item) => item.generatedPath),
					};

					if (
						sidebarIcons === "all" ||
						(Array.isArray(sidebarIcons) && sidebarIcons.includes("file"))
					) {
						fileGroup.icon = "file";
					}

					pages.push(fileGroup);
				}
			} else {
				// Recurse with remaining strategies
				const subPages = this.buildHierarchicalStructureFromFiles(
					items,
					remainingStrategies,
					relativeOutputPath,
					sidebarIcons,
				);

				if (subPages.length === 1 && typeof subPages[0] === "string") {
					// Single item, don't create unnecessary group
					pages.push(subPages[0]);
				} else {
					const fileGroup: MintlifyPage = {
						group: fileName,
						pages: subPages,
					};

					if (
						sidebarIcons === "all" ||
						(Array.isArray(sidebarIcons) && sidebarIcons.includes("file"))
					) {
						fileGroup.icon = "file";
					}

					pages.push(fileGroup);
				}
			}
		}

		return pages;
	}

	/**
	 * Group actual files by TypeDoc kind
	 */
	private groupFilesByKind(
		fileData: any[],
		remainingStrategies: string[],
		relativeOutputPath: string,
		sidebarIcons: Array<"folder" | "file" | "kind"> | "all" | "none",
	): (string | MintlifyPage)[] {
		const kindGroups = new Map<string, any[]>();

		fileData.forEach((item) => {
			if (!kindGroups.has(item.kind)) {
				kindGroups.set(item.kind, []);
			}
			kindGroups.get(item.kind)!.push(item);
		});

		const pages: (string | MintlifyPage)[] = [];
		const kindToIcon: { [key: string]: string } = {
			Class: "cube",
			Interface: "plug",
			Function: "bolt",
			TypeAlias: "file-text",
			Variable: "package",
			Enum: "list",
		};

		for (const [kindName, items] of kindGroups.entries()) {
			if (remainingStrategies.length === 0) {
				// Final level - create individual items with icons if needed
				if (
					sidebarIcons === "all" ||
					(Array.isArray(sidebarIcons) && sidebarIcons.includes("kind"))
				) {
					// Individual items with icons
					const itemsWithIcons = items.map((item) => ({
						group: item.name,
						icon: item.kindIcon,
						pages: [item.generatedPath],
					}));
					pages.push(...itemsWithIcons);
				} else {
					// Simple string pages
					pages.push(...items.map((item) => item.generatedPath));
				}
			} else {
				// Recurse with remaining strategies
				const subPages = this.buildHierarchicalStructureFromFiles(
					items,
					remainingStrategies,
					relativeOutputPath,
					sidebarIcons,
				);

				const kindGroup: MintlifyPage = {
					group: this.formatKindName(kindName),
					pages: subPages,
				};

				if (
					sidebarIcons === "all" ||
					(Array.isArray(sidebarIcons) && sidebarIcons.includes("kind"))
				) {
					kindGroup.icon = kindToIcon[kindName] || "circle";
				}

				pages.push(kindGroup);
			}
		}

		return pages;
	}

	/**
	 * Save the updated docs.json file
	 */
	private saveDocsJson(docsJson: MintlifyDocsJson): void {
		const content = JSON.stringify(docsJson, null, 2);
		writeFileSync(this.options.docsJsonPath, content, "utf8");
	}

	/**
	 * Generate navigation structure using captured project reference for reliable reflection data
	 */
	private generateNavigationStructureWithProject(
		app: MarkdownApplication,
		event: any,
		project: any,
	): (string | MintlifyPage)[] {
		const pages: (string | MintlifyPage)[] = [];
		const docsJsonDir = dirname(this.options.docsJsonPath);
		const relativeOutputPath = relative(docsJsonDir, this.options.outputDirectory);
		const navigationStrategy = this.options.navigationStrategy || ["folder", "file"];
		const sidebarIcons = this.options.sidebarIcons || "all";

		// Add main overview page first
		pages.push(`${relativeOutputPath}/README`);

		if (!project) {
			console.warn("No project reference available, falling back to directory-based navigation");
			return [
				...pages,
				...this.getFallbackNavigation(relativeOutputPath, navigationStrategy, sidebarIcons),
			];
		}

		// Get reflections with reliable project access
		const reflections = this.organizeReflectionsFromProject(project);

		if (reflections.length === 0) {
			console.warn("No reflections found in project, falling back to directory-based navigation");
			return [
				...pages,
				...this.getFallbackNavigation(relativeOutputPath, navigationStrategy, sidebarIcons),
			];
		}

		// Apply strategies to build hierarchy with reliable TypeDoc data
		const hierarchicalPages = this.buildHierarchicalStructure(
			reflections,
			navigationStrategy,
			relativeOutputPath,
			sidebarIcons,
		);
		pages.push(...hierarchicalPages);

		console.log(
			`Generated navigation for ${reflections.length} reflections using project reference`,
		);
		return pages;
	}

	/**
	 * Generate the hierarchical navigation structure based on configured strategy
	 * Supports 'folder', 'file', and 'kind' organization strategies
	 */
	private generateNavigationStructure(
		app?: MarkdownApplication,
		event?: any,
	): (string | MintlifyPage)[] {
		const pages: (string | MintlifyPage)[] = [];
		const docsJsonDir = dirname(this.options.docsJsonPath);
		const relativeOutputPath = relative(docsJsonDir, this.options.outputDirectory);
		const navigationStrategy = this.options.navigationStrategy || ["folder", "file"];
		const sidebarIcons = this.options.sidebarIcons || "all";

		// Add main overview page first
		pages.push(`${relativeOutputPath}/README`);

		// Generate hierarchical navigation by layering strategies
		const hierarchicalPages = this.generateHierarchicalNavigation(
			relativeOutputPath,
			navigationStrategy,
			sidebarIcons,
			app,
			event,
		);

		pages.push(...hierarchicalPages);
		return pages;
	}

	/**
	 * Generate hierarchical navigation by layering strategies
	 */
	private generateHierarchicalNavigation(
		relativeOutputPath: string,
		navigationStrategy: string[],
		sidebarIcons: Array<"folder" | "file" | "kind"> | "all" | "none",
		app?: MarkdownApplication,
		event?: any,
	): (string | MintlifyPage)[] {
		// Try to get project from event first (most reliable)
		let project = event?.project;

		if (!project && !app) {
			// Fallback to directory-based navigation respecting the configured strategy
			return this.getFallbackNavigation(relativeOutputPath, navigationStrategy, sidebarIcons);
		}

		// Get all reflections organized by their metadata
		const reflections = this.organizeReflections(app, project);

		// If we couldn't organize reflections (no TypeDoc data), use fallback
		if (reflections.length === 0) {
			console.warn("No TypeDoc reflection data available, using fallback navigation");
			return this.getFallbackNavigation(relativeOutputPath, navigationStrategy, sidebarIcons);
		}

		// Apply strategies in order to build hierarchy with actual TypeDoc data
		return this.buildHierarchicalStructure(
			reflections,
			navigationStrategy,
			relativeOutputPath,
			sidebarIcons,
		);
	}

	/**
	 * Organize reflections using direct project reference for most reliable access
	 */
	private organizeReflectionsFromProject(project: any) {
		if (!project || typeof project.getReflectionsByKind !== "function") {
			console.warn("Project reference invalid - cannot organize reflections by source files");
			return [];
		}

		const reflectionData: Array<{
			reflection: any;
			folder: string;
			file: string;
			kind: string;
			kindIcon: string;
			generatedPath: string;
			name: string;
		}> = [];

		project.getReflectionsByKind(-1).forEach((reflection: any) => {
			if (!reflection.sources || reflection.sources.length === 0) return;

			const source = reflection.sources[0];
			if (!source.fileName) return;

			// Extract folder and file from source path
			const pathParts = source.fileName.replace(/^src\//, "").split("/");
			const folder = pathParts.length > 1 ? pathParts[0] : "root";
			const fileName = pathParts[pathParts.length - 1];
			const fileWithoutExt = fileName.replace(/\.(ts|js|tsx|jsx)$/, "");

			const generatedPath = this.getGeneratedPathForReflection(reflection);
			if (!generatedPath) return;

			const kindName = this.getReflectionKindName(reflection.kind);
			const kindIcon = this.getReflectionKind(reflection);

			reflectionData.push({
				reflection,
				folder,
				file: this.options.includeFileExtensions ? fileName : fileWithoutExt,
				kind: kindName,
				kindIcon,
				generatedPath,
				name: reflection.name,
			});
		});

		console.log(`Organized ${reflectionData.length} reflections from direct project reference`);
		return reflectionData;
	}

	/**
	 * Organize reflections by their metadata (folder, file, kind)
	 */
	private organizeReflections(app?: MarkdownApplication, project?: any) {
		// Use the project directly if provided from the event
		if (!project && app) {
			// Try multiple ways to access the TypeDoc project
			if ((app as any).project && typeof (app as any).project.getReflectionsByKind === "function") {
				project = (app as any).project;
			}
			// Method 2: Via converter
			else if (
				app.converter &&
				(app.converter as any).project &&
				typeof (app.converter as any).project.getReflectionsByKind === "function"
			) {
				project = (app.converter as any).project;
			}
			// Method 3: Via renderer
			else if (
				app.renderer &&
				(app.renderer as any).project &&
				typeof (app.renderer as any).project.getReflectionsByKind === "function"
			) {
				project = (app.renderer as any).project;
			}
		}

		if (!project || typeof project.getReflectionsByKind !== "function") {
			console.warn("TypeDoc project not accessible - cannot organize reflections by source files");
			return [];
		}

		const reflectionData: Array<{
			reflection: any;
			folder: string;
			file: string;
			kind: string;
			kindIcon: string;
			generatedPath: string;
			name: string;
		}> = [];

		project.getReflectionsByKind(-1).forEach((reflection: any) => {
			if (!reflection.sources || reflection.sources.length === 0) return;

			const source = reflection.sources[0];
			if (!source.fileName) return;

			// Extract folder and file from source path
			const pathParts = source.fileName.replace(/^src\//, "").split("/");
			const folder = pathParts.length > 1 ? pathParts[0] : "root";
			const fileName = pathParts[pathParts.length - 1];
			const fileWithoutExt = fileName.replace(/\.(ts|js|tsx|jsx)$/, "");

			const generatedPath = this.getGeneratedPathForReflection(reflection);
			if (!generatedPath) return;

			const kindName = this.getReflectionKindName(reflection.kind);
			const kindIcon = this.getReflectionKind(reflection);

			reflectionData.push({
				reflection,
				folder,
				file: this.options.includeFileExtensions ? fileName : fileWithoutExt,
				kind: kindName,
				kindIcon,
				generatedPath,
				name: reflection.name,
			});
		});

		console.log(`Organized ${reflectionData.length} reflections from TypeDoc project data`);
		return reflectionData;
	}

	/**
	 * Build hierarchical structure based on navigation strategies
	 * This method assumes we have valid TypeDoc reflection data
	 */
	private buildHierarchicalStructure(
		reflections: Array<{
			reflection: any;
			folder: string;
			file: string;
			kind: string;
			kindIcon: string;
			generatedPath: string;
			name: string;
		}>,
		strategies: string[],
		relativeOutputPath: string,
		sidebarIcons: Array<"folder" | "file" | "kind"> | "all" | "none",
	): (string | MintlifyPage)[] {
		if (strategies.length === 0) {
			// Default to kind-based if no strategies specified
			return this.groupByKind(reflections, [], relativeOutputPath, sidebarIcons);
		}

		// Group reflections by the first strategy
		const firstStrategy = strategies[0];
		const remainingStrategies = strategies.slice(1);

		if (firstStrategy === "folder") {
			return this.groupByFolder(reflections, remainingStrategies, relativeOutputPath, sidebarIcons);
		} else if (firstStrategy === "file") {
			return this.groupByFile(reflections, remainingStrategies, relativeOutputPath, sidebarIcons);
		} else if (firstStrategy === "kind") {
			return this.groupByKind(reflections, remainingStrategies, relativeOutputPath, sidebarIcons);
		}

		// Default fallback to kind-based with TypeDoc data
		return this.groupByKind(reflections, [], relativeOutputPath, sidebarIcons);
	}

	/**
	 * Group reflections by folder
	 */
	private groupByFolder(
		reflections: any[],
		remainingStrategies: string[],
		relativeOutputPath: string,
		sidebarIcons: Array<"folder" | "file" | "kind"> | "all" | "none",
	): (string | MintlifyPage)[] {
		const folderGroups = new Map<string, any[]>();

		reflections.forEach((item) => {
			if (!folderGroups.has(item.folder)) {
				folderGroups.set(item.folder, []);
			}
			folderGroups.get(item.folder)!.push(item);
		});

		const pages: (string | MintlifyPage)[] = [];

		for (const [folderName, items] of folderGroups.entries()) {
			if (remainingStrategies.length === 0) {
				// Final level - create items with icons if enabled
				let folderPages: (string | MintlifyPage)[];

				if (
					sidebarIcons === "all" ||
					(Array.isArray(sidebarIcons) && sidebarIcons.includes("kind"))
				) {
					// Add individual item icons
					folderPages = items.map((item) => ({
						group: item.name,
						icon: item.kindIcon,
						pages: [`${relativeOutputPath}/${item.generatedPath}`],
					}));
				} else {
					// Simple string pages
					folderPages = items.map((item) => `${relativeOutputPath}/${item.generatedPath}`);
				}

				const folderGroup: MintlifyPage = {
					group: this.formatFolderDisplayName(folderName),
					pages: folderPages,
				};

				if (
					sidebarIcons === "all" ||
					(Array.isArray(sidebarIcons) && sidebarIcons.includes("folder"))
				) {
					folderGroup.icon = "folder";
				}

				pages.push(folderGroup);
			} else {
				// Recurse with remaining strategies for proper hierarchical grouping
				const subPages = this.buildHierarchicalStructure(
					items,
					remainingStrategies,
					relativeOutputPath,
					sidebarIcons,
				);

				const folderGroup: MintlifyPage = {
					group: this.formatFolderDisplayName(folderName),
					pages: subPages,
				};

				if (
					sidebarIcons === "all" ||
					(Array.isArray(sidebarIcons) && sidebarIcons.includes("folder"))
				) {
					folderGroup.icon = "folder";
				}

				pages.push(folderGroup);
			}
		}

		return pages;
	}

	/**
	 * Group reflections by file
	 */
	private groupByFile(
		reflections: any[],
		remainingStrategies: string[],
		relativeOutputPath: string,
		sidebarIcons: Array<"folder" | "file" | "kind"> | "all" | "none",
	): (string | MintlifyPage)[] {
		const fileGroups = new Map<string, any[]>();

		reflections.forEach((item) => {
			if (!fileGroups.has(item.file)) {
				fileGroups.set(item.file, []);
			}
			fileGroups.get(item.file)!.push(item);
		});

		const pages: (string | MintlifyPage)[] = [];

		for (const [fileName, items] of fileGroups.entries()) {
			if (remainingStrategies.length === 0) {
				// Final level - if single item, don't group; if multiple, group by file
				if (items.length === 1) {
					pages.push(`${relativeOutputPath}/${items[0].generatedPath}`);
				} else {
					const fileGroup: MintlifyPage = {
						group: fileName,
						pages: items.map((item) => `${relativeOutputPath}/${item.generatedPath}`),
					};

					if (
						sidebarIcons === "all" ||
						(Array.isArray(sidebarIcons) && sidebarIcons.includes("file"))
					) {
						fileGroup.icon = "file";
					}

					pages.push(fileGroup);
				}
			} else {
				// Recurse with remaining strategies
				const subPages = this.buildHierarchicalStructure(
					items,
					remainingStrategies,
					relativeOutputPath,
					sidebarIcons,
				);

				if (subPages.length === 1 && typeof subPages[0] === "string") {
					// Single item, don't create unnecessary group
					pages.push(subPages[0]);
				} else {
					const fileGroup: MintlifyPage = {
						group: fileName,
						pages: subPages,
					};

					if (
						sidebarIcons === "all" ||
						(Array.isArray(sidebarIcons) && sidebarIcons.includes("file"))
					) {
						fileGroup.icon = "file";
					}

					pages.push(fileGroup);
				}
			}
		}

		return pages;
	}

	/**
	 * Group reflections by kind
	 */
	private groupByKind(
		reflections: any[],
		remainingStrategies: string[],
		relativeOutputPath: string,
		sidebarIcons: Array<"folder" | "file" | "kind"> | "all" | "none",
	): (string | MintlifyPage)[] {
		const kindGroups = new Map<string, any[]>();

		reflections.forEach((item) => {
			if (!kindGroups.has(item.kind)) {
				kindGroups.set(item.kind, []);
			}
			kindGroups.get(item.kind)!.push(item);
		});

		const pages: (string | MintlifyPage)[] = [];
		const kindToIcon: { [key: string]: string } = {
			Class: "cube",
			Interface: "plug",
			Function: "bolt",
			TypeAlias: "file-text",
			Variable: "package",
			Enum: "list",
		};

		for (const [kindName, items] of kindGroups.entries()) {
			if (remainingStrategies.length === 0) {
				// Final level - create individual items with icons if needed
				if (
					sidebarIcons === "all" ||
					(Array.isArray(sidebarIcons) && sidebarIcons.includes("kind"))
				) {
					// Individual items with icons
					const itemsWithIcons = items.map((item) => ({
						group: item.name,
						icon: item.kindIcon,
						pages: [`${relativeOutputPath}/${item.generatedPath}`],
					}));
					pages.push(...itemsWithIcons);
				} else {
					// Simple string pages
					pages.push(...items.map((item) => `${relativeOutputPath}/${item.generatedPath}`));
				}
			} else {
				// Recurse with remaining strategies
				const subPages = this.buildHierarchicalStructure(
					items,
					remainingStrategies,
					relativeOutputPath,
					sidebarIcons,
				);

				const kindGroup: MintlifyPage = {
					group: this.formatKindName(kindName),
					pages: subPages,
				};

				if (
					sidebarIcons === "all" ||
					(Array.isArray(sidebarIcons) && sidebarIcons.includes("kind"))
				) {
					kindGroup.icon = kindToIcon[kindName] || "circle";
				}

				pages.push(kindGroup);
			}
		}

		return pages;
	}

	/**
	 * Format kind name for display
	 */
	private formatKindName(kindName: string): string {
		const kindMap: { [key: string]: string } = {
			Class: "Classes",
			Interface: "Interfaces",
			Function: "Functions",
			TypeAlias: "Types",
			Variable: "Variables",
			Enum: "Enums",
		};

		return kindMap[kindName] || kindName + "s";
	}

	/**
	 * Fallback navigation when TypeDoc reflection data isn't available
	 * STRICTLY ENFORCES configuration or fails with clear error
	 */
	private getFallbackNavigation(
		relativeOutputPath: string,
		strategies: string[],
		sidebarIcons: Array<"folder" | "file" | "kind"> | "all" | "none",
	): (string | MintlifyPage)[] {
		// STRICT COMPLIANCE: Multi-grouping requires reflection data
		if (strategies.length > 1) {
			const error = `❌ CONFIGURATION ERROR: Multi-grouping navigation [${strategies.join(", ")}] requires TypeDoc reflection data, but it's not accessible.

POSSIBLE SOLUTIONS:
1. Check if TypeDoc is generating reflection data properly
2. Ensure the plugin is being called at the right time in the TypeDoc lifecycle  
3. Try using single grouping instead: ["${strategies[0]}"]
4. If this is a bug, please report it with your TypeDoc configuration

Current configuration: mintlifyNavigation: [${strategies.join(", ")}]
Required: TypeDoc reflection data for folder/file source mapping`;

			console.error(error);
			throw new Error(
				`Multi-grouping navigation [${strategies.join(", ")}] requires TypeDoc reflection data`,
			);
		}

		const firstStrategy = strategies[0] || "kind";
		console.warn(`⚠️  Using simplified fallback navigation for single grouping: "${firstStrategy}"`);

		if (firstStrategy === "folder") {
			return this.getFolderBasedFallback(relativeOutputPath, sidebarIcons);
		} else if (firstStrategy === "file") {
			return this.getFileBasedFallback(relativeOutputPath, sidebarIcons);
		} else {
			return this.getKindBasedGroups(relativeOutputPath, sidebarIcons);
		}
	}

	/**
	 * Create folder-based navigation from directory structure
	 */
	private getFolderBasedFallback(
		relativeOutputPath: string,
		sidebarIcons: Array<"folder" | "file" | "kind"> | "all" | "none",
	): (string | MintlifyPage)[] {
		// For folder-based fallback, we infer source folders from class/interface names
		// and create direct folder groups without intermediate kind grouping
		const pages: (string | MintlifyPage)[] = [];
		const folderGroups = new Map<string, string[]>();

		const categories = [
			{ type: "classes", icon: "cube" },
			{ type: "interfaces", icon: "plug" },
			{ type: "functions", icon: "bolt" },
			{ type: "type-aliases", icon: "file-text" },
			{ type: "variables", icon: "package" },
		];

		// Collect all pages and try to infer their source folders
		for (const category of categories) {
			const categoryPages = this.getPagesByType(category.type, relativeOutputPath);

			for (const page of categoryPages) {
				const fileName = this.getPageTitle(page);
				// Infer folder from common patterns in class/interface names
				const inferredFolder = this.inferSourceFolder(fileName);

				if (!folderGroups.has(inferredFolder)) {
					folderGroups.set(inferredFolder, []);
				}

				// Add pages directly to folder groups - no unnecessary nesting
				folderGroups.get(inferredFolder)!.push(page);
			}
		}

		// Create folder groups - these are the top-level organization
		for (const [folderName, items] of folderGroups.entries()) {
			if (items.length === 0) continue;

			const folderGroup: MintlifyPage = {
				group: this.formatFolderDisplayName(folderName),
				pages: items,
			};

			if (
				sidebarIcons === "all" ||
				(Array.isArray(sidebarIcons) && sidebarIcons.includes("folder"))
			) {
				folderGroup.icon = "folder";
			}

			pages.push(folderGroup);
		}

		return pages.length > 0 ? pages : this.getKindBasedGroups(relativeOutputPath, sidebarIcons);
	}

	/**
	 * Infer source folder from class/interface name patterns
	 */
	private inferSourceFolder(itemName: string): string {
		// Common patterns to infer folders
		if (itemName.includes("Recipe") || itemName.includes("Step")) {
			return "recipe-engine";
		} else if (itemName.includes("Action") || itemName.includes("Tool")) {
			return "actions";
		} else if (itemName.includes("Config") || itemName.includes("Setting")) {
			return "config";
		} else if (itemName.includes("Template")) {
			return "template-engines";
		} else if (itemName.includes("Error") || itemName.includes("Logger")) {
			return "errors";
		} else if (itemName.includes("Validation") || itemName.includes("Validator")) {
			return "validation";
		} else {
			return "core";
		}
	}

	/**
	 * Create file-based navigation fallback
	 */
	private getFileBasedFallback(
		relativeOutputPath: string,
		sidebarIcons: Array<"folder" | "file" | "kind"> | "all" | "none",
	): (string | MintlifyPage)[] {
		// For file-based fallback without reflection data, we'll group by inferred file names
		const pages: (string | MintlifyPage)[] = [];
		const fileGroups = new Map<string, string[]>();

		const categories = [
			{ type: "classes", icon: "cube" },
			{ type: "interfaces", icon: "plug" },
			{ type: "functions", icon: "bolt" },
			{ type: "type-aliases", icon: "file-text" },
			{ type: "variables", icon: "package" },
		];

		// Group by inferred file names
		for (const category of categories) {
			const categoryPages = this.getPagesByType(category.type, relativeOutputPath);

			for (const page of categoryPages) {
				const fileName = this.getPageTitle(page);
				// Convert class name to likely file name (e.g., ActionTool -> action-tool.ts)
				const inferredFile = this.inferFileName(fileName);

				if (!fileGroups.has(inferredFile)) {
					fileGroups.set(inferredFile, []);
				}
				fileGroups.get(inferredFile)!.push(page);
			}
		}

		// Create file groups
		for (const [fileName, items] of fileGroups.entries()) {
			if (items.length === 0) continue;

			if (items.length === 1) {
				pages.push(items[0]);
			} else {
				const fileGroup: MintlifyPage = {
					group: fileName,
					pages: items,
				};

				if (
					sidebarIcons === "all" ||
					(Array.isArray(sidebarIcons) && sidebarIcons.includes("file"))
				) {
					fileGroup.icon = "file";
				}

				pages.push(fileGroup);
			}
		}

		return pages.length > 0 ? pages : this.getKindBasedGroups(relativeOutputPath, sidebarIcons);
	}

	/**
	 * Infer likely file name from class/interface name
	 */
	private inferFileName(itemName: string): string {
		// Convert PascalCase to kebab-case for likely file name
		const kebabCase = itemName
			.replace(/([A-Z])/g, "-$1")
			.toLowerCase()
			.replace(/^-/, "");

		return this.options.includeFileExtensions ? `${kebabCase}.ts` : kebabCase;
	}

	/**
	 * Get kind-based groups (classes, interfaces, functions, etc.)
	 */
	private getKindBasedGroups(
		relativeOutputPath: string,
		sidebarIcons: Array<"folder" | "file" | "kind"> | "all" | "none",
	): (string | MintlifyPage)[] {
		const pages: (string | MintlifyPage)[] = [];

		const categories = [
			{ type: "classes", name: "Classes", icon: "cube" },
			{ type: "interfaces", name: "Interfaces", icon: "plug" },
			{ type: "functions", name: "Functions", icon: "bolt" },
			{ type: "type-aliases", name: "Types", icon: "file-text" },
			{ type: "variables", name: "Variables", icon: "package" },
		];

		for (const category of categories) {
			const categoryPages = this.getPagesByType(category.type, relativeOutputPath);

			if (categoryPages.length > 0) {
				// Create individual page objects with icons if sidebarIcons includes 'all' or 'kind'
				let processedPages: (string | MintlifyPage)[] = categoryPages;

				if (
					sidebarIcons === "all" ||
					(Array.isArray(sidebarIcons) && sidebarIcons.includes("kind"))
				) {
					processedPages = categoryPages.map((page: string) => ({
						group: this.getPageTitle(page),
						icon: category.icon,
						pages: [page],
					}));
				}

				// If only a few pages, add them directly
				if (categoryPages.length <= 3) {
					pages.push(...processedPages);
				} else {
					// If many pages, create a group
					const group: MintlifyPage = {
						group: category.name,
						pages: processedPages,
					};

					// Add group icon if sidebarIcons is 'all'
					if (sidebarIcons === "all") {
						group.icon = category.icon;
					}

					pages.push(group);
				}
			}
		}

		return pages;
	}

	/**
	 * Check if icons should be shown for a specific navigation level
	 */
	private shouldShowIcons(
		level: string,
		sidebarIcons: Array<"folder" | "file" | "kind"> | "all" | "none",
	): boolean {
		return (
			sidebarIcons === "all" || (Array.isArray(sidebarIcons) && sidebarIcons.includes(level as any))
		);
	}

	/**
	 * Get pages for a specific TypeDoc category
	 */
	private getPagesByType(type: string, relativeOutputPath: string): string[] {
		try {
			const typeDir = resolve(this.options.outputDirectory, type);
			if (!existsSync(typeDir)) {
				return [];
			}

			const files = readdirSync(typeDir)
				.filter((file: string) => file.endsWith(".mdx"))
				.map((file: string) => `${relativeOutputPath}/${type}/${file.replace(".mdx", "")}`)
				.sort();

			return files;
		} catch (error) {
			console.warn(`Failed to read ${type} directory:`, error);
			return [];
		}
	}

	/**
	 * Update or create the SDK Reference tab in docs.json
	 */
	private updateSdkReferenceTab(
		docsJson: MintlifyDocsJson,
		navigationStructure: (string | MintlifyPage)[],
	): void {
		const sidebarIcons = this.options.sidebarIcons || "all";
		if (!docsJson.navigation) {
			docsJson.navigation = { tabs: [] };
		}

		if (!docsJson.navigation.tabs) {
			docsJson.navigation.tabs = [];
		}

		// Find existing SDK Reference tab (or legacy API Reference tab) or create new one
		let sdkTab = docsJson.navigation.tabs.find(
			(tab) => tab.tab.includes(this.options.tabName) || tab.tab.includes("SDK Reference"),
		);

		if (sdkTab === undefined) {
			sdkTab = {
				groups: [],
				tab: `${this.options.tabName}`,
			};
			docsJson.navigation.tabs.push(sdkTab);
		} else {
			// Update existing tab name to use SDK terminology
			sdkTab.tab = `${this.options.tabName}`;

			// Remove placeholder groups (Introduction, API Endpoints)
			sdkTab.groups = sdkTab.groups.filter(
				(group) =>
					!group.group?.includes("Introduction") && !group.group?.includes("API Endpoints"),
			);
		}

		// Find or create the project-specific group within the SDK tab
		let projectGroup = sdkTab.groups.find((group) =>
			group.group?.includes(this.options.projectName),
		);

		if (!projectGroup) {
			projectGroup = {
				group: `${this.options.projectName}`,
				pages: [],
			};

			// Only add icon if sidebarIcons includes 'folder' or 'all'
			if (this.shouldShowIcons("folder", sidebarIcons)) {
				projectGroup.icon = "cog";
			}

			sdkTab.groups.push(projectGroup);
		}

		// Replace the project group's pages with the new navigation structure
		projectGroup.pages = navigationStructure;
	}

	/**
	 * Get the generated file path for a TypeDoc reflection (without relativeOutputPath prefix)
	 */
	private getGeneratedPathForReflection(reflection: any): string | null {
		if (!reflection.sources || reflection.sources.length === 0) {
			return null;
		}

		const source = reflection.sources[0];
		if (!source.fileName) {
			return null;
		}

		// Map reflection kinds to output directories
		const kindToDir: { [key: string]: string } = {
			Class: "classes",
			Interface: "interfaces",
			Function: "functions",
			TypeAlias: "type-aliases",
			Variable: "variables",
			Enum: "enumerations",
		};

		const kindName = this.getReflectionKindName(reflection.kind);
		const kindDir = kindToDir[kindName];

		if (!kindDir) return null;

		// Build path based on source file location
		// src/recipe-engine/tools/action-tool.ts -> recipe-engine/tools/action-tool/classes/ActionTool
		const sourcePathParts = source.fileName.replace(/^src\//, "").split("/");
		const sourceFileName = sourcePathParts[sourcePathParts.length - 1];
		const sourceFileWithoutExt = sourceFileName.replace(/\.(ts|js|tsx|jsx)$/, "");

		// Remove the filename to get the directory path
		const sourceDirPath = sourcePathParts.slice(0, -1);

		// For files directly in src (like index.ts), treat them as being in the root module
		if (sourceDirPath.length === 0) {
			// This is a root-level file, use the filename as the module
			return `${sourceFileWithoutExt}/${kindDir}/${reflection.name}`;
		}

		// Build the full path: source-dir-path/kind-dir/reflection-name
		return `${sourceDirPath.join("/")}/${kindDir}/${reflection.name}`;
	}

	/**
	 * Get reflection kind name from kind number
	 */
	private getReflectionKindName(kind: number): string {
		// TypeDoc ReflectionKind enum values
		const kindMap: { [key: number]: string } = {
			1: "Project",
			2: "Module",
			4: "Namespace",
			8: "Enum",
			16: "EnumMember",
			32: "Variable",
			64: "Function",
			128: "Class",
			256: "Interface",
			512: "Constructor",
			1024: "Property",
			2048: "Method",
			4096: "CallSignature",
			8192: "IndexSignature",
			16384: "ConstructorSignature",
			32768: "Parameter",
			65536: "TypeLiteral",
			131072: "TypeParameter",
			262144: "Accessor",
			524288: "GetSignature",
			1048576: "SetSignature",
			2097152: "TypeAlias",
		};

		return kindMap[kind] || "Unknown";
	}

	/**
	 * Get reflection kind for icon mapping
	 */
	private getReflectionKind(reflection: any): string {
		const kindName = this.getReflectionKindName(reflection.kind);

		// Map to our icon categories
		const kindMap: { [key: string]: string } = {
			Class: "cube",
			Interface: "plug",
			Function: "bolt",
			TypeAlias: "file-text",
			Variable: "package",
			Enum: "list",
		};

		return kindMap[kindName] || "circle";
	}

	/**
	 * Format folder name for display
	 */
	private formatFolderDisplayName(folderName: string): string {
		// Capitalize first letter and replace dashes with spaces
		return folderName
			.split("-")
			.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
			.join(" ");
	}

	/**
	 * Extract page title from file path
	 */
	private getPageTitle(pagePath: string): string {
		// Extract the last part of the path as the title
		// e.g., "api-reference/hypergen/classes/ActionTool" -> "ActionTool"
		const parts = pagePath.split("/");
		return parts[parts.length - 1];
	}
}
