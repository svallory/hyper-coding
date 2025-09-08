# HyperDev Documentation

Comprehensive documentation for HyperDev - the modern code generation ecosystem.

## Documentation Structure

This documentation site is built with [Mintlify](https://mintlify.com) and covers the complete HyperDev ecosystem:

### Core Documentation
- **Getting Started**: Installation, quickstart, and user workflows
- **CLI Reference**: Complete command-line interface documentation
- **Configuration Guide**: System configuration and setup
- **Troubleshooting**: Common issues and solutions

### Templates & Examples
- **Template Creation Guide**: Building custom templates
- **Template Sharing**: Publishing and distributing templates
- **Examples Library**: Real-world usage examples and patterns

### Advanced Topics
- **Tool Integrations**: IDE, build system, and CI/CD integration
- **Advanced Usage**: Power user features and enterprise patterns
- **Performance Guide**: Optimization strategies and best practices
- **Security Guide**: Security model and trust system

### Community & Development
- **Migration Guide**: Moving from other code generation tools
- **Community Guidelines**: Contributing templates and code
- **Plugin Development**: Building custom plugins and extensions

### API Reference
- **Auto-generated API docs**: TypeScript API documentation via TypeDoc
- **Integration APIs**: Programmatic usage patterns

## Building Documentation

### Prerequisites
- Bun package manager
- Node.js 16+

### Development
```bash
# Start development server
cd apps/docs
mintlify dev

# Generate API documentation
cd packages/hypergen
bun run docs:api

# Build complete documentation
bun run scripts/build-docs.js
```

### API Documentation Generation

API documentation is automatically generated from TypeScript source code using TypeDoc:

```bash
# Generate API docs
cd packages/hypergen
bun run docs:api

# Watch for changes
bun run docs:api:watch
```

The generated API documentation is integrated into the main documentation site at `/api-reference/generated/`.

## Content Guidelines

### Writing Style
- **Clear and Concise**: Use simple, direct language
- **User-Focused**: Write for the end-user experience
- **Progressive Disclosure**: Start simple, build complexity
- **Practical Examples**: Include working code samples

### Documentation Standards
- Use MDX format for rich content
- Include proper frontmatter (title, description)
- Add code examples with syntax highlighting
- Provide troubleshooting sections where appropriate
- Cross-reference related topics

## Contributing to Documentation

### Adding New Pages
1. Create MDX file with proper frontmatter
2. Add to `docs.json` navigation structure
3. Follow content guidelines and style standards
4. Test with local development server

### Updating API Documentation
1. Add comprehensive TSDoc comments to source code
2. Regenerate API docs: `bun run docs:api`
3. Review generated output for accuracy
4. Update integration if needed

## Support

For documentation issues:
- **GitHub Issues**: Report bugs or request improvements
- **Discord Community**: Get help and discuss improvements
- **Direct Contact**: Reach out to the documentation team

---

**Version**: 2.0.0  
**Last Updated**: January 2025  
**Build System**: Mintlify + TypeDoc
