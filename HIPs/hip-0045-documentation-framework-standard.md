---
hip: 0045
title: Documentation Framework Standard
author: Hanzo AI Team
type: Standards Track
category: Interface
status: Draft
created: 2026-02-23
requires: HIP-0010
---

# HIP-0045: Documentation Framework Standard

## Abstract

This proposal defines the documentation framework standard for the Hanzo ecosystem. All developer-facing documentation sites -- from API references to protocol specifications -- MUST be built using the `@hanzo/docs-*` package family, a purpose-built fork of the Fumadocs framework extended with multi-brand theming, OpenAPI generation, and cross-ecosystem search.

The framework ships as 24 independently versioned packages in a pnpm monorepo. Applications compose only the packages they need. A single unified wrapper (`@hanzo/docs`) re-exports everything for convenience.

**Repository**: [github.com/hanzoai/docs](https://github.com/hanzoai/docs)
**Primary Package**: `@hanzo/docs` (unified wrapper)
**Build Toolchain**: tsdown for packages, Turbo for monorepo orchestration
**Runtime**: Next.js 15+ with App Router, React 19+, Tailwind CSS 4+

## Motivation

### The Problem

The Hanzo ecosystem spans five brands (Hanzo, Lux, Zoo, Zen, ZAP) and dozens of products. Before this standard, documentation was fragmented:

1. **Framework sprawl**: Some projects used Docusaurus, others used GitBook, others used hand-rolled Next.js pages. Each had different navigation patterns, search capabilities, and styling. Contributors had to learn a new system for each site.

2. **No multi-brand support**: Hanzo, Lux, Zoo, and Zen each need distinct visual identities (colors, logos, typography) but identical UX patterns. Off-the-shelf frameworks treat branding as an afterthought -- they support one theme per deployment. Running five separate framework instances multiplies maintenance.

3. **No OpenAPI integration**: API-heavy products (LLM Gateway, Cloud, Commerce) need endpoint documentation generated from OpenAPI specs. Most doc frameworks require a separate tool (Swagger UI, Redoc) embedded via iframe, breaking navigation and search.

4. **No code-alongside-docs workflow**: Proprietary platforms (Mintlify, GitBook, Notion) separate documentation from the codebase. Developers cannot version docs alongside code, cannot use MDX with custom React components, and cannot run docs through the same CI pipeline.

5. **Search fragmentation**: Each site had its own search (or none). There was no way to search across all Hanzo documentation from a single query.

### The Solution

A forked and extended Fumadocs framework, published as `@hanzo/docs-*` packages, that provides:

- Multi-brand theming via CSS custom properties (one codebase, five visual identities)
- Built-in OpenAPI documentation generation from spec files
- MDX-first content with React Server Components
- Unified full-text search across all sites (built-in Orama, Algolia adapter)
- TypeScript and Python API documentation generation from source
- Static export support for zero-runtime deployment

## Design Philosophy

This section explains the **why** behind each architectural decision. Documentation infrastructure is high-leverage -- the wrong choice here affects every product team and every developer who reads Hanzo docs.

### Why Fork Fumadocs (Not Use It Directly)

Fumadocs is the best Next.js documentation framework available. It supports the App Router, React Server Components, and ships with a clean Radix UI component library. It is 40% lighter than Docusaurus and has first-class MDX support.

We forked it because we need capabilities that do not fit upstream's scope:

- **Multi-brand theming**: Fumadocs assumes one site = one brand. We need a single deployment pipeline that produces five visually distinct sites from shared content structure. This requires deep changes to the theming layer (CSS variable namespacing, brand-aware component variants, per-site layout configuration).

- **Custom search**: Fumadocs provides Orama-based search per site. We need cross-site federated search and integration with our own search API (HIP-0012). This requires changes to the search indexing pipeline and client.

- **OpenAPI generation**: While Fumadocs has an OpenAPI plugin, we need tighter integration -- generating pages that match our API playground format, supporting our authentication flows, and rendering response schemas with our type table components.

- **Package renaming**: Our fork publishes under the `@hanzo/docs-*` namespace so that consumers clearly depend on the Hanzo-maintained version, which receives security patches, multi-brand features, and ecosystem integrations that upstream does not.

The fork maintains an `upstream` remote pointing to `fuma-nama/fumadocs`. We periodically merge upstream changes and resolve conflicts in our extension points. This gives us upstream improvements (bug fixes, performance, new Radix UI components) while maintaining our custom features.

**Trade-off acknowledged**: Maintaining a fork requires ongoing merge effort. We accept this because the alternative -- building a docs framework from scratch -- is orders of magnitude more work, and using upstream directly does not meet our multi-brand and OpenAPI requirements.

### Why Not Docusaurus

Docusaurus is the most widely used documentation framework. We evaluated it and rejected it for these reasons:

- **No App Router support**: Docusaurus uses React client-side rendering exclusively. It does not support React Server Components or the Next.js App Router. This means every page ships the full React runtime to the client, and we cannot use server-only features (database queries, KMS secret access) in documentation pages.

- **Heavy bundle**: A default Docusaurus site ships ~400KB of JavaScript. A Fumadocs site ships ~240KB. For documentation that is primarily text, this overhead is unjustifiable.

- **Plugin architecture friction**: Docusaurus plugins must conform to its lifecycle hooks, which are designed around its own build pipeline (Webpack, not Turbopack). Integrating our OpenAPI generator and type table components would require fighting the framework rather than extending it.

- **No MDX 3 support**: As of evaluation, Docusaurus uses MDX 2. Our content pipeline requires MDX 3 features (ESM-only, improved JSX handling, better error messages).

### Why Not Mintlify

Mintlify is a proprietary documentation platform with excellent design defaults. We rejected it because:

- **No self-hosting**: Mintlify is SaaS-only. We cannot run it on our own infrastructure, which violates our requirement for infrastructure sovereignty (we must own our docs pipeline end-to-end).

- **Cost at scale**: Mintlify pricing scales with page count and team size. With 6+ documentation sites and growing content, the annual cost exceeds what we would spend maintaining our own framework.

- **No MDX component embedding**: Mintlify supports a subset of MDX but does not allow importing arbitrary React components. Our docs include interactive API playgrounds, live code editors, and protocol visualizations that require full React component support.

- **No version-alongside-code**: Mintlify content lives in a separate repository synced via their CLI. We need docs to live in the same monorepo as the code they document, so a PR that changes an API also updates its documentation.

### Why Not GitBook or Notion

GitBook and Notion are content platforms, not developer documentation frameworks. They lack:

- **No MDX**: Content is stored in their proprietary formats. No support for embedding React components, importing TypeScript types, or running code transformations.
- **No CI integration**: Cannot run documentation builds through the same CI pipeline as code.
- **No static export**: Cannot produce static HTML for CDN deployment.
- **No programmatic content generation**: Cannot auto-generate pages from OpenAPI specs or TypeScript declarations.

### Why a Monorepo with 24 Packages

Each package is independently versioned and publishable. This matters because:

- **Selective dependency**: A site that only needs core source loading and a basic UI does not need to install the OpenAPI generator, Python docgen, or Twoslash TypeScript hints. It installs `@hanzo/docs-core` + `@hanzo/docs-ui` and nothing else.

- **Independent release cadence**: A bug fix in `@hanzo/docs-openapi` does not force a release of `@hanzo/docs-core`. Sites that do not use OpenAPI docs are unaffected.

- **Tree-shaking**: Because packages declare explicit exports, bundlers can eliminate unused code. The unified `@hanzo/docs` wrapper re-exports everything but consumers who import from it still benefit from tree-shaking at the module level.

- **Clear ownership boundaries**: Each package has a defined scope. `@hanzo/docs-core` handles source loading and search. `@hanzo/docs-ui` handles Radix UI components. `@hanzo/docs-openapi` handles spec parsing and page generation. Contributors know where to make changes.

## Specification

### Package Architecture

The framework consists of 24 packages organized by responsibility:

#### Core Packages

| Package | NPM Name | Purpose |
|---------|----------|---------|
| `packages/core` | `@hanzo/docs-core` | Source loading, search indexing, i18n, page tree construction, breadcrumb generation, TOC extraction, syntax highlighting |
| `packages/mdx` | `@hanzo/docs-mdx` | MDX processing, frontmatter parsing, content collections, file watching, Next.js/Vite integration |
| `packages/hanzo-docs` | `@hanzo/docs` | Unified wrapper that re-exports all packages under a single import namespace |

#### UI Packages

| Package | NPM Name | Purpose |
|---------|----------|---------|
| `packages/radix-ui` | `@hanzo/docs-ui` | Full UI component library built on Radix primitives (sidebar, TOC, breadcrumb, search dialog, code blocks, tabs, cards, callouts) |
| `packages/base-ui` | `@hanzo/docs-base-ui` | Headless UI components built on `@base-ui/react` for maximum styling flexibility |
| `packages/tailwind` | `@hanzo/docs-tailwind` | Tailwind CSS utilities, preset configuration, and CSS custom property definitions |
| `packages/story` | `@hanzo/docs-story` | Component story/preview system for documentation UI components |

#### Content Generation Packages

| Package | NPM Name | Purpose |
|---------|----------|---------|
| `packages/openapi` | `@hanzo/docs-openapi` | Auto-generate endpoint documentation from OpenAPI 3.x specs, with interactive playground |
| `packages/typescript` | `@hanzo/docs-typescript` | Auto-generate type tables from TypeScript declarations and `.d.ts` files |
| `packages/python` | `@hanzo/docs-python` | Python API documentation generation (includes `fumapy` Python package for docstring extraction) |
| `packages/twoslash` | `@hanzo/docs-twoslash` | TypeScript code hints and inline type annotations in code blocks |
| `packages/doc-gen` | `@hanzo/docs-docgen` | Generic documentation generation utilities |

#### Integration Packages

| Package | NPM Name | Purpose |
|---------|----------|---------|
| `packages/mdx-remote` | `@hanzo/docs-mdx-remote` | Remote MDX content loading (fetch MDX from URLs or CMS) |
| `packages/mdx-runtime` | `@hanzo/mdx-runtime` | Runtime MDX compilation for dynamic content |
| `packages/obsidian` | `@hanzo/docs-obsidian` | Obsidian vault adapter (use Obsidian markdown as docs source) |
| `packages/content-collections` | `@hanzo/docs-content-collections` | Content Collections integration for type-safe content |
| `packages/press` | `@hanzo/docs-press` | Minimal setup package for quick documentation sites |

#### Tooling Packages

| Package | NPM Name | Purpose |
|---------|----------|---------|
| `packages/cli` | `@hanzo/docs-cli` | CLI for scaffolding new doc sites, customizing components, and running dev tasks |
| `packages/create-app` | `@hanzo/docs-create-app` | Project scaffolding (`pnpm create @hanzo/docs-app`) |
| `packages/create-app-versions` | `@hanzo/docs-create-app-versions` | Version tracking for create-app templates |
| `packages/stf` | `@fumari/stf` | Upstream schema/transform dependency (kept under original namespace) |
| `packages/org` | `@hanzo/docs-org` | Organization-level shared utilities |

#### Configuration Packages

| Package | NPM Name | Purpose |
|---------|----------|---------|
| `packages/tsconfig` | `tsconfig` | Shared TypeScript configuration (base, Next.js, React library) |
| `packages/eslint-config-custom` | `eslint-config-custom` | Shared ESLint configuration |
| `packages/shared` | `shared` | Shared internal utilities and registry |

### Package Dependency Graph

```
@hanzo/docs (unified wrapper)
  |
  +-- @hanzo/docs-core .............. source, search, i18n, page tree
  |     |
  |     +-- shiki .................. syntax highlighting
  |     +-- @orama/orama .......... full-text search engine
  |     +-- unified/remark ........ markdown processing pipeline
  |
  +-- @hanzo/docs-mdx .............. MDX processing, collections
  |     |
  |     +-- @mdx-js/mdx ........... MDX compiler
  |     +-- chokidar .............. file watching
  |     +-- esbuild ............... fast JS/TS bundling
  |
  +-- @hanzo/docs-ui ............... Radix UI components
  |     |
  |     +-- @radix-ui/* ........... UI primitives
  |     +-- motion ................ animations
  |     +-- next-themes ........... dark/light mode
  |     +-- tailwind-merge ........ class merging
  |
  +-- @hanzo/docs-openapi .......... OpenAPI doc generation
  |     |
  |     +-- @scalar/openapi-parser . spec parsing
  |     +-- openapi-sampler ....... example generation
  |     +-- react-hook-form ....... playground forms
  |
  +-- @hanzo/docs-typescript ....... TS type tables
  +-- @hanzo/docs-python ........... Python docgen
  +-- @hanzo/docs-twoslash ......... TS code hints
  +-- @hanzo/docs-obsidian ......... Obsidian adapter
  +-- @hanzo/docs-press ............ minimal setup
  +-- @hanzo/docs-cli .............. scaffolding
  +-- @hanzo/docs-mdx-remote ....... remote MDX
  +-- @hanzo/mdx-runtime ........... runtime MDX
  +-- @hanzo/docs-content-collections
  +-- @hanzo/docs-docgen
```

### Sites Powered by This Framework

| Site | URL | App Directory | Purpose |
|------|-----|---------------|---------|
| Main Docs | docs.hanzo.ai | `apps/docs` | Primary Hanzo documentation, API reference |
| HIPs | hips.hanzo.ai | `../hips/docs` | Hanzo Improvement Proposals |
| Zen LM | zenlm.org | `apps/zen-docs` | Zen model family documentation |
| ZAP Protocol | zap.hanzo.ai | `apps/zap-docs` | ZAP protocol specification |
| Dev Docs | dev.hanzo.ai | `apps/dev-docs` | Developer guides and tutorials |
| Bot Docs | bot.hanzo.ai | `apps/bot-docs` | Bot framework documentation |

### Source Configuration

Every documentation site MUST define a `source.config.ts` at its root:

```typescript
import { defineConfig, defineDocs } from '@hanzo/docs-mdx/config';

export default defineConfig({
  docs: defineDocs({
    dir: 'content/docs',
  }),
});
```

This file declares the content sources. The MDX package uses it to:
1. Discover markdown/MDX files in the specified directories
2. Extract frontmatter metadata
3. Build the page tree (navigation structure)
4. Generate TypeScript types for content collections

### Source Loader

Each site MUST create a source loader in `lib/source.ts`:

```typescript
import { docs } from '@/.source';
import { loader } from '@hanzo/docs-core/source';

export const source = loader({
  baseUrl: '/docs',
  source: docs.toFumadocsSource(),
});
```

The loader transforms raw content into a structured page tree with:
- URL slugs derived from file paths
- Navigation ordering from frontmatter or file naming (`01-getting-started.mdx`)
- Folder-based grouping with `meta.json` for custom ordering
- Breadcrumb data for each page

### Page Component Pattern

Documentation pages follow this pattern:

```tsx
import { source } from '@/lib/source';
import { DocsPage, DocsBody } from '@hanzo/docs-ui/layouts/docs/page';
import defaultMdxComponents from '@hanzo/docs-ui/mdx';
import { notFound } from 'next/navigation';

export default async function Page(props: { params: Promise<{ slug?: string[] }> }) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;

  return (
    <DocsPage toc={page.data.toc}>
      <DocsBody>
        <MDX components={{ ...defaultMdxComponents }} />
      </DocsBody>
    </DocsPage>
  );
}
```

### Layout System

The framework provides four layout variants:

| Layout | Import Path | Use Case |
|--------|------------|----------|
| **Docs** | `@hanzo/docs-ui/layouts/docs` | Standard documentation with sidebar navigation |
| **Home** | `@hanzo/docs-ui/layouts/home` | Landing pages with hero sections and feature grids |
| **Notebook** | `@hanzo/docs-ui/layouts/notebook` | Notebook-style layout for tutorials |
| **Flux** | `@hanzo/docs-ui/layouts/flux` | Alternative layout with fluid navigation |

Each layout provides a root layout component and a page component:

```tsx
// app/docs/layout.tsx
import { DocsLayout } from '@hanzo/docs-ui/layouts/docs';
import { source } from '@/lib/source';

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <DocsLayout tree={source.pageTree}>
      {children}
    </DocsLayout>
  );
}
```

### Multi-Brand Theming

Each site configures its brand identity through CSS custom properties and layout configuration. The theming system uses three layers:

#### Layer 1: CSS Custom Properties

```css
/* Brand: Hanzo */
:root {
  --fd-primary: 0 84% 61%;      /* #fd4444 in HSL */
  --fd-background: 0 0% 4%;
  --fd-foreground: 0 0% 98%;
  --fd-muted: 0 0% 15%;
  --fd-accent: 0 84% 61%;
  --fd-border: 0 0% 15%;
  --fd-ring: 0 84% 61%;
}

/* Brand: Zen */
:root {
  --fd-primary: 210 100% 50%;
  --fd-accent: 210 100% 50%;
}
```

#### Layer 2: Layout Configuration

```tsx
<DocsLayout
  tree={source.pageTree}
  nav={{
    title: 'Hanzo Docs',
    url: 'https://docs.hanzo.ai',
  }}
  sidebar={{
    banner: <Logo brand="hanzo" />,
  }}
  links={[
    { text: 'GitHub', url: 'https://github.com/hanzoai' },
    { text: 'Discord', url: 'https://discord.gg/hanzo' },
  ]}
>
```

#### Layer 3: Content Isolation

Each brand's content lives in its own `content/` directory. The source loader is configured per-app, so cross-brand content leakage is impossible at the build level.

### Search

The framework supports three search backends:

#### Built-in Search (Orama)

Full-text search using Orama, indexed at build time:

```typescript
import { source } from '@/lib/source';
import { createSearchAPI } from '@hanzo/docs-core/search/server';

export const { GET } = createSearchAPI('advanced', {
  indexes: source.getPages().map((page) => ({
    title: page.data.title,
    description: page.data.description,
    url: page.url,
    structuredData: page.data.structuredData,
  })),
});
```

#### Algolia Adapter

For sites that need hosted search with analytics:

```typescript
import { createSearchAPI } from '@hanzo/docs-core/search/algolia-server';

export const { GET } = createSearchAPI({
  appId: process.env.ALGOLIA_APP_ID!,
  apiKey: process.env.ALGOLIA_API_KEY!,
  indexName: 'hanzo-docs',
});
```

#### Custom Search API

For integration with Hanzo Search (HIP-0012):

```typescript
import { createSearchAPI } from '@hanzo/docs-core/search/server';

export const { GET } = createSearchAPI('custom', {
  search: async (query) => {
    const results = await fetch(`https://search.hanzo.ai/api/v1/search?q=${query}`);
    return results.json();
  },
});
```

### Internationalization (i18n)

Built-in i18n support with file-based routing:

```
content/
  docs/
    index.mdx          # Default language (en)
    index.zh.mdx        # Chinese
    index.ja.mdx        # Japanese
```

Configuration:

```typescript
// lib/source.ts
import { loader } from '@hanzo/docs-core/source';
import { i18n } from '@hanzo/docs-core/i18n';

export const { source, openapi } = loader({
  baseUrl: '/docs',
  source: docs.toFumadocsSource(),
  i18n: {
    languages: ['en', 'zh', 'ja'],
    defaultLanguage: 'en',
  },
});
```

Middleware for locale negotiation:

```typescript
// middleware.ts
import { createI18nMiddleware } from '@hanzo/docs-core/i18n/middleware';

export default createI18nMiddleware({
  languages: ['en', 'zh', 'ja'],
  defaultLanguage: 'en',
});
```

### MDX Components

The framework provides a standard set of MDX components available in all documentation pages:

| Component | Description | Usage |
|-----------|-------------|-------|
| `Callout` | Info/warning/error callouts | `<Callout type="warn">Text</Callout>` |
| `Card` | Linked card with title and description | `<Card title="Guide" href="/docs/guide">` |
| `Cards` | Card grid container | `<Cards><Card .../><Card .../></Cards>` |
| `Tab` / `Tabs` | Tabbed content panels | `<Tabs items={['npm', 'pnpm']}><Tab>...</Tab></Tabs>` |
| `Step` / `Steps` | Numbered step-by-step guides | `<Steps><Step>...</Step></Steps>` |
| `TypeTable` | Auto-generated type property tables | `<TypeTable type={MyInterface} />` |
| `Accordion` | Collapsible content sections | `<Accordion title="Details">...</Accordion>` |
| `Files` | File tree visualization | `<Files><File name="app.ts" /><Folder name="lib" /></Files>` |
| `ImageZoom` | Zoomable images | `<ImageZoom src="/img/arch.png" />` |
| `CodeBlock` | Syntax-highlighted code with copy button | Automatic from fenced code blocks |
| `InlineTOC` | Inline table of contents | `<InlineTOC />` |
| `Banner` | Announcement banner | `<Banner>New release!</Banner>` |

These are registered as default MDX components and available in all `.mdx` files without explicit imports.

### OpenAPI Integration

The `@hanzo/docs-openapi` package generates documentation pages from OpenAPI 3.x specification files.

#### Spec Loading

```typescript
// source.config.ts
import { defineConfig, defineDocs } from '@hanzo/docs-mdx/config';
import { defineOpenAPI } from '@hanzo/docs-openapi';

export default defineConfig({
  docs: defineDocs({ dir: 'content/docs' }),
  openapi: defineOpenAPI({
    input: './openapi-specs/*.yaml',
    output: './content/docs/api',
  }),
});
```

#### Generated Output

For each endpoint in the spec, the package generates:

- **Endpoint page**: Method, path, description, parameters, request body, response schemas
- **Interactive playground**: Try-it-out form with authentication, parameter inputs, and live response
- **Type schemas**: Rendered as collapsible property tables with nested object support
- **Code samples**: Auto-generated cURL, JavaScript, Python, and Go examples

#### Scalar Integration

For interactive API exploration, the OpenAPI package integrates with Scalar:

```typescript
import { createScalarPage } from '@hanzo/docs-openapi/scalar';

export default createScalarPage({
  spec: './openapi-specs/hanzo-api.yaml',
  theme: 'kepler',
});
```

### TypeScript Type Documentation

The `@hanzo/docs-typescript` package generates type tables from TypeScript declarations:

```tsx
import { AutoTypeTable } from '@hanzo/docs-typescript/ui';

// Automatically generates a property table from the TypeScript interface
<AutoTypeTable path="./src/types.ts" name="UserConfig" />
```

This resolves the full type, including inherited properties, generics, and JSDoc comments. The output is a structured table showing property name, type, default value, and description.

### Python API Documentation

The `@hanzo/docs-python` package includes a Python component (`fumapy`) that extracts docstrings and type annotations:

```bash
# Generate Python API docs
uv run fumapy generate --module hanzo.sdk --output content/docs/python-sdk
```

The generated MDX files include function signatures, parameter tables, return types, and docstring content.

### Build Toolchain

#### Package Building

All packages (except the `@hanzo/docs` wrapper) use `tsdown` for compilation:

```typescript
// packages/core/tsdown.config.ts
import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/**/*.ts', 'src/**/*.tsx'],
  format: 'esm',
  dts: true,
  clean: true,
});
```

The `@hanzo/docs` wrapper uses `tsup` because it needs special re-export handling.

#### Monorepo Orchestration

Turbo manages the build graph:

```json
{
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**", "out"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```

The `^build` dependency ensures packages build before the apps that consume them.

#### Application Building

Documentation apps use Next.js with static export:

```typescript
// next.config.ts
import { createMDX } from '@hanzo/docs-mdx/next';

const withMDX = createMDX();

export default withMDX({
  output: 'export',     // Static HTML for CDN deployment
  images: { unoptimized: true },
});
```

### Deployment

Documentation sites support three deployment targets:

#### Vercel (Recommended for Dynamic Sites)

Sites with server-side features (search API routes, ISR) deploy to Vercel:

```bash
# Automatic via GitHub integration
# Or manual:
vercel deploy --prod
```

#### Cloudflare Workers (Edge)

For globally distributed static sites with edge functions:

```typescript
// open-next.config.ts (for Cloudflare adapter)
export default {
  default: {
    override: {
      wrapper: 'cloudflare-node',
      converter: 'edge',
    },
  },
};
```

Deploy via Wrangler:

```bash
pnpm build && wrangler pages deploy out
```

#### Static Export (CDN / K8s)

For maximum simplicity, export static HTML and serve from any HTTP server:

```bash
pnpm build        # Produces ./out/ directory
# Serve via nginx, Caddy, or S3+CloudFront
```

The `apps/bot-docs` and `apps/zt-docs` sites use this pattern with nginx in a Docker container:

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY . .
RUN pnpm install && pnpm build

FROM nginx:alpine
COPY --from=builder /app/out /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
```

### App Structure for New Documentation Sites

New documentation sites MUST follow this structure:

```
apps/my-docs/
  app/
    layout.tsx              # Root layout with DocsLayout
    page.tsx                # Landing page
    docs/
      [[...slug]]/
        page.tsx            # Dynamic docs page
    api/
      search/
        route.ts            # Search API endpoint
  content/
    docs/
      index.mdx             # Docs root page
      getting-started.mdx
      guides/
        meta.json           # Navigation ordering
        installation.mdx
        configuration.mdx
  lib/
    source.ts               # Source loader configuration
  source.config.ts           # Content source definition
  mdx-components.tsx         # MDX component registration
  next.config.ts             # Next.js configuration with MDX
  package.json
  postcss.config.mjs
  tsconfig.json
```

The `@hanzo/docs-cli` can scaffold this structure:

```bash
npx @hanzo/docs-create-app my-docs
```

### Upstream Sync Process

The fork maintains compatibility with upstream Fumadocs. The sync process:

```bash
# 1. Fetch upstream changes
git remote add upstream https://github.com/fuma-nama/fumadocs.git  # one-time
git fetch upstream

# 2. Create merge branch
git checkout -b merge-upstream-YYYY-MM-DD

# 3. Merge upstream dev branch
git merge upstream/dev

# 4. Resolve conflicts (usually in package.json names and brand-specific files)

# 5. Run bulk rename script
bash scripts/mirror-ui-change.sh

# 6. Verify build
pnpm install && pnpm build && pnpm test

# 7. Open PR for review
```

The `scripts/setup-fork.sh` script automates creating brand-specific documentation forks for ecosystem partners.

#### Rename Mapping

During upstream sync, all references are renamed:

| Upstream Name | Hanzo Name |
|--------------|------------|
| `fumadocs-core` | `@hanzo/docs-core` |
| `fumadocs-ui` | `@hanzo/docs-ui` |
| `fumadocs-mdx` | `@hanzo/docs-mdx` |
| `fumadocs-openapi` | `@hanzo/docs-openapi` |
| `fumadocs-typescript` | `@hanzo/docs-typescript` |
| `fumadocs-twoslash` | `@hanzo/docs-twoslash` |
| `@fumadocs/cli` | `@hanzo/docs-cli` |
| `@fumadocs/base-ui` | `@hanzo/docs-base-ui` |
| `@fumadocs/story` | `@hanzo/docs-story` |
| `@fumadocs/tailwind` | `@hanzo/docs-tailwind` |
| `fumadocs-docgen` | `@hanzo/docs-docgen` |

Note: `packages/radix-ui` publishes as `@hanzo/docs-ui` (the primary UI package). The original `fumadocs-ui` name maps to this package.

## Implementation

### Repository Structure

```
github.com/hanzoai/docs/
  .changeset/               # Changeset configuration for versioning
  .github/
    workflows/
      deploy-docs.yml       # Deploy docs.hanzo.ai
      deploy-zen-docs.yml   # Deploy zenlm.org
      deploy-zap-docs.yml   # Deploy zap.hanzo.ai
      deploy-bot-docs.yml   # Deploy bot.hanzo.ai
      lint.yml              # Lint all packages
      test.yml              # Test all packages
      release.yml           # Publish to npm via changesets
  apps/
    docs/                   # docs.hanzo.ai
    zen-docs/               # zenlm.org
    zap-docs/               # zap.hanzo.ai
    bot-docs/               # bot.hanzo.ai
    dev-docs/               # dev.hanzo.ai
    cloud/                  # cloud docs
    flow/                   # flow docs
    zt-docs/                # zt docs
  packages/                 # 24 packages (see Package Architecture)
  examples/                 # 24 example applications
  scripts/
    build-all-docs.sh       # Build all doc sites
    dev-all-docs.sh         # Run all doc sites in dev mode
    mirror-ui-change.sh     # Sync UI changes across radix-ui and base-ui
    setup-fork.sh           # Create branded doc forks
    cf-pages-deploy.mjs     # Cloudflare Pages deployment script
  package.json              # Root workspace configuration
  pnpm-workspace.yaml       # Workspace package declarations
  turbo.json                # Turbo build pipeline configuration
  vitest.config.ts          # Test configuration
```

### Version Management

Packages use [Changesets](https://github.com/changesets/changesets) for version management:

```bash
# Add a changeset
pnpm changeset

# Version all changed packages
pnpm version

# Publish to npm
pnpm release
```

The release process:
1. Developer runs `pnpm changeset` and selects affected packages
2. CI runs `changeset version` to bump versions
3. CI runs `turbo run build --filter=./packages/*` to build all packages
4. CI runs `changeset publish` to push to npm
5. Packages with `postpublish` scripts run any post-publish tasks

### Workspace Configuration

```yaml
# pnpm-workspace.yaml
packages:
  - packages/*
  - apps/*
  - examples/*
```

All packages, apps, and examples are part of the workspace. Internal dependencies use `workspace:*` protocol for always-latest linking during development.

### CI/CD Workflows

#### Package Publishing (`release.yml`)

Triggered on push to main. Uses changesets to determine which packages need publishing:

```yaml
name: Release
on:
  push:
    branches: [main]
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install
      - uses: changesets/action@v1
        with:
          publish: pnpm release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

#### Site Deployment (`deploy-*.yml`)

Each documentation site has its own deployment workflow. Example for `docs.hanzo.ai`:

```yaml
name: Deploy Docs
on:
  push:
    branches: [main]
    paths:
      - 'apps/docs/**'
      - 'packages/**'
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install
      - run: pnpm build --filter docs
      - uses: cloudflare/pages-deploy-action@v1
        with:
          directory: apps/docs/out
          project-name: hanzo-docs
```

### Compatibility Matrix

| Dependency | Minimum Version | Tested Version |
|-----------|----------------|----------------|
| Node.js | 18.17.0 | 20.x, 22.x |
| Next.js | 15.3.0 | 16.1.x |
| React | 19.2.0 | 19.2.x |
| Tailwind CSS | 4.0.0 | 4.1.x |
| pnpm | 10.0.0 | 10.18.x |
| TypeScript | 5.5.0 | 5.9.x |

### Configuration Files

Every documentation app requires these configuration files:

#### `next.config.ts`

```typescript
import { createMDX } from '@hanzo/docs-mdx/next';

const withMDX = createMDX();

export default withMDX({
  output: 'export',
});
```

#### `postcss.config.mjs`

```javascript
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
```

#### `mdx-components.tsx`

```tsx
import type { MDXComponents } from 'mdx/types';
import defaultComponents from '@hanzo/docs-ui/mdx';

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    ...defaultComponents,
    ...components,
  };
}
```

## Security

### Content Security

- **No arbitrary code execution**: MDX files are compiled at build time, not runtime. User-submitted content cannot execute arbitrary JavaScript.
- **Sanitized HTML**: The `rehype-raw` plugin processes inline HTML through a sanitizer before rendering.
- **No secrets in content**: Documentation content MUST NOT contain API keys, tokens, or credentials. Example code MUST use placeholder values (`sk-...`, `your-api-key`).

### Dependency Security

- **Dependabot enabled**: The repository uses Renovate for automated dependency updates.
- **npm provenance**: Published packages include npm provenance attestations.
- **Lockfile integrity**: The `pnpm-lock.yaml` is committed and verified in CI.

### Deployment Security

- **Static export preferred**: Static HTML has no server-side attack surface.
- **CSP headers**: All deployed sites MUST include Content Security Policy headers restricting script sources.
- **HTTPS only**: All documentation sites are served over HTTPS with HSTS enabled.

## Monitoring and Observability

### Build Metrics

| Metric | Description | Target |
|--------|-------------|--------|
| `docs.build.duration_seconds` | Full build time for a documentation site | < 120s |
| `docs.package.build_seconds` | Individual package build time | < 30s |
| `docs.bundle.size_kb` | Client-side JavaScript bundle size | < 250KB |
| `docs.pages.count` | Total pages across all sites | Informational |
| `docs.search.index_size_kb` | Search index size | < 5MB per site |

### Lighthouse Targets

All documentation sites MUST meet these Lighthouse scores:

| Category | Minimum Score |
|----------|--------------|
| Performance | 90 |
| Accessibility | 95 |
| Best Practices | 95 |
| SEO | 95 |

### Uptime

Documentation sites are monitored via the Hanzo status page. Target uptime: 99.9%.

## Migration Guide

### From Docusaurus

1. Convert `docs/` markdown files to MDX format (usually minimal changes)
2. Replace `docusaurus.config.js` with `source.config.ts` and `next.config.ts`
3. Convert `sidebars.js` to `meta.json` files in content directories
4. Replace Docusaurus-specific components (`<CodeBlock>`, `<Tabs>`) with `@hanzo/docs-ui` equivalents
5. Move static assets from `static/` to `public/`

### From Upstream Fumadocs

1. Replace all `fumadocs-*` imports with `@hanzo/docs-*` equivalents (see Rename Mapping)
2. Update `package.json` dependencies
3. Add brand CSS custom properties
4. No content changes required -- MDX format is identical

### From Scratch

```bash
# 1. Scaffold a new docs site
npx @hanzo/docs-create-app my-docs

# 2. Install dependencies
cd my-docs && pnpm install

# 3. Add content
# Create .mdx files in content/docs/

# 4. Run development server
pnpm dev

# 5. Build for production
pnpm build
```

## Future Work

### Phase 1: Current (Q1 2026)

- All Hanzo ecosystem documentation on `@hanzo/docs-*` framework
- Multi-brand theming for Hanzo, Zen, ZAP, Bot
- OpenAPI doc generation for LLM Gateway and Cloud APIs
- Built-in Orama search on all sites

### Phase 2: Unified Search (Q2 2026)

- Cross-site federated search (search docs.hanzo.ai and find results from zenlm.org)
- Integration with Hanzo Search (HIP-0012) for AI-powered search
- Search analytics dashboard

### Phase 3: Interactive Docs (Q3 2026)

- Embedded code sandboxes (run examples in-browser)
- Live API playground with authentication flow
- Interactive protocol visualizations for HIPs

### Phase 4: Automation (Q4 2026)

- Auto-generate SDK documentation from source code (Go, Python, TypeScript, Rust)
- Auto-sync API docs when OpenAPI specs change in CI
- AI-assisted content generation for boilerplate documentation
- Automated broken link detection and content freshness scoring

## References

1. [Fumadocs Documentation](https://fumadocs.dev) -- Upstream framework
2. [Hanzo Docs Repository](https://github.com/hanzoai/docs) -- Source code
3. [Next.js App Router Documentation](https://nextjs.org/docs/app)
4. [MDX Documentation](https://mdxjs.com/)
5. [Radix UI Primitives](https://www.radix-ui.com/)
6. [Orama Search Engine](https://docs.orama.com/)
7. [Changesets Version Management](https://github.com/changesets/changesets)
8. [Turbo Build System](https://turbo.build/)
9. [HIP-0010: Model Context Protocol Integration Standards](./hip-0010-model-context-protocol-mcp-integration-standards.md)
10. [HIP-0012: Search Interface Standard](./hip-0012-search-interface-standard.md)
11. [HIP-0036: CI/CD Build System Standard](./hip-0036-ci-cd-build-system-standard.md)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
