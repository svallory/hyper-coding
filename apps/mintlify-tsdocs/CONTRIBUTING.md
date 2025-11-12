# Contributing to Mintlify TSDocs

First off, thank you for considering contributing! This project is a specialized tool, and your help is greatly appreciated. This guide will help you get your development environment set up and explain the contribution workflow.

## Development Workflow

### 1. Project Setup

1.  **Fork and Clone:** Fork the repository to your own GitHub account and then clone it to your local machine.
2.  **Install Dependencies:** This project uses `bun` for package management.

    ```bash
    # Navigate to the project root
    cd mintlify-tsdocs

    # Install all dependencies
    bun install
    ```

### 2. Building the Project

The project is written in TypeScript and needs to be compiled to JavaScript. The build script will output the compiled files to the `lib` directory.

```bash
# Run the build script
bun run build
```

You should run this command whenever you make changes to the TypeScript source files in the `src` directory. For convenience, you can use `bun run watch` to automatically re-compile on file changes.

### 3. Running Locally

To test your local changes, it's best to use `bun link` to create a global symlink to your local version of the `mintlify-tsdocs` command.

1.  **Create the Link:** In the root of the project, run:
    ```bash
    bun link
    ```
2.  **Verify the Link:** You can now run the `mintlify-tsdocs` command from any directory on your system, and it will execute the code from your local project folder.
    ```bash
    mintlify-tsdocs --help
    ```
3.  **Test Your Changes:** Navigate to a separate test project that has `*.api.json` files and run your local `mintlify-tsdocs` command against it to see the output.

    ```bash
    # Example from within a test project
    mintlify-tsdocs markdown -i ./input -o ./output-test
    ```

### 4. Running Tests

We use [Jest](https://jestjs.io/) for testing, with a focus on snapshot testing to ensure that the MDX output remains consistent.

-   **Run all tests:**
    ```bash
    bun test
    ```
-   **Update Snapshots:** If you've made intentional changes to the output, you will need to update the snapshots.
    ```bash
    bun test -- -u
    # or
    bun jest --updateSnapshot
    ```

When adding a new feature or fixing a bug, please add a corresponding test case in the relevant `test` directory. For changes affecting the MDX output, this will likely involve modifying or adding to `src/markdown/test/CustomMarkdownEmitter.test.ts` and updating its snapshot.

**Note:** After running tests, verify the generated output manually in a test project to ensure the MDX files render correctly in Mintlify.

### 5. Code Style & Linting

This project uses ESLint to enforce a consistent code style. Before submitting a pull request, please run the linter to check for any issues.

```bash
# Run the linter
bun run lint

# Attempt to automatically fix lint issues
bun run lint:fix
```

## Pull Request Process

1.  Ensure all tests and lint checks are passing.
2.  Push your changes to your fork.
3.  Open a pull request from your fork to the main repository.
4.  In your pull request description, please explain the changes you made and why.
5.  Your pull request will be reviewed, and you may be asked to make changes before it is merged.
