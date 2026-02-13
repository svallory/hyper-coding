# Contributing to Next.js Hyperkit

Thank you for your interest in contributing to the Next.js Hyperkit! This document provides guidelines for contributing.

## How to Contribute

### Reporting Bugs

- Use the GitHub issue tracker
- Check if the issue already exists
- Include reproduction steps
- Provide your environment details (OS, Node version, Next.js version)

### Suggesting Enhancements

- Open an issue with your suggestion
- Explain the use case
- Provide examples of how it would be used

### Adding New Recipes

1. Fork the repository
2. Create a new branch (`git checkout -b feature/new-recipe`)
3. Follow the recipe structure:
   ```
   cookbooks/your-cookbook/your-recipe/
   ├── README.md
   ├── recipe.yml
   └── templates/
       └── your-template.jig
   ```
4. Add comprehensive documentation
5. Test your recipe thoroughly
6. Submit a pull request

### Recipe Guidelines

- **Documentation**: Every recipe MUST have a README.md
- **Examples**: Include 2-3 usage examples
- **Variables**: Document all variables with descriptions
- **Testing**: Test with both Prisma and Drizzle if applicable
- **TypeScript**: All generated code must use TypeScript
- **Best Practices**: Follow Next.js 15 best practices

### Template Guidelines

- Use `.jig` extension for Jig templates
- Include frontmatter for file paths and injection points
- Use helper functions (pascalCase, camelCase, etc.)
- Support both shadcn/ui primitives (Base UI and Radix)
- Auto-detect ORM when applicable

### Documentation Standards

- Use clear, concise language
- Include code examples
- Document all options and variables
- Link to related recipes
- Add troubleshooting sections

## Development Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/hyperdevhq/nextjs-kit.git
   cd nextjs-kit
   ```

2. Install dependencies (if any):
   ```bash
   bun install
   ```

3. Test your changes locally with hypergen

## Pull Request Process

1. Update documentation if needed
2. Ensure all examples work
3. Update ARCHITECTURE.md for significant changes
4. Write a clear PR description
5. Link related issues

## Code of Conduct

- Be respectful and inclusive
- Welcome newcomers
- Focus on constructive feedback
- Help others learn

## Questions?

Open an issue or discussion on GitHub.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
