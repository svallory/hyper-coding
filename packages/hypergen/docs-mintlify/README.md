# Hypergen Mintlify Documentation

This directory contains the Mintlify-powered documentation for Hypergen.

## Local Development

To run the documentation site locally:

1. Install the Mintlify CLI:
   ```bash
   npm install -g mintlify
   ```

2. Start the development server:
   ```bash
   cd packages/hypergen/docs-mintlify
   mintlify dev
   ```

3. Open your browser to `http://localhost:3000`

## Building the Documentation

```bash
mintlify build
```

## Documentation Structure

- `mint.json` - Configuration file for navigation, theme, and settings
- `*.mdx` - Documentation pages in MDX format (Markdown + JSX)
- `concepts/` - Core concept documentation
- `tutorials/` - Step-by-step guides
- `logo/` - Logo and favicon assets
- `images/` - Documentation images and screenshots

## Deployment

Mintlify documentation can be deployed to:

1. **Mintlify Hosting** (recommended) - Connect your GitHub repository to https://mintlify.com
2. **Vercel/Netlify** - Deploy as a static site
3. **GitHub Pages** - Build and deploy to gh-pages branch

## Converting from Astro

This documentation was converted from Astro/Starlight to Mintlify with the following enhancements:

- **Enhanced Navigation**: Tabs, accordions, and card groups for better UX
- **Interactive Components**: Steps, code groups, and collapsible sections
- **Better Callouts**: Info, Tip, Warning, Note, and Check components
- **Improved Code Display**: Language-specific syntax highlighting and file names
- **Modern Design**: Clean, responsive layout with Mintlify's modern theme

## Mintlify Components Used

- `<CardGroup>` and `<Card>` - Navigation cards and feature highlights
- `<Tabs>` and `<Tab>` - Organize related content
- `<AccordionGroup>` and `<Accordion>` - Collapsible sections
- `<Steps>` and `<Step>` - Sequential instructions
- `<CodeGroup>` - Multiple code examples with tabs
- `<Info>`, `<Tip>`, `<Warning>`, `<Note>`, `<Check>` - Callout components

## Contributing

When adding new pages:

1. Create an `.mdx` file in the appropriate directory
2. Add frontmatter with `title` and `description`
3. Use Mintlify components for enhanced UX
4. Update `mint.json` navigation to include the new page
5. Test locally with `mintlify dev`

## Resources

- [Mintlify Documentation](https://mintlify.com/docs)
- [MDX Documentation](https://mdxjs.com/)
- [Mintlify Components](https://mintlify.com/docs/components)
