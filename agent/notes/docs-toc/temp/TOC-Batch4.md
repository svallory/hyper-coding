# Table of Contents Analysis - Batch 4: AI Tools Documentation

This analysis provides comprehensive Table of Contents entries for the AI tools documentation files, extracting all section headings and content descriptions.

## claude-code.mdx

**Main Title**: Claude Code setup
**Description**: Configure Claude Code for your documentation workflow

### Section Structure:
- **Prerequisites**: Requirements for using Claude Code (Active Claude subscription)
- **Setup**: Step-by-step installation and configuration process
  - Global npm installation command
  - Directory navigation instructions
  - Optional CLAUDE.md file setup
  - Launch command
- **Create `CLAUDE.md`**: Complete example configuration file for documentation standards
  - Working relationship guidelines (pushback, clarification, accuracy)
  - Project context (MDX, YAML frontmatter, Mintlify components)
  - Content strategy (success-focused, accuracy, evergreen content)
  - Frontmatter requirements (title, description)
  - Writing standards (voice, prerequisites, testing, formatting)
  - Git workflow (verification, branching, commits, hooks)
  - Prohibited practices (frontmatter skipping, absolute URLs, untested code)

**Content Summary**: This file provides a complete setup guide for Claude Code, Anthropic's official CLI tool, specifically configured for documentation workflows. It includes a comprehensive CLAUDE.md template that establishes documentation standards, writing guidelines, and project-specific rules for maintaining high-quality technical documentation.

---

## cursor.mdx

**Main Title**: Cursor setup
**Description**: Configure Cursor for your documentation workflow

### Section Structure:
- **Prerequisites**: Requirements for using Cursor (editor installation, repository access)
- **Project rules**: Team-wide configuration setup
  - Directory creation commands
  - `.cursor/rules.md` file creation
- **Core writing principles**: Comprehensive technical writing guidelines
  - **Language and style requirements**: Voice, tense, jargon, consistency, sentence structure
  - **Content organization standards**: Information hierarchy, progressive disclosure, procedures, prerequisites
  - **User-centered approach**: Goal-focused writing, anticipating questions, troubleshooting, scannability
- **Mintlify component reference**: Extensive component documentation with examples
  - **Callout components**: Note, Tip, Warning, Info, Check with usage examples
  - **Code components**: Single blocks, CodeGroup, RequestExample/ResponseExample with code samples
  - **Structural components**: Steps, Tabs, Accordions with detailed examples
  - **Cards and columns**: Card, CardGroup components for content emphasis
  - **API documentation components**: ParamField, ResponseField, Expandable with nested examples
  - **Media and advanced components**: Frames, videos, tooltips, updates with implementation code
- **Required page structure**: YAML frontmatter requirements and format
- **Content quality standards**: Detailed requirements for code examples, API docs, accessibility
- **Component selection logic**: Guidelines for choosing appropriate components for different content types

**Content Summary**: This file provides an extremely comprehensive setup guide for Cursor editor, featuring an extensive technical writing rulebook. It includes detailed documentation of all Mintlify components with working examples, writing standards, and component selection logic, making it a complete reference for technical documentation creation.

---

## windsurf.mdx

**Main Title**: Windsurf setup
**Description**: Configure Windsurf for your documentation workflow

### Section Structure:
- **Prerequisites**: Requirements for using Windsurf (editor installation, repository access)
- **Workspace rules**: Configuration setup for Windsurf's Cascade AI assistant
  - `.windsurf/rules.md` file creation and location
- **Project context**: Platform and format specifications (Mintlify, MDX, navigation)
- **Writing standards**: Core writing guidelines (voice, tense, prerequisites, outcomes, headings)
- **Required page structure**: YAML frontmatter requirements with example format
- **Mintlify components**: Component usage guidelines organized by category
  - **Callouts**: Five callout types with specific use cases
  - **Code examples**: Best practices for code blocks, groups, and API documentation
  - **Procedures**: Sequential instruction formatting with Steps and verification
  - **Content organization**: Tabs, Accordions, Cards, and Frame components
- **API documentation requirements**: Specific components and practices for API docs
- **Quality standards**: Testing, linking, accessibility, and consistency requirements

**Content Summary**: This file provides a streamlined setup guide for Windsurf editor's Cascade AI assistant, focusing on documentation workflow optimization. It presents a concise but comprehensive set of rules covering Mintlify components, writing standards, and quality requirements in a more condensed format than the Cursor guide.

---

## Analysis Summary

**Common Patterns Across Files:**
- All files follow consistent frontmatter structure with title, description, icon, and og tags
- Each targets a specific AI editor/tool for documentation workflow enhancement
- All include comprehensive component reference sections for Mintlify
- Prerequisites sections are standardized and brief
- Setup instructions follow logical step-by-step progression

**Content Depth Variation:**
- **Cursor**: Most comprehensive with 422 lines including extensive component examples
- **Claude Code**: Moderate depth with focus on configuration file template
- **Windsurf**: Most concise while still covering essential guidelines

**Special Elements:**
- All files contain extensive code block examples with proper language tags
- Multiple component demonstrations with realistic usage scenarios
- Structured rule templates that can be copied directly into projects
- Quality standards and best practices integrated throughout

**Target Audience:** Technical writers, documentation maintainers, and development teams using AI-assisted editing tools for creating and maintaining Mintlify-based documentation sites.