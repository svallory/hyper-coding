# Docs Automation

This document explains how the documentation for `hypergen` is automatically generated and integrated with Mintlify.

## Overview

The documentation generation process uses [TypeDoc](https://typedoc.org/) to extract information from the TypeScript source code and comments. A custom theme, `typedoc-theme-mintlify`, is used to format the output into Mintlify-compatible MDX files.

## Key Components

-   **`packages/hypergen/`**: The source code for the `hypergen` package.
-   **`packages/hypergen/typedoc.json`**: The TypeDoc configuration file for the `hypergen` package.
-   **`packages/typedoc-theme-mintlify/`**: A custom TypeDoc theme that generates Mintlify-compatible documentation.
-   **`apps/docs/`**: The destination directory for the generated documentation.

## How it Works

1.  **TypeDoc Execution**: When `typedoc` is run for the `hypergen` package, it uses the configuration from `packages/hypergen/typedoc.json`.

2.  **Custom Theme**: The `typedoc.json` file specifies `typedoc-theme-mintlify` as the theme. This theme is responsible for:
    -   Generating MDX files instead of HTML.
    -   Adding Mintlify-specific frontmatter to the MDX files.
    -   Using Mintlify components (like `<Card>`, `<Accordion>`, etc.) in the generated documentation.

3.  **Configuration**: The `typedoc.json` file contains several options that control the output of the `typedoc-theme-mintlify` theme:
    -   `out`: Specifies the output directory for the generated documentation, which is `../../apps/docs/typedocs`.
    -   `mintlifyNavigation`: Controls how the navigation is organized in the Mintlify sidebar.
    -   `mintlifySidebarIcons`: Determines which navigation items have icons.
    -   `mintlifyDocsJsonPath`: Specifies the path to the `docs.json` file that the theme will update with the generated navigation structure. This is set to `../../apps/docs/docs.json`.
    -   `mintlifyTabName`: The name of the tab in the Mintlify sidebar where the documentation will be placed.

4.  **Mintlify Integration**: The `typedoc-theme-mintlify` theme automatically updates the `apps/docs/docs.json` file with the navigation structure of the generated documentation. This file is used by Mintlify to build the sidebar. The generated MDX files are placed in the `apps/docs/typedocs` directory, which is referenced by the `docs.json` file.

## Summary

The documentation for `hypergen` is generated using TypeDoc with the `typedoc-theme-mintlify` theme. This theme creates Mintlify-compatible MDX files and automatically updates the Mintlify navigation. The entire process is configured through the `packages/hypergen/typedoc.json` file. The project does **not** use `packages/typedoc-plugin-mintlify/`.
