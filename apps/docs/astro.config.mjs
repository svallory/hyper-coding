import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightImageZoom from 'starlight-image-zoom';
import starlightLinksValidator from 'starlight-links-validator';
import starlightLLMsTxt from 'starlight-llms-txt';
import starlightSidebarTopics from 'starlight-sidebar-topics';
import starlightTypeDoc from 'starlight-typedoc';
import starlightScrollToTop from 'starlight-scroll-to-top';
import starlightPageActions from 'starlight-page-actions';
import d2 from 'astro-d2';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// https://astro.build/config
export default defineConfig({
  srcDir: './src',
  outDir: './dist-docs',
  publicDir: './public',
  site: 'https://docs.hyperdev.sh',
  base: '/',
  integrations: [
    d2(),
    starlight({
      plugins: [
        // Add image zoom functionality
        starlightImageZoom({}),
        // Validate internal links during build
        starlightLinksValidator(),
        // Generate LLMs.txt for AI consumption
        starlightLLMsTxt(),
        // Copy page as markdown, open in Claude/ChatGPT
        starlightPageActions(),
        // Add scroll-to-top button
        starlightScrollToTop(),
        // Organize sidebar with topics (3 tabs: Documentation, References, Architecture)
        starlightSidebarTopics([
          {
            label: 'Documentation',
            link: '/docs/',
            icon: 'open-book',
            items: [
              { slug: 'index' },
              {
                label: 'Get Started',
                items: [
                  { slug: 'docs/index' },
                  { slug: 'docs/get-started/installation' },
                  { slug: 'docs/get-started/quickstart' },
                  { slug: 'docs/get-started/tutorial' },
                  { slug: 'docs/get-started/cli-quickstart' },
                ],
              },
              {
                label: 'Concepts',
                items: [
                  { slug: 'docs/concepts/introduction' },
                  { slug: 'docs/concepts/hyper-vs-vibe' },
                ],
              },
              {
                label: 'Tools',
                items: [
                  { slug: 'docs/tools/overview' },
                  { slug: 'docs/tools/gen' },
                  { slug: 'docs/tools/tools' },
                  { slug: 'docs/tools/plan' },
                  { slug: 'docs/tools/watch' },
                  { slug: 'docs/tools/dash' },
                  { slug: 'docs/tools/cli-overview' },
                  {
                    label: 'Hyper HQ',
                    items: [
                      { slug: 'docs/tools/hq/overview' },
                      { slug: 'docs/tools/hq/configuration' },
                      { slug: 'docs/tools/hq/commands' },
                      { slug: 'docs/tools/hq/telegram' },
                      { slug: 'docs/tools/hq/worktrees' },
                    ],
                  },
                ],
              },
              {
                label: 'Kits & Templates',
                items: [
                  { slug: 'docs/kits/installation' },
                  { slug: 'docs/kits/creating-templates' },
                  { slug: 'docs/kits/recipe-authoring' },
                  { slug: 'docs/kits/ai-decisions-tag' },
                  { slug: 'docs/kits/ai-prompt-helper' },
                  { slug: 'docs/kits/sharing' },
                  { slug: 'docs/kits/migration-guide' },
                ],
              },
              {
                label: 'Integrations',
                items: [
                  { slug: 'docs/integrations/claude-code-hooks' },
                  { slug: 'docs/integrations/user-analytics-scenario' },
                  {
                    label: 'AI Tools',
                    items: [
                      { slug: 'docs/integrations/ai-tools/claude-code' },
                      { slug: 'docs/integrations/ai-tools/cursor' },
                      { slug: 'docs/integrations/ai-tools/windsurf' },
                    ],
                  },
                  {
                    label: 'Editors',
                    items: [
                      { slug: 'docs/integrations/editors/vscode' },
                      { slug: 'docs/integrations/editors/jetbrains' },
                      { slug: 'docs/integrations/editors/vim' },
                    ],
                  },
                  {
                    label: 'Build Tools',
                    items: [
                      { slug: 'docs/integrations/build-tools/vite' },
                      { slug: 'docs/integrations/build-tools/webpack' },
                      { slug: 'docs/integrations/build-tools/nextjs' },
                    ],
                  },
                  {
                    label: 'CI/CD',
                    items: [
                      { slug: 'docs/integrations/ci-cd/github-actions' },
                      { slug: 'docs/integrations/ci-cd/docker' },
                      { slug: 'docs/integrations/ci-cd/git-hooks' },
                      { slug: 'docs/integrations/ci-cd/package-scripts' },
                    ],
                  },
                ],
              },
              {
                label: 'Guides',
                items: [
                  { slug: 'docs/guides/overview' },
                  { slug: 'docs/guides/best-practices' },
                  { slug: 'docs/guides/security' },
                  { slug: 'docs/guides/advanced-usage' },
                  { slug: 'docs/guides/customize-setup' },
                  { slug: 'docs/guides/publishing' },
                ],
              },
              {
                label: 'Examples',
                items: [
                  { slug: 'docs/examples/overview' },
                  { slug: 'docs/examples/quick-wins' },
                  { slug: 'docs/examples/real-world' },
                  { slug: 'docs/examples/advanced-patterns' },
                  { slug: 'docs/examples/frameworks' },
                ],
              },
              {
                label: 'Community',
                items: [
                  { slug: 'docs/community/overview' },
                  { slug: 'docs/community/community-guidelines' },
                  { slug: 'docs/community/plugin-development' },
                ],
              },
            ],
          },
          {
            label: 'References',
            link: '/reference/',
            icon: 'document',
            items: [
              { slug: 'reference' },
              {
                label: 'CLI Reference',
                items: [
                  { slug: 'reference/cli' },
                  { slug: 'reference/configuration' },
                  { slug: 'reference/troubleshooting' },
                ],
              },
              {
                label: 'Commands',
                items: [
                  { slug: 'reference/commands/overview' },
                  { slug: 'reference/commands/gen' },
                  { slug: 'reference/commands/run' },
                  { slug: 'reference/commands/init' },
                  { slug: 'reference/commands/plan' },
                  { slug: 'reference/commands/tools' },
                  { slug: 'reference/commands/watch' },
                  { slug: 'reference/commands/dash' },
                  { slug: 'reference/commands/search' },
                  { slug: 'reference/commands/list' },
                  { slug: 'reference/commands/docs' },
                  { slug: 'reference/commands/plan-resources' },
                  { slug: 'reference/commands/task' },
                  { slug: 'reference/commands/hq' },
                ],
              },
            ],
          },
          {
            label: 'Architecture',
            link: '/arch/',
            icon: 'seti:config',
            items: [
              { slug: 'arch' },
              {
                label: 'Overview',
                items: [
                  { slug: 'arch/methodology' },
                  { slug: 'arch/migration-strategy' },
                  { slug: 'arch/gen-internals' },
                  { slug: 'arch/advanced' },
                ],
              },
              {
                label: 'Command Internals',
                items: [
                  { slug: 'arch/commands/search' },
                  { slug: 'arch/commands/list' },
                  { slug: 'arch/commands/docs' },
                  { slug: 'arch/commands/task' },
                  { slug: 'arch/commands/plan' },
                  { slug: 'arch/commands/tools' },
                  { slug: 'arch/commands/init' },
                ],
              },
              {
                label: 'Configuration',
                items: [
                  { slug: 'arch/config/configuration' },
                  { slug: 'arch/config/cli-internals' },
                ],
              },
              {
                label: 'Templates & Kits',
                items: [
                  { slug: 'arch/templates/sharing' },
                  { slug: 'arch/templates/migration' },
                ],
              },
              {
                label: 'Integrations',
                items: [
                  { slug: 'arch/integrations/vite' },
                  { slug: 'arch/integrations/webpack' },
                  { slug: 'arch/integrations/nextjs' },
                ],
              },
            ],
          },
        ], { topics: {} }),
        // TypeDoc API documentation (temporarily disabled — needs @types/debug in gen package)
        // starlightTypeDoc({
        //   entryPoints: [resolve(__dirname, '../../packages/gen/src/index.ts')],
        //   tsconfig: resolve(__dirname, '../../packages/gen/tsconfig.json'),
        //   output: 'api',
        //   typeDoc: {
        //     gitRevision: 'main',
        //   },
        // }),
      ],
      title: 'HyperDev Docs',
      description: 'Documentation for HyperDev — a modern code generation toolkit',
      expressiveCode: {
        themes: ['tokyo-night'],
      },
      customCss: [
        './src/styles/custom.css',
      ],
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/svallory/hyper-coding',
        },
      ],
      editLink: {
        baseUrl: 'https://github.com/svallory/hyper-coding/edit/main/',
      },
      lastUpdated: true,
      favicon: '/favicon.svg',
    }),
  ],
});
